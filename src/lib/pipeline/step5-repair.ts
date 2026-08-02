import { Prisma, PrismaClient } from "@prisma/client";
import {
  crosslinkPipelineItemsByLlm,
  FAILED_FALLBACK_INPUT_HASH_PREFIX,
} from "./crosslink-llm";
import { buildEditionWindow } from "./edition";
import { sendOpsAlert } from "../ops-alert";

type Logger = Pick<Console, "log" | "warn" | "error">;

export interface Step4RepairGate {
  windowItems: number;
  itemsWithDecision: number;
  sentinelItems: number;
  shouldRepair: boolean;
}

export interface Step4RepairResult {
  status: "not_needed" | "skipped_missing_api_key" | "repaired" | "failed";
  before: Step4RepairGate | null;
  after: Step4RepairGate | null;
  error?: string;
}

interface Step4RepairOptions {
  editionDate: Date;
  apiKey?: string;
  limit?: number;
  maxBatches?: number;
  logger?: Logger;
  crosslink?: typeof crosslinkPipelineItemsByLlm;
  alert?: typeof sendOpsAlert;
}

function buildEditionWindowWhere(editionDate: Date): Prisma.PipelineItemWhereInput {
  const window = buildEditionWindow(editionDate);
  return {
    normalizedAt: { not: null },
    OR: [
      {
        publishedAt: {
          gte: window.startUtc,
          lt: window.endUtcExclusive,
        },
      },
      {
        publishedAt: null,
        ingestedAt: {
          gte: window.startUtc,
          lt: window.endUtcExclusive,
        },
      },
    ],
  };
}

export function evaluateStep4RepairGate(
  rows: Array<{ crosslinkLlmDecisions: Array<{ inputHash: string }> }>,
): Step4RepairGate {
  let itemsWithDecision = 0;
  let sentinelItems = 0;

  for (const row of rows) {
    const latest = row.crosslinkLlmDecisions[0];
    if (!latest) continue;
    itemsWithDecision += 1;
    // Accepted edge: non-transient fallbacks keep clean hashes and are not
    // repaired. The sentinel is reserved for transient Step4 failures.
    if (latest.inputHash.startsWith(FAILED_FALLBACK_INPUT_HASH_PREFIX)) {
      sentinelItems += 1;
    }
  }

  return {
    windowItems: rows.length,
    itemsWithDecision,
    sentinelItems,
    // Do not fire merely because some items lack rows: Step4's bounded limit
    // can legitimately leave an over-capture tail. With actual window items,
    // total zero still signals a crashed Step4 run; an empty window is healthy.
    shouldRepair: rows.length > 0 && (sentinelItems > 0 || itemsWithDecision === 0),
  };
}

export async function inspectStep4RepairGate(
  prisma: PrismaClient,
  editionDate: Date,
): Promise<Step4RepairGate> {
  const rows = await prisma.pipelineItem.findMany({
    where: buildEditionWindowWhere(editionDate),
    select: {
      crosslinkLlmDecisions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { inputHash: true },
      },
    },
  });

  return evaluateStep4RepairGate(rows);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}

async function sendAlertFailSoft(
  alert: typeof sendOpsAlert,
  message: string,
  logger: Logger,
): Promise<void> {
  try {
    await alert(message, logger);
  } catch (error) {
    logger.error(`[prod-step5] unable to send Step4 repair alert: ${errorMessage(error)}`);
  }
}

export async function runStep4RepairBeforePublish(
  prisma: PrismaClient,
  options: Step4RepairOptions,
): Promise<Step4RepairResult> {
  const logger = options.logger || console;
  const crosslink = options.crosslink || crosslinkPipelineItemsByLlm;
  const alert = options.alert || sendOpsAlert;
  let before: Step4RepairGate;
  try {
    before = await inspectStep4RepairGate(prisma, options.editionDate);
  } catch (error) {
    const message = `[prod-step5] Step4 repair gate failed; continuing Step5: ${errorMessage(error)}`;
    logger.warn(message);
    await sendAlertFailSoft(alert, message, logger);
    return { status: "failed", before: null, after: null, error: errorMessage(error) };
  }

  if (!before.shouldRepair) {
    return { status: "not_needed", before, after: null };
  }

  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    const message =
      `[prod-step5] Step4 repair skipped: OPENROUTER_API_KEY is missing ` +
      `(windowItems=${before.windowItems} decisions=${before.itemsWithDecision} sentinels=${before.sentinelItems})`;
    logger.warn(message);
    await sendAlertFailSoft(alert, message, logger);
    return { status: "skipped_missing_api_key", before, after: null };
  }

  try {
    await crosslink(prisma, {
      apiKey,
      limit: options.limit,
      maxBatches: options.maxBatches,
      pendingOnly: true,
      logger,
    });

    const after = await inspectStep4RepairGate(prisma, options.editionDate);
    if (after.shouldRepair) {
      await sendAlertFailSoft(
        alert,
        `[prod-step5] Step4 repair left residual defects ` +
          `(windowItems=${after.windowItems} decisions=${after.itemsWithDecision} sentinels=${after.sentinelItems})`,
        logger,
      );
    }

    return { status: "repaired", before, after };
  } catch (error) {
    const message = `[prod-step5] Step4 repair failed; continuing Step5: ${errorMessage(error)}`;
    logger.warn(message);
    await sendAlertFailSoft(alert, message, logger);
    return { status: "failed", before, after: null, error: errorMessage(error) };
  }
}
