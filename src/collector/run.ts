import { collect } from "./index";
import { collectAlerts } from "./alerts";
import { collectFacebook } from "./facebook";
import { collectReddit } from "./reddit";
import { collectQiita } from "./qiita";
import { collectGithub } from "./github";
import { collectInstagram } from "./instagram";
import { collectOpenRouterModels } from "./openrouter";
import { generateDailySummary } from "../summary/daily";
import { sendOpsAlert } from "../lib/ops-alert";

type Logger = Pick<Console, "log" | "warn" | "error">;

interface CollectorCounters {
  sources: number;
  errors: number;
  total: number;
}

export interface CollectRunOptions {
  includeSummary?: boolean;
  logger?: Logger;
}

export interface CollectTaskResult {
  name: string;
  kind: "collector" | "summary";
  ok: boolean;
  metrics: CollectorCounters | null;
  sources: number;
  errors: number;
  error?: string;
}

export interface CollectionSweepResult {
  results: CollectTaskResult[];
  collectorResults: CollectTaskResult[];
  summaryResult: CollectTaskResult | null;
  collectorCount: number;
  collectorFailed: number;
  sources: number;
  errors: number;
  sourceErrorsEqualSources: boolean;
  hasFailures: boolean;
  allCollectorsFailed: boolean;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

async function runCollectorTask(
  logger: Logger,
  task: { name: string; fn: () => Promise<CollectorCounters> },
): Promise<CollectTaskResult> {
  try {
    logger.log(`[collect] ${task.name} start`);
    const metrics = await task.fn();
    const ok = metrics.sources === 0 || metrics.errors < metrics.sources;
    logger.log(
      `[collect] ${task.name} complete sources=${metrics.sources} errors=${metrics.errors} total=${metrics.total}`,
    );
    return {
      name: task.name,
      kind: "collector",
      ok,
      metrics,
      sources: metrics.sources,
      errors: metrics.errors,
    };
  } catch (error) {
    const message = errorMessage(error);
    logger.error(`[collect] ${task.name} failed; continuing`, message);
    return {
      name: task.name,
      kind: "collector",
      ok: false,
      metrics: null,
      sources: 0,
      errors: 0,
      error: message,
    };
  }
}

async function runSummaryTask(
  logger: Logger,
  task: { name: string; fn: () => Promise<void> },
): Promise<CollectTaskResult> {
  try {
    logger.log(`[collect] ${task.name} start`);
    await task.fn();
    logger.log(`[collect] ${task.name} complete`);
    return {
      name: task.name,
      kind: "summary",
      ok: true,
      metrics: null,
      sources: 0,
      errors: 0,
    };
  } catch (error) {
    const message = errorMessage(error);
    logger.error(`[collect] ${task.name} failed; continuing`, message);
    return {
      name: task.name,
      kind: "summary",
      ok: false,
      metrics: null,
      sources: 0,
      errors: 0,
      error: message,
    };
  }
}

export async function runCollectionSweep(
  options: CollectRunOptions = {},
): Promise<CollectionSweepResult> {
  const logger = options.logger || console;
  const includeSummary = options.includeSummary !== false;
  const results: CollectTaskResult[] = [];

  const collectorTasks = [
    { name: "collect.x", kind: "collector" as const, fn: collect },
    { name: "collect.alerts", kind: "collector" as const, fn: collectAlerts },
    { name: "collect.facebook", kind: "collector" as const, fn: collectFacebook },
    { name: "collect.reddit", kind: "collector" as const, fn: collectReddit },
    { name: "collect.qiita", kind: "collector" as const, fn: collectQiita },
    { name: "collect.github", kind: "collector" as const, fn: collectGithub },
    { name: "collect.instagram", kind: "collector" as const, fn: collectInstagram },
    {
      name: "collect.openrouterModels",
      kind: "collector" as const,
      fn: collectOpenRouterModels,
    },
  ];

  for (const task of collectorTasks) {
    results.push(await runCollectorTask(logger, task));
  }

  if (includeSummary) {
    results.push(
      await runSummaryTask(logger, {
        name: "summary.daily",
        fn: async () => {
          logger.log("\n--- Generating daily summary ---");
          await generateDailySummary();
        },
      }),
    );
  }

  const collectorResults = results.filter(
    (result): result is CollectTaskResult => result.kind === "collector",
  );
  const summaryResult = results.find((result) => result.kind === "summary") || null;
  const collectorFailed = collectorResults.filter((result) => !result.ok).length;
  const participatingCollectors = collectorResults.filter(
    (result) => result.sources > 0 || !result.ok,
  );
  const sources = collectorResults.reduce((sum, result) => sum + result.sources, 0);
  const errors = collectorResults.reduce((sum, result) => sum + result.errors, 0);
  const sourceErrorsEqualSources = sources > 0 && errors >= sources;

  return {
    results,
    collectorResults,
    summaryResult,
    collectorCount: collectorResults.length,
    collectorFailed,
    sources,
    errors,
    sourceErrorsEqualSources,
    hasFailures: errors > 0 || results.some((result) => !result.ok),
    allCollectorsFailed:
      sourceErrorsEqualSources ||
      (participatingCollectors.length > 0 &&
        participatingCollectors.every((result) => !result.ok)),
  };
}

if (require.main === module) {
  const includeSummary = !process.argv.includes("--skip-summary");

  runCollectionSweep({ includeSummary })
    .then(async (result) => {
      if (result.allCollectorsFailed) {
        throw new Error("All collection tasks failed");
      }
      if (result.summaryResult && !result.summaryResult.ok) {
        throw new Error(`Daily summary failed: ${result.summaryResult.error || "unknown error"}`);
      }
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Fatal:", err);
      try {
        await sendOpsAlert(
          `[run.ts] fatal error at ${new Date().toISOString()}\n${errorMessage(err)}`,
        );
      } finally {
        process.exit(1);
      }
    });
}
