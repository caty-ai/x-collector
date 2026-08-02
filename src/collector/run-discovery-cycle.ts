// Intended Railway cron: run daily at 03:00 JST (18:00 UTC), offset from
// collect:prod at 00:00/12:00 JST and publish:prod at 06:00 JST.
import { PrismaClient } from "@prisma/client";
import { evaluatePendingCandidates } from "./evaluate-candidates";
import { extractCandidates, fetchCandidateProfiles } from "./discover";
import { applySourceLifecycle } from "./lifecycle";
import {
  assertRequiredEnv,
  formatRuntimeTimestamp,
  parsePositiveInt,
  PROD_RUNTIME_TIMEZONE,
} from "./prod-schedule-utils";
import { sendOpsAlert } from "../lib/ops-alert";

interface CliOptions {
  dryRun: boolean;
  skipLifecycle: boolean;
  fetchLimit: number;
  evalLimit: number;
}

interface StepResult {
  name: string;
  ok: boolean;
  metrics: unknown;
  error?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    skipLifecycle: false,
    fetchLimit: parsePositiveInt(process.env.PROD_DISCOVER_FETCH_LIMIT, 20),
    evalLimit: parsePositiveInt(process.env.PROD_DISCOVER_EVAL_LIMIT, 20),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (token === "--skip-lifecycle") {
      options.skipLifecycle = true;
      continue;
    }

    if (token.startsWith("--fetch-limit=")) {
      options.fetchLimit = parsePositiveInt(token.split("=", 2)[1], options.fetchLimit);
      continue;
    }

    if (token === "--fetch-limit") {
      options.fetchLimit = parsePositiveInt(argv[i + 1], options.fetchLimit);
      i += 1;
      continue;
    }

    if (token.startsWith("--eval-limit=")) {
      options.evalLimit = parsePositiveInt(token.split("=", 2)[1], options.evalLimit);
      continue;
    }

    if (token === "--eval-limit") {
      options.evalLimit = parsePositiveInt(argv[i + 1], options.evalLimit);
      i += 1;
    }
  }

  return options;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

async function runStep(name: string, fn: () => Promise<unknown>): Promise<StepResult> {
  try {
    console.log(`[discover-cycle] ${name} start`);
    const metrics = await fn();
    console.log(`[discover-cycle] ${name} complete`);
    return { name, ok: true, metrics };
  } catch (error) {
    const message = errorMessage(error);
    console.error(`[discover-cycle] ${name} failed; continuing`, message);
    return { name, ok: false, metrics: null, error: message };
  }
}

async function main() {
  const startedAt = new Date();
  const options = parseArgs(process.argv.slice(2));

  assertRequiredEnv(["DATABASE_URL"]);

  console.log(
    `[discover-cycle] start=${formatRuntimeTimestamp(startedAt)} tz=${PROD_RUNTIME_TIMEZONE} dryRun=${options.dryRun}`,
  );

  const prisma = new PrismaClient();
  const results: StepResult[] = [];

  try {
    results.push(
      await runStep("phase1.extractCandidates", () =>
        extractCandidates({ dryRun: options.dryRun, logger: console }, prisma),
      ),
    );
    results.push(
      await runStep("phase2.fetchCandidateProfiles", () => {
        assertRequiredEnv(["SCRAPECREATORS_API_KEY"]);
        return fetchCandidateProfiles(
          options.fetchLimit,
          { dryRun: options.dryRun, logger: console },
          prisma,
        );
      }),
    );
    results.push(
      await runStep("phase3.evaluatePendingCandidates", () => {
        assertRequiredEnv(["OPENROUTER_API_KEY"]);
        return evaluatePendingCandidates(prisma, {
          dryRun: options.dryRun,
          limit: options.evalLimit,
          logger: console,
        });
      }),
    );

    if (options.skipLifecycle) {
      console.log("[discover-cycle] skip lifecycle (--skip-lifecycle)");
    } else {
      results.push(
        await runStep("lifecycle.applySourceLifecycle", () =>
          applySourceLifecycle(prisma, { dryRun: options.dryRun, logger: console }),
        ),
      );
    }

    const finishedAt = new Date();
    const failed = results.filter((result) => !result.ok);
    const allFailed = results.length > 0 && failed.length === results.length;
    const lifecycleFailed = failed.some((result) => result.name === "lifecycle.applySourceLifecycle");

    console.log("\n=== Production discovery-cycle summary ===");
    console.log(
      JSON.stringify(
        {
          dryRun: options.dryRun,
          skipLifecycle: options.skipLifecycle,
          runtime: {
            timeZone: PROD_RUNTIME_TIMEZONE,
            startedAt: formatRuntimeTimestamp(startedAt),
            finishedAt: formatRuntimeTimestamp(finishedAt),
          },
          limits: {
            fetch: options.fetchLimit,
            evaluate: options.evalLimit,
          },
          steps: results,
          failedSteps: failed.map((result) => ({
            name: result.name,
            error: result.error,
          })),
          lifecycleCriticalFailure: lifecycleFailed,
          status: lifecycleFailed ? "critical_failed" : allFailed ? "failed" : failed.length > 0 ? "partial" : "ok",
        },
        null,
        2,
      ),
    );

    if (lifecycleFailed) {
      throw new Error("Safety-critical lifecycle step failed");
    }
    if (allFailed) {
      throw new Error("All discovery-cycle steps failed");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    const failsafe = setTimeout(() => process.exit(0), 5000);
    process.stdout.write("", () => {
      clearTimeout(failsafe);
      process.exit(0);
    });
  })
  .catch(async (error) => {
    console.error("Fatal discovery-cycle error:", error);
    try {
      await sendOpsAlert(
        `[run-discovery-cycle.ts] fatal error at ${new Date().toISOString()}\n${errorMessage(error)}`,
      );
    } finally {
      process.exit(1);
    }
  });
