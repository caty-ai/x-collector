import { PrismaClient } from "@prisma/client";
import { sendHeartbeat, sendOpsAlert } from "../lib/ops-alert";
import { CollectionSweepResult, runCollectionSweep } from "./run";
import {
  NORMALIZE_PLATFORMS,
  NormalizePlatform,
  normalizePipelineItems,
} from "../lib/pipeline/normalize";
import { classifyPipelineItemsByLlm } from "../lib/pipeline/classify-llm";
import { crosslinkPipelineItemsByLlm } from "../lib/pipeline/crosslink-llm";
import { runTopicCluster } from "../lib/pipeline/topic-cluster";
import { aggregateVoiceSignals } from "../lib/pipeline/voicesignal";
import { recomputeSourceTrust } from "./source-score";
import {
  assertRequiredEnv,
  formatRuntimeTimestamp,
  getDateKeyInJst,
  parsePositiveInt,
  PROD_RUNTIME_TIMEZONE,
  toPipelineDateUtc,
  toStep4DateJst,
  validateDateKeyJst,
} from "./prod-schedule-utils";

const STALE_RUN_WINDOW_MS = 12 * 60 * 60 * 1000;
const DEFAULT_FAILED_THRESHOLD = 10;

interface CliOptions {
  dryRun: boolean;
  skipCollect: boolean;
  skipTrust: boolean;
  includeSummary: boolean;
  includeCompleted: boolean;
  dateJstExplicit: boolean;
  dateKeyJst: string;
  platforms: string[];
  classifyLimit: number;
  step4Limit: number;
  step4BatchSize: number;
  step6Limit: number;
}

interface StepResult<TMetrics = unknown> {
  name: string;
  ok: boolean;
  metrics: TMetrics | null;
  error?: string;
}

interface SweepSummary {
  ok: boolean;
  skipped: boolean;
  hasFailures: boolean;
  allCollectorsFailed: boolean;
  sourceErrorsEqualSources: boolean;
  failedCollectors: string[];
  totalCollectors: number | null;
  failedCount: number | null;
  errors: number | null;
  sources: number | null;
  summaryFailed: boolean;
  summaryError?: string;
  error?: string;
}

function parsePlatforms(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    skipCollect: false,
    skipTrust: false,
    includeSummary: false,
    includeCompleted: false,
    dateJstExplicit: false,
    dateKeyJst: getDateKeyInJst(),
    platforms: [],
    classifyLimit: parsePositiveInt(process.env.PROD_CLASSIFY_LIMIT, 600),
    step4Limit: parsePositiveInt(process.env.STEP4_CROSSLINK_LIMIT, 600),
    step4BatchSize: parsePositiveInt(process.env.STEP4_CROSSLINK_BATCH_SIZE, 45, {
      min: 30,
      max: 150,
    }),
    step6Limit: parsePositiveInt(process.env.STEP6_VOICESIGNAL_LIMIT, 400),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (token === "--skip-collect") {
      options.skipCollect = true;
      continue;
    }

    if (token === "--skip-trust") {
      options.skipTrust = true;
      continue;
    }

    if (token === "--with-summary") {
      options.includeSummary = true;
      continue;
    }

    if (token === "--include-completed") {
      options.includeCompleted = true;
      continue;
    }

    if (token.startsWith("--date-jst=")) {
      options.dateKeyJst = validateDateKeyJst(token.split("=", 2)[1] || "");
      options.dateJstExplicit = true;
      continue;
    }

    if (token === "--date-jst" || token === "--date") {
      options.dateKeyJst = validateDateKeyJst(argv[i + 1] || "");
      options.dateJstExplicit = true;
      i += 1;
      continue;
    }

    if (token.startsWith("--platform=")) {
      options.platforms.push(...parsePlatforms(token.split("=", 2)[1] || ""));
      continue;
    }

    if (token === "--platform") {
      options.platforms.push(...parsePlatforms(argv[i + 1] || ""));
      i += 1;
      continue;
    }

    if (token.startsWith("--classify-limit=")) {
      options.classifyLimit = parsePositiveInt(token.split("=", 2)[1], options.classifyLimit);
      continue;
    }

    if (token === "--classify-limit") {
      options.classifyLimit = parsePositiveInt(argv[i + 1], options.classifyLimit);
      i += 1;
      continue;
    }

    if (token.startsWith("--step4-limit=")) {
      options.step4Limit = parsePositiveInt(token.split("=", 2)[1], options.step4Limit);
      continue;
    }

    if (token === "--step4-limit") {
      options.step4Limit = parsePositiveInt(argv[i + 1], options.step4Limit);
      i += 1;
      continue;
    }

    if (token.startsWith("--step4-batch-size=")) {
      options.step4BatchSize = parsePositiveInt(token.split("=", 2)[1], options.step4BatchSize, {
        min: 30,
        max: 150,
      });
      continue;
    }

    if (token === "--step4-batch-size") {
      options.step4BatchSize = parsePositiveInt(argv[i + 1], options.step4BatchSize, {
        min: 30,
        max: 150,
      });
      i += 1;
      continue;
    }

    if (token.startsWith("--step6-limit=")) {
      options.step6Limit = parsePositiveInt(token.split("=", 2)[1], options.step6Limit);
      continue;
    }

    if (token === "--step6-limit") {
      options.step6Limit = parsePositiveInt(argv[i + 1], options.step6Limit);
      i += 1;
      continue;
    }
  }

  options.platforms = [...new Set(options.platforms)];
  return options;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

function metricFailedCount(metrics: unknown): number | null {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return null;

  const record = metrics as {
    failed?: unknown;
    counter?: { failed?: unknown };
    totals?: { failed?: unknown };
  };

  if (typeof record.failed === "number" && Number.isFinite(record.failed)) {
    return record.failed;
  }
  if (typeof record.counter?.failed === "number" && Number.isFinite(record.counter.failed)) {
    return record.counter.failed;
  }
  if (typeof record.totals?.failed === "number" && Number.isFinite(record.totals.failed)) {
    return record.totals.failed;
  }
  return null;
}

// Batch-level failure counters are alert-worthy at >0: one failed LLM batch
// zeroes a whole batch of decisions while the step itself still returns ok.
const BATCH_FAILURE_METRIC_KEYS = ["llmFailedBatches", "embedFailed"] as const;

function metricBatchFailures(metrics: unknown): Array<{ key: string; value: number }> {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return [];

  const record = metrics as { counter?: Record<string, unknown> } & Record<string, unknown>;
  const found: Array<{ key: string; value: number }> = [];
  for (const key of BATCH_FAILURE_METRIC_KEYS) {
    const direct = record[key];
    const nested = record.counter ? record.counter[key] : undefined;
    const value =
      typeof direct === "number" && Number.isFinite(direct)
        ? direct
        : typeof nested === "number" && Number.isFinite(nested)
          ? nested
          : null;
    if (value !== null && value > 0) found.push({ key, value });
  }
  return found;
}

async function runStep<TMetrics>(
  name: string,
  fn: () => Promise<TMetrics>,
): Promise<StepResult<TMetrics>> {
  try {
    console.log(`[prod-cycle] ${name} start`);
    const metrics = await fn();
    console.log(`[prod-cycle] ${name} complete`);
    return { name, ok: true, metrics };
  } catch (error) {
    const message = errorMessage(error);
    console.error(`[prod-cycle] ${name} failed; continuing`, message);
    return { name, ok: false, metrics: null, error: message };
  }
}

function summarizeSweepResult(
  sweep: CollectionSweepResult | null,
  skipped: boolean,
  sweepError?: string,
): SweepSummary {
  if (skipped) {
    return {
      ok: true,
      skipped: true,
      hasFailures: false,
      allCollectorsFailed: false,
      sourceErrorsEqualSources: false,
      failedCollectors: [],
      totalCollectors: null,
      failedCount: null,
      errors: null,
      sources: null,
      summaryFailed: false,
    };
  }

  if (!sweep) {
    return {
      ok: false,
      skipped: false,
      hasFailures: true,
      allCollectorsFailed: true,
      sourceErrorsEqualSources: false,
      failedCollectors: [],
      totalCollectors: null,
      failedCount: null,
      errors: null,
      sources: null,
      summaryFailed: false,
      error: sweepError,
    };
  }

  const failedCollectors = sweep.collectorResults
    .filter((result) => !result.ok)
    .map((result) => result.name);
  const summaryFailed = Boolean(sweep.summaryResult && !sweep.summaryResult.ok);
  const summaryError = summaryFailed ? sweep.summaryResult?.error : undefined;

  return {
    ok: !sweep.hasFailures,
    skipped: false,
    hasFailures: sweep.hasFailures,
    allCollectorsFailed: sweep.allCollectorsFailed,
    sourceErrorsEqualSources: sweep.sourceErrorsEqualSources,
    failedCollectors,
    totalCollectors: sweep.collectorCount,
    failedCount: sweep.collectorFailed,
    errors: sweep.errors,
    sources: sweep.sources,
    summaryFailed,
    summaryError,
    error: sweepError,
  };
}

async function sweepStaleRuns(prisma: PrismaClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_WINDOW_MS);
  const now = new Date();
  const result = await prisma.run.updateMany({
    where: {
      status: "running",
      startedAt: { lt: cutoff },
    },
    data: {
      status: "aborted",
      endedAt: now,
    },
  });
  return result.count;
}

async function main(): Promise<number> {
  const startedAt = new Date();
  const options = parseArgs(process.argv.slice(2));
  const requiredEnv = options.skipCollect
    ? ["DATABASE_URL", "OPENROUTER_API_KEY"]
    : ["DATABASE_URL", "SCRAPECREATORS_API_KEY", "OPENROUTER_API_KEY"];

  assertRequiredEnv(requiredEnv);

  console.log(
    `[prod-cycle] start=${formatRuntimeTimestamp(startedAt)} tz=${PROD_RUNTIME_TIMEZONE} dateJst=${options.dateKeyJst}`,
  );

  const step4DateOverride = options.dateJstExplicit ? toStep4DateJst(options.dateKeyJst) : undefined;
  const pipelineDate = toPipelineDateUtc(options.dateKeyJst);
  const pipelinePlatforms = options.platforms.length > 0 ? options.platforms : undefined;
  const normalizePlatforms = options.platforms.filter(
    (value): value is NormalizePlatform => NORMALIZE_PLATFORMS.includes(value as NormalizePlatform),
  );
  const failedThreshold = parsePositiveInt(
    process.env.OPS_ALERT_FAILED_THRESHOLD,
    DEFAULT_FAILED_THRESHOLD,
  );

  if (options.platforms.length > 0 && normalizePlatforms.length === 0) {
    throw new Error(`No valid normalize platforms in --platform: ${options.platforms.join(",")}`);
  }

  const prisma = new PrismaClient();
  try {
    const staleRunCount = options.dryRun ? 0 : await sweepStaleRuns(prisma);
    console.log(`[prod-cycle] stale running runs marked aborted=${staleRunCount}`);

    let sweepResult: CollectionSweepResult | null = null;
    let sweepError: string | undefined;
    if (!options.skipCollect) {
      console.log("[prod-cycle] collect start");
      try {
        sweepResult = await runCollectionSweep({
          includeSummary: options.includeSummary,
          logger: console,
        });
      } catch (error) {
        sweepError = errorMessage(error);
        console.error("[prod-cycle] collect sweep failed; continuing pipeline", sweepError);
      }
    } else {
      console.log("[prod-cycle] skip collect (--skip-collect)");
    }

    console.log(
      `[prod-cycle] pipeline start dateJst=${options.dateKeyJst} dryRun=${options.dryRun}`,
    );

    const stepResults: StepResult[] = [];
    stepResults.push(
      await runStep("step0.normalize", () =>
        normalizePipelineItems(prisma, {
          dryRun: options.dryRun,
          platforms: normalizePlatforms.length > 0 ? normalizePlatforms : undefined,
          logger: console,
        }),
      ),
    );
    stepResults.push(
      await runStep("step1to3.classify", () =>
        classifyPipelineItemsByLlm(prisma, {
          dryRun: options.dryRun,
          limit: options.classifyLimit,
          platforms: pipelinePlatforms,
          fallbackToRules: true,
          pendingOnly: !options.includeCompleted,
          logger: console,
        }),
      ),
    );

    if (!options.skipTrust) {
      stepResults.push(
        await runStep("step.sourceTrust", async () => {
          const result = await recomputeSourceTrust(prisma, {
            dryRun: options.dryRun,
            logger: console,
          });
          console.log(
            `[prod-cycle] source trust scored=${result.scored} written=${result.written} labels=${JSON.stringify(result.labelCounts)}`,
          );
          return {
            scored: result.scored,
            written: result.written,
            labels: result.labelCounts,
          };
        }),
      );
    } else {
      console.log("[prod-cycle] skip source trust (--skip-trust)");
    }

    stepResults.push(
      await runStep("step4.crosslink", () =>
        crosslinkPipelineItemsByLlm(prisma, {
          dryRun: options.dryRun,
          ...(step4DateOverride ? { dateJst: step4DateOverride } : {}),
          limit: options.step4Limit,
          platforms: pipelinePlatforms,
          batchSize: options.step4BatchSize,
          pendingOnly: !options.includeCompleted,
          logger: console,
        }),
      ),
    );
    stepResults.push(
      await runStep("step4_5.topicCluster", () =>
        runTopicCluster(prisma, {
          dryRun: options.dryRun,
          platforms: pipelinePlatforms,
          logger: console,
        }),
      ),
    );
    stepResults.push(
      await runStep("step6.voiceSignal", () =>
        aggregateVoiceSignals(prisma, {
          dryRun: options.dryRun,
          // The caller date only ensures that run's draft exists; attachment uses each item's editionKey.
          editionDate: pipelineDate,
          limit: options.step6Limit,
          platforms: pipelinePlatforms,
          logger: console,
        }),
      ),
    );

    const finishedAt = new Date();
    const sweep = summarizeSweepResult(sweepResult, options.skipCollect, sweepError);
    const failedSteps = stepResults.filter((result) => !result.ok);
    const executedStepCount = stepResults.length;
    const allExecutedStepsFailed = executedStepCount > 0 && failedSteps.length === executedStepCount;

    const alertReasons: string[] = [];
    if (staleRunCount > 0) {
      alertReasons.push(`stale running Run rows aborted=${staleRunCount}`);
    }
    if (sweep.error) {
      alertReasons.push(`collector sweep error=${sweep.error}`);
    }
    if (sweep.sourceErrorsEqualSources) {
      alertReasons.push(
        `collector sweep errors==sources; all collectors failed (${sweep.errors ?? "?"}/${sweep.sources ?? "?"})`,
      );
    } else if (sweep.allCollectorsFailed) {
      alertReasons.push(
        `all collectors failed (${sweep.failedCount ?? "?"}/${sweep.totalCollectors ?? "?"})`,
      );
    } else if ((sweep.failedCount ?? 0) > 0) {
      alertReasons.push(
        `collector partial failures (${sweep.failedCount}/${sweep.totalCollectors ?? "?"})`,
      );
    }
    if (sweep.summaryFailed) {
      alertReasons.push(`summary.daily failed${sweep.summaryError ? `: ${sweep.summaryError}` : ""}`);
    }

    for (const step of failedSteps) {
      alertReasons.push(`${step.name} failed`);
    }
    for (const step of stepResults) {
      const failed = metricFailedCount(step.metrics);
      if (failed !== null && failed > failedThreshold) {
        alertReasons.push(`${step.name} counter.failed=${failed} > threshold=${failedThreshold}`);
      }
      for (const batchFailure of metricBatchFailures(step.metrics)) {
        alertReasons.push(`${step.name} counter.${batchFailure.key}=${batchFailure.value}`);
      }
    }
    if (
      !sweep.sourceErrorsEqualSources &&
      !sweep.allCollectorsFailed &&
      (sweep.errors ?? 0) > failedThreshold
    ) {
      alertReasons.push(
        `collector per-source errors=${sweep.errors} > threshold=${failedThreshold}`,
      );
    }

    // Invariant: the success heartbeat fires iff no alert condition exists.
    // Per-source errors at or below the threshold are tolerated (visible in the
    // summary JSON) so a single renamed handle cannot silence the deadman daily.
    const fullySuccessful =
      !options.skipCollect && !options.dryRun && alertReasons.length === 0;
    const exitCode = sweep.allCollectorsFailed || allExecutedStepsFailed ? 1 : 0;
    const status = exitCode === 1
      ? "failed"
      : sweep.hasFailures || alertReasons.length > 0
        ? "partial"
        : "ok";

    console.log("\n=== Production collect-cycle summary ===");
    console.log(
      JSON.stringify(
        {
          dateJst: options.dateKeyJst,
          dryRun: options.dryRun,
          skipCollect: options.skipCollect,
          skipTrust: options.skipTrust,
          includeSummary: options.includeSummary,
          includeCompleted: options.includeCompleted,
          runtime: {
            timeZone: PROD_RUNTIME_TIMEZONE,
            startedAt: formatRuntimeTimestamp(startedAt),
            finishedAt: formatRuntimeTimestamp(finishedAt),
          },
          platforms: pipelinePlatforms,
          limits: {
            classify: options.classifyLimit,
            step4: options.step4Limit,
            step4BatchSize: options.step4BatchSize,
            step6: options.step6Limit,
            failedAlertThreshold: failedThreshold,
          },
          staleRunsAborted: staleRunCount,
          sweep,
          steps: stepResults,
          failedSteps: failedSteps.map((result) => ({
            name: result.name,
            error: result.error,
          })),
          status,
          exitCode,
        },
        null,
        2,
      ),
    );

    if (alertReasons.length > 0) {
      await sendOpsAlert(
        `[prod-cycle] status=${status} at ${finishedAt.toISOString()} dateJst=${options.dateKeyJst} reasons=${alertReasons.join("; ")}`,
      );
    }

    if (fullySuccessful) {
      const heartbeatUrl = process.env.HEARTBEAT_URL_COLLECT;
      if (heartbeatUrl) {
        await sendHeartbeat(heartbeatUrl, "prod-collect-cycle");
      }
    }

    return exitCode;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((exitCode) => {
    // Exit explicitly: lingering keep-alive handles can keep the event loop
    // alive after a successful run, which leaves the Railway cron container
    // running and blocks every subsequent scheduled fire (#65). Exit inside a
    // stdout drain callback so the summary JSON is not truncated on pipes,
    // with a failsafe timer in case the callback never fires (broken pipe).
    const failsafe = setTimeout(() => process.exit(exitCode), 5000);
    process.stdout.write("", () => {
      clearTimeout(failsafe);
      process.exit(exitCode);
    });
  })
  .catch(async (error) => {
    const message = errorMessage(error);
    console.error("Fatal collect-cycle error:", error);
    try {
      await sendOpsAlert(
        `[prod-cycle] fatal at ${new Date().toISOString()} error=${message}`,
      );
    } finally {
      process.exit(1);
    }
  });
