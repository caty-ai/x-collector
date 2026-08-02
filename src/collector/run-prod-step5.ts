import { PrismaClient } from "@prisma/client";
import { publishPipelineItems } from "../lib/pipeline/publish";
import {
  COMPOSE_DEFAULT_MODEL,
  composeNewsletterEdition,
} from "../lib/pipeline/compose-edition";
import { composeNewsletterEditionScript } from "../lib/pipeline/compose-edition-script";
import { runRetentionAfterPublish } from "./pipeline-retention";
import {
  assertRequiredEnv,
  formatRuntimeTimestamp,
  getDateKeyInJst,
  parsePositiveInt,
  PROD_RUNTIME_TIMEZONE,
  toPipelineDateUtc,
  validateDateKeyJst,
} from "./prod-schedule-utils";
import { sendHeartbeat, sendOpsAlert } from "../lib/ops-alert";
import { runStep4RepairBeforePublish } from "../lib/pipeline/step5-repair";

type ComposeMode = "llm" | "script";

type ComposeResult =
  | Awaited<ReturnType<typeof composeNewsletterEdition>>
  | Awaited<ReturnType<typeof composeNewsletterEditionScript>>;

interface CliOptions {
  dryRun: boolean;
  skipCompose: boolean;
  dateKeyJst: string;
  limit: number;
  step4RepairLimit: number;
  step4RepairMaxBatches?: number;
  composeModel: string;
  composeMode: ComposeMode;
}

function resolveComposeMode(raw: string | undefined): ComposeMode {
  const normalized = (raw || "llm").trim().toLowerCase();
  if (normalized === "script") return "script";
  return "llm";
}

function parseOptionalPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    skipCompose: false,
    dateKeyJst: getDateKeyInJst(),
    limit: parsePositiveInt(process.env.STEP5_PUBLISH_LIMIT, 120),
    step4RepairLimit: parsePositiveInt(process.env.STEP4_CROSSLINK_LIMIT, 600),
    step4RepairMaxBatches: parseOptionalPositiveInt(process.env.STEP4_CROSSLINK_MAX_BATCHES),
    composeModel: process.env.STEP5_COMPOSE_MODEL || COMPOSE_DEFAULT_MODEL,
    composeMode: resolveComposeMode(process.env.STEP5_COMPOSE_MODE),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (token === "--skip-compose") {
      options.skipCompose = true;
      continue;
    }

    if (token.startsWith("--date-jst=")) {
      options.dateKeyJst = validateDateKeyJst(token.split("=", 2)[1] || "");
      continue;
    }

    if (token === "--date-jst" || token === "--date") {
      options.dateKeyJst = validateDateKeyJst(argv[i + 1] || "");
      i += 1;
      continue;
    }

    if (token.startsWith("--limit=")) {
      options.limit = parsePositiveInt(token.split("=", 2)[1], options.limit);
      continue;
    }

    if (token === "--limit") {
      options.limit = parsePositiveInt(argv[i + 1], options.limit);
      i += 1;
      continue;
    }

    if (token.startsWith("--compose-model=")) {
      options.composeModel = token.split("=", 2)[1] || options.composeModel;
      continue;
    }

    if (token === "--compose-model") {
      options.composeModel = argv[i + 1] || options.composeModel;
      i += 1;
      continue;
    }

    if (token.startsWith("--compose-mode=")) {
      options.composeMode = resolveComposeMode(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--compose-mode") {
      options.composeMode = resolveComposeMode(argv[i + 1]);
      i += 1;
      continue;
    }
  }

  return options;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

async function main() {
  const startedAt = new Date();
  const options = parseArgs(process.argv.slice(2));
  const requiredEnv = ["DATABASE_URL"];

  if (!options.skipCompose && !options.dryRun && options.composeMode === "llm") {
    requiredEnv.push("OPENROUTER_API_KEY");
  }

  assertRequiredEnv(requiredEnv);

  console.log(
    `[prod-step5] start=${formatRuntimeTimestamp(startedAt)} tz=${PROD_RUNTIME_TIMEZONE} dateJst=${options.dateKeyJst} composeMode=${options.composeMode}`,
  );

  const prisma = new PrismaClient();
  try {
    const editionDate = toPipelineDateUtc(options.dateKeyJst);
    const step4Repair = options.dryRun
      ? null
      : await runStep4RepairBeforePublish(prisma, {
          editionDate,
          apiKey: process.env.OPENROUTER_API_KEY,
          limit: options.step4RepairLimit,
          maxBatches: options.step4RepairMaxBatches,
          logger: console,
        });

    const step5 = await publishPipelineItems(prisma, {
      dryRun: options.dryRun,
      limit: options.limit,
      editionDate,
      logger: console,
    });

    let compose: ComposeResult | null = null;
    let composeSkippedReason: string | null = null;

    if (!options.skipCompose) {
      if (!step5.edition.id) {
        composeSkippedReason = options.dryRun
          ? "compose skipped: no persisted edition in dry-run (run without --dry-run to generate binding records first)"
          : "compose skipped: publish step returned no edition id";
        console.warn(`[step5] ${composeSkippedReason}`);
      } else if (options.composeMode === "script") {
        compose = await composeNewsletterEditionScript(prisma, {
          dryRun: options.dryRun,
          editionId: step5.edition.id,
          logger: console,
        });
      } else {
        compose = await composeNewsletterEdition(prisma, {
          dryRun: options.dryRun,
          editionId: step5.edition.id,
          model: options.composeModel,
          logger: console,
        });
      }
    }

    const finishedAt = new Date();

    console.log("\n=== Production Step5 summary ===");
    console.log(
      JSON.stringify(
        {
          dateJst: options.dateKeyJst,
          dryRun: options.dryRun,
          runtime: {
            timeZone: PROD_RUNTIME_TIMEZONE,
            startedAt: formatRuntimeTimestamp(startedAt),
            finishedAt: formatRuntimeTimestamp(finishedAt),
          },
          limit: options.limit,
          skipCompose: options.skipCompose,
          composeMode: options.composeMode,
          composeModel: options.composeModel,
          step4Repair,
          publish: {
            metrics: step5.counter,
            edition: step5.edition,
          },
          compose,
          composeSkippedReason,
        },
        null,
        2,
      ),
    );

    if (!options.dryRun && step5.counter.clamped) {
      await sendOpsAlert(
        `[prod-step5] status=warn at ${finishedAt.toISOString()} dateJst=${options.dateKeyJst} reasons=publish counter.clamped=true (main-window rows exceeded 2000)`,
      );
    }

    await runRetentionAfterPublish(prisma);
    // Deadman only reports a publish that actually produced an edition;
    // dry-runs and empty publishes must not look healthy.
    if (!options.dryRun && step5.edition.id) {
      await sendHeartbeat(process.env.HEARTBEAT_URL_STEP5, "prod-step5");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    // Exit explicitly: lingering keep-alive handles can keep the event loop
    // alive after a successful run, which leaves the Railway cron container
    // running and blocks every subsequent scheduled fire (#65). Exit inside a
    // stdout drain callback so the summary JSON is not truncated on pipes,
    // with a failsafe timer in case the callback never fires (broken pipe).
    const failsafe = setTimeout(() => process.exit(0), 5000);
    process.stdout.write("", () => {
      clearTimeout(failsafe);
      process.exit(0);
    });
  })
  .catch(async (error) => {
    console.error("Fatal step5 error:", error);
    try {
      await sendOpsAlert(
        `[run-prod-step5.ts] fatal error at ${new Date().toISOString()}\n${errorMessage(error)}`,
      );
    } finally {
      process.exit(1);
    }
  });
