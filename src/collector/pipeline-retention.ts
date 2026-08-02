import { Prisma, PrismaClient } from "@prisma/client";
import { assertRequiredEnv } from "./prod-schedule-utils";

const BATCH_SIZE = 1000;
const DEFAULT_RAW_DAYS = 7;
const DEFAULT_PIPELINE_DAYS = 30;
const DEFAULT_OPS_DAYS = 30;
const MIN_PIPELINE_DAYS = 28;

export type RetentionMode = "dry-run" | "apply";

interface LoggerLike {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

interface RetentionOptions {
  mode: RetentionMode;
  rawDays?: number;
  pipelineDays?: number;
  opsDays?: number;
  now?: Date;
  logger?: LoggerLike;
}

export interface RetentionResult {
  mode: RetentionMode;
  rawDeleted: Record<string, number>;
  pipelineDeleted: number;
  opsDeleted: number;
  bindingsBefore: number;
  bindingsAfter: number;
  editionsBefore: number;
  editionsAfter: number;
  durationMs: number;
}

interface BatchDeleteOptions<Id extends string | number> {
  table: string;
  selectIds: (take: number) => Promise<Id[]>;
  deleteIds: (ids: Id[]) => Promise<number>;
  logger?: LoggerLike;
  batchSize?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function subtractDays(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function parseRetentionDays(
  name: string,
  value: number | undefined,
  fallback: number,
  logger: LoggerLike,
): number {
  if (value !== undefined && Number.isInteger(value) && value > 0) return value;

  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    logger.warn(`[retention] WARN ${name}=${raw} is invalid; using ${fallback}`);
    return fallback;
  }
  return parsed;
}

function resolvePipelineDays(
  value: number | undefined,
  logger: LoggerLike,
): number {
  const parsed = parseRetentionDays(
    "RETENTION_PIPELINE_DAYS",
    value,
    DEFAULT_PIPELINE_DAYS,
    logger,
  );
  if (parsed >= MIN_PIPELINE_DAYS) return parsed;

  logger.warn(
    `[retention] WARN RETENTION_PIPELINE_DAYS=${parsed} is below the 28-day trust-score window; clamped to ${MIN_PIPELINE_DAYS}`,
  );
  return MIN_PIPELINE_DAYS;
}

export function unboundPipelineWhere(
  cutoff: Date,
): Prisma.PipelineItemWhereInput {
  return {
    createdAt: { lt: cutoff },
    newsletterBindings: { none: {} },
  };
}

export async function deleteInIdBatches<Id extends string | number>(
  options: BatchDeleteOptions<Id>,
): Promise<number> {
  const logger = options.logger || console;
  const batchSize = Math.min(options.batchSize || BATCH_SIZE, BATCH_SIZE);
  let deleted = 0;
  let batchNumber = 0;

  while (true) {
    const ids = await options.selectIds(batchSize);
    if (ids.length === 0) break;
    if (ids.length > batchSize) {
      throw new Error(
        `${options.table} selected ${ids.length} ids, exceeding batch size ${batchSize}`,
      );
    }

    const batchDeleted = await options.deleteIds(ids);
    if (batchDeleted === 0) {
      throw new Error(
        `${options.table} selected ${ids.length} ids but deleted 0; aborting to prevent an infinite loop`,
      );
    }

    batchNumber += 1;
    deleted += batchDeleted;
    logger.log(
      `[retention] table=${options.table} batch=${batchNumber} selected=${ids.length} deleted=${batchDeleted} totalDeleted=${deleted}`,
    );
  }

  logger.log(`[retention] table=${options.table} deleted=${deleted}`);
  return deleted;
}

async function pruneTable<Id extends string | number>(options: {
  mode: RetentionMode;
  table: string;
  count: () => Promise<number>;
  selectIds: (take: number) => Promise<Id[]>;
  deleteIds: (ids: Id[]) => Promise<number>;
  logger: LoggerLike;
}): Promise<number> {
  if (options.mode === "dry-run") {
    const count = await options.count();
    options.logger.log(`[retention] table=${options.table} wouldDelete=${count}`);
    return count;
  }

  return deleteInIdBatches({
    table: options.table,
    selectIds: options.selectIds,
    deleteIds: options.deleteIds,
    logger: options.logger,
  });
}

async function pruneRawTables(
  prisma: PrismaClient,
  cutoff: Date,
  mode: RetentionMode,
  logger: LoggerLike,
): Promise<Record<string, number>> {
  const rawDeleted: Record<string, number> = {};

  rawDeleted.Tweet = await pruneTable({
    mode,
    table: "Tweet",
    count: () => prisma.tweet.count({ where: { fetchedAt: { lt: cutoff } } }),
    selectIds: async (take) =>
      (
        await prisma.tweet.findMany({
          where: { fetchedAt: { lt: cutoff } },
          select: { tweetId: true },
          orderBy: { tweetId: "asc" },
          take,
        })
      ).map((row) => row.tweetId),
    deleteIds: async (ids) =>
      (
        await prisma.tweet.deleteMany({
          where: { tweetId: { in: ids }, fetchedAt: { lt: cutoff } },
        })
      ).count,
    logger,
  });

  rawDeleted.FbPost = await pruneTable({
    mode,
    table: "FbPost",
    count: () => prisma.fbPost.count({ where: { fetchedAt: { lt: cutoff } } }),
    selectIds: async (take) =>
      (
        await prisma.fbPost.findMany({
          where: { fetchedAt: { lt: cutoff } },
          select: { postId: true },
          orderBy: { postId: "asc" },
          take,
        })
      ).map((row) => row.postId),
    deleteIds: async (ids) =>
      (
        await prisma.fbPost.deleteMany({
          where: { postId: { in: ids }, fetchedAt: { lt: cutoff } },
        })
      ).count,
    logger,
  });

  rawDeleted.RedditPost = await pruneTable({
    mode,
    table: "RedditPost",
    count: () => prisma.redditPost.count({ where: { fetchedAt: { lt: cutoff } } }),
    selectIds: async (take) =>
      (
        await prisma.redditPost.findMany({
          where: { fetchedAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: "asc" },
          take,
        })
      ).map((row) => row.id),
    deleteIds: async (ids) =>
      (
        await prisma.redditPost.deleteMany({
          where: { id: { in: ids }, fetchedAt: { lt: cutoff } },
        })
      ).count,
    logger,
  });

  rawDeleted.QiitaItem = await pruneTable({
    mode,
    table: "QiitaItem",
    count: () => prisma.qiitaItem.count({ where: { fetchedAt: { lt: cutoff } } }),
    selectIds: async (take) =>
      (
        await prisma.qiitaItem.findMany({
          where: { fetchedAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: "asc" },
          take,
        })
      ).map((row) => row.id),
    deleteIds: async (ids) =>
      (
        await prisma.qiitaItem.deleteMany({
          where: { id: { in: ids }, fetchedAt: { lt: cutoff } },
        })
      ).count,
    logger,
  });

  rawDeleted.GhItem = await pruneTable({
    mode,
    table: "GhItem",
    count: () => prisma.ghItem.count({ where: { fetchedAt: { lt: cutoff } } }),
    selectIds: async (take) =>
      (
        await prisma.ghItem.findMany({
          where: { fetchedAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: "asc" },
          take,
        })
      ).map((row) => row.id),
    deleteIds: async (ids) =>
      (
        await prisma.ghItem.deleteMany({
          where: { id: { in: ids }, fetchedAt: { lt: cutoff } },
        })
      ).count,
    logger,
  });

  rawDeleted.IgPost = await pruneTable({
    mode,
    table: "IgPost",
    count: () => prisma.igPost.count({ where: { fetchedAt: { lt: cutoff } } }),
    selectIds: async (take) =>
      (
        await prisma.igPost.findMany({
          where: { fetchedAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: "asc" },
          take,
        })
      ).map((row) => row.id),
    deleteIds: async (ids) =>
      (
        await prisma.igPost.deleteMany({
          where: { id: { in: ids }, fetchedAt: { lt: cutoff } },
        })
      ).count,
    logger,
  });

  rawDeleted.AlertEntry = await pruneTable({
    mode,
    table: "AlertEntry",
    count: () => prisma.alertEntry.count({ where: { fetchedAt: { lt: cutoff } } }),
    selectIds: async (take) =>
      (
        await prisma.alertEntry.findMany({
          where: { fetchedAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: "asc" },
          take,
        })
      ).map((row) => row.id),
    deleteIds: async (ids) =>
      (
        await prisma.alertEntry.deleteMany({
          where: { id: { in: ids }, fetchedAt: { lt: cutoff } },
        })
      ).count,
    logger,
  });

  return rawDeleted;
}

async function prunePipelineItems(
  prisma: PrismaClient,
  cutoff: Date,
  mode: RetentionMode,
  logger: LoggerLike,
): Promise<number> {
  if (mode === "dry-run") {
    const where = unboundPipelineWhere(cutoff);
    const [pipelineCount, voiceSignalCount] = await Promise.all([
      prisma.pipelineItem.count({ where }),
      // editionId != null signals are newsletter materials (compose reads them by
      // editionId) — never deleted; the item delete only SetNulls their item link.
      prisma.voiceSignal.count({ where: { editionId: null, pipelineItem: { is: where } } }),
    ]);
    logger.log(`[retention] table=VoiceSignal wouldDelete=${voiceSignalCount}`);
    logger.log(`[retention] table=PipelineItem wouldDelete=${pipelineCount}`);
    return pipelineCount;
  }

  let deleted = 0;
  let voiceSignalsDeleted = 0;
  let batchNumber = 0;

  while (true) {
    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.pipelineItem.findMany({
        where: unboundPipelineWhere(cutoff),
        select: { id: true },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) return null;

      const ids = rows.map((row) => row.id);
      let voiceSignalsDeletedInBatch = 0;
      while (true) {
        const voiceSignals = await tx.voiceSignal.findMany({
          where: {
            editionId: null,
            pipelineItemId: { in: ids },
            pipelineItem: { is: unboundPipelineWhere(cutoff) },
          },
          select: { id: true },
          orderBy: { id: "asc" },
          take: BATCH_SIZE,
        });
        if (voiceSignals.length === 0) break;

        const deletedVoiceSignals = await tx.voiceSignal.deleteMany({
          where: {
            id: { in: voiceSignals.map((row) => row.id) },
            editionId: null,
            pipelineItem: { is: unboundPipelineWhere(cutoff) },
          },
        });
        if (deletedVoiceSignals.count === 0) {
          throw new Error(
            `VoiceSignal selected ${voiceSignals.length} ids but deleted 0; rolling back batch`,
          );
        }
        voiceSignalsDeletedInBatch += deletedVoiceSignals.count;
      }
      const pipelineItems = await tx.pipelineItem.deleteMany({
        where: {
          id: { in: ids },
          ...unboundPipelineWhere(cutoff),
        },
      });

      if (pipelineItems.count !== ids.length) {
        throw new Error(
          `PipelineItem selected ${ids.length} ids but deleted ${pipelineItems.count}; rolling back batch to protect newly bound content`,
        );
      }

      return {
        selected: ids.length,
        pipelineItems: pipelineItems.count,
        voiceSignals: voiceSignalsDeletedInBatch,
      };
    });

    if (!result) break;
    batchNumber += 1;
    deleted += result.pipelineItems;
    voiceSignalsDeleted += result.voiceSignals;
    logger.log(
      `[retention] table=PipelineItem batch=${batchNumber} selected=${result.selected} deleted=${result.pipelineItems} totalDeleted=${deleted}`,
    );
    logger.log(
      `[retention] table=VoiceSignal batch=${batchNumber} deleted=${result.voiceSignals} totalDeleted=${voiceSignalsDeleted}`,
    );
  }

  logger.log(`[retention] table=VoiceSignal deleted=${voiceSignalsDeleted}`);
  logger.log(`[retention] table=PipelineItem deleted=${deleted}`);
  return deleted;
}

async function pruneOpsTables(
  prisma: PrismaClient,
  cutoff: Date,
  mode: RetentionMode,
  logger: LoggerLike,
): Promise<number> {
  const pipelineRunDeleted = await pruneTable({
    mode,
    table: "PipelineRun",
    count: () => prisma.pipelineRun.count({ where: { createdAt: { lt: cutoff } } }),
    selectIds: async (take) =>
      (
        await prisma.pipelineRun.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: "asc" },
          take,
        })
      ).map((row) => row.id),
    deleteIds: async (ids) =>
      (
        await prisma.pipelineRun.deleteMany({
          where: { id: { in: ids }, createdAt: { lt: cutoff } },
        })
      ).count,
    logger,
  });

  const orModelEventDeleted = await pruneTable({
    mode,
    table: "OrModelEvent",
    count: () => prisma.orModelEvent.count({ where: { detectedAt: { lt: cutoff } } }),
    selectIds: async (take) =>
      (
        await prisma.orModelEvent.findMany({
          where: { detectedAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: "asc" },
          take,
        })
      ).map((row) => row.id),
    deleteIds: async (ids) =>
      (
        await prisma.orModelEvent.deleteMany({
          where: { id: { in: ids }, detectedAt: { lt: cutoff } },
        })
      ).count,
    logger,
  });

  const crosslinkDeleted = await pruneTable({
    mode,
    table: "PipelineCrosslinkLlmDecision",
    count: () =>
      prisma.pipelineCrosslinkLlmDecision.count({ where: { createdAt: { lt: cutoff } } }),
    selectIds: async (take) =>
      (
        await prisma.pipelineCrosslinkLlmDecision.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { id: "asc" },
          take,
        })
      ).map((row) => row.id),
    deleteIds: async (ids) =>
      (
        await prisma.pipelineCrosslinkLlmDecision.deleteMany({
          where: { id: { in: ids }, createdAt: { lt: cutoff } },
        })
      ).count,
    logger,
  });

  return pipelineRunDeleted + orModelEventDeleted + crosslinkDeleted;
}

export async function runPipelineRetention(
  prisma: PrismaClient,
  options: RetentionOptions,
): Promise<RetentionResult> {
  const logger = options.logger || console;
  const startedMs = Date.now();
  const now = options.now || new Date();
  const rawDays = parseRetentionDays(
    "RETENTION_RAW_DAYS",
    options.rawDays,
    DEFAULT_RAW_DAYS,
    logger,
  );
  const pipelineDays = resolvePipelineDays(options.pipelineDays, logger);
  const opsDays = parseRetentionDays(
    "RETENTION_OPS_DAYS",
    options.opsDays,
    DEFAULT_OPS_DAYS,
    logger,
  );

  logger.log(
    `[retention] start mode=${options.mode} rawDays=${rawDays} pipelineDays=${pipelineDays} opsDays=${opsDays} batchSize=${BATCH_SIZE}`,
  );

  const [bindingsBefore, editionsBefore] = await Promise.all([
    prisma.newsletterBinding.count(),
    prisma.newsletterEdition.count(),
  ]);

  const rawDeleted = await pruneRawTables(
    prisma,
    subtractDays(now, rawDays),
    options.mode,
    logger,
  );
  const pipelineDeleted = await prunePipelineItems(
    prisma,
    subtractDays(now, pipelineDays),
    options.mode,
    logger,
  );
  const opsDeleted = await pruneOpsTables(
    prisma,
    subtractDays(now, opsDays),
    options.mode,
    logger,
  );

  const [bindingsAfter, editionsAfter] =
    options.mode === "apply"
      ? await Promise.all([
          prisma.newsletterBinding.count(),
          prisma.newsletterEdition.count(),
        ])
      : [bindingsBefore, editionsBefore];

  const durationMs = Date.now() - startedMs;
  const result: RetentionResult = {
    mode: options.mode,
    rawDeleted,
    pipelineDeleted,
    opsDeleted,
    bindingsBefore,
    bindingsAfter,
    editionsBefore,
    editionsAfter,
    durationMs,
  };

  if (
    options.mode === "apply" &&
    (bindingsBefore !== bindingsAfter || editionsBefore !== editionsAfter)
  ) {
    throw new Error(
      `RETENTION SAFETY ASSERTION FAILED: NewsletterBinding ${bindingsBefore}->${bindingsAfter}, NewsletterEdition ${editionsBefore}->${editionsAfter}`,
    );
  }

  logger.log(
    `[retention] mode=${result.mode} rawDeleted=${JSON.stringify(result.rawDeleted)} pipelineDeleted=${result.pipelineDeleted} opsDeleted=${result.opsDeleted} bindingsBefore=${result.bindingsBefore} bindingsAfter=${result.bindingsAfter} durationMs=${result.durationMs}`,
  );

  return result;
}

function cliMode(argv: string[]): RetentionMode {
  let explicit: RetentionMode | undefined;
  for (const token of argv) {
    if (token === "--dry-run") explicit = "dry-run";
    if (token === "--apply") explicit = "apply";
  }
  if (explicit) return explicit;
  // Standalone CLI is always dry-run unless --apply is passed explicitly.
  // RETENTION_MODE only drives the Step5 hook — an env set to "apply" for the
  // cron must not turn a manual count-check into a live delete.
  return "dry-run";
}

export async function runRetentionAfterPublish(
  prisma: PrismaClient,
  logger: LoggerLike = console,
): Promise<void> {
  const configured = process.env.RETENTION_MODE;
  if (configured !== "dry-run" && configured !== "apply") {
    logger.log("[retention] skipped (RETENTION_MODE unset)");
    return;
  }

  try {
    await runPipelineRetention(prisma, { mode: configured, logger });
  } catch (error) {
    logger.error(`[retention] FAILED: ${errorMessage(error)}`);
  }
}

async function main(): Promise<void> {
  assertRequiredEnv(["DATABASE_URL"]);
  const prisma = new PrismaClient();
  try {
    await runPipelineRetention(prisma, {
      mode: cliMode(process.argv.slice(2)),
      logger: console,
    });
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[retention] FAILED: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
