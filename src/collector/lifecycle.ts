import { Prisma, PrismaClient, Source } from "@prisma/client";

export const COOLDOWN_DAYS = 30;

const MIN_SOURCE_AGE_DAYS = 14;
const MIN_CLASSIFIED_ITEMS_28D = 20;
const DEMOTE_MIN_AGE_DAYS = 6;
const DEMOTE_MAX_AGE_DAYS = 8;
const NOISE_MATERIALITY_DELTA = 0.15;
const MIN_MATERIAL_NOISE_RATE = 0.35;
const SEVERE_NOISE_RATE = 0.85;

type Logger = Pick<Console, "log" | "warn" | "error">;
type DemotionEventClient = Pick<PrismaClient, "sourceDemotionEvent">;

interface LifecycleOptions {
  dryRun?: boolean;
  logger?: Logger;
}

interface LifecycleResult {
  dryRun: boolean;
  scanned: number;
  eligible: number;
  flagged: number;
  deactivated: number;
  awaitingSecondWindow: number;
  skipped: number;
  actions: Array<{
    sourceId: number;
    handle: string;
    action: "demote" | "deactivate" | "skip";
    reason: string;
  }>;
}

interface RestoreOptions {
  sourceId: number;
  reason?: string;
  actor?: string;
  logger?: Logger;
}

interface QualitySnapshot {
  classifiedItemCount28: number;
  classificationCount28: number;
  noiseCount28: number;
  noiseRate: number | null;
  priorityScore: number | null;
  trustScore: number | null;
  trustLabel: string | null;
  qualityMetrics: Prisma.JsonValue;
}

interface LifecycleDecision {
  shouldAct: boolean;
  reason: string;
  conditionKeys: string[];
  severe: boolean;
  snapshot: QualitySnapshot & {
    thresholds: {
      medianNoiseRate: number | null;
      priorityBottomDecile: number | null;
      noiseMaterialityDelta: number;
      minimumMaterialNoiseRate: number;
    };
  };
}

function daysAgo(base: Date, days: number): Date {
  return new Date(base.getTime() - days * 24 * 60 * 60 * 1000);
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberAt(root: unknown, path: string[]): number | null {
  let current: unknown = root;
  for (const key of path) {
    const obj = asObject(current);
    if (!obj) return null;
    current = obj[key];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function stringArrayAt(root: unknown, path: string[]): string[] {
  let current: unknown = root;
  for (const key of path) {
    const obj = asObject(current);
    if (!obj) return [];
    current = obj[key];
  }
  return Array.isArray(current)
    ? current.filter((value): value is string => typeof value === "string")
    : [];
}

function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function median(values: number[]): number | null {
  return percentile(values, 0.5);
}

function readSnapshot(source: Pick<Source, "qualityMetrics" | "trustScore" | "trustLabel">): QualitySnapshot {
  const metrics = source.qualityMetrics;
  const classifiedItemCount28 = numberAt(metrics, ["counts", "classifiedItemCount28"]) ?? 0;
  const classificationCount28 = numberAt(metrics, ["counts", "classificationCount28"]) ?? 0;
  const noiseCount28 = numberAt(metrics, ["counts", "noiseCount28"]) ?? 0;
  const priorityScore = numberAt(metrics, ["signals", "selectionValue", "priorityScore"]);
  const noiseRate = classificationCount28 > 0 ? noiseCount28 / classificationCount28 : null;

  return {
    classifiedItemCount28,
    classificationCount28,
    noiseCount28,
    noiseRate,
    priorityScore,
    trustScore: source.trustScore,
    trustLabel: source.trustLabel,
    qualityMetrics: metrics,
  };
}

function buildMetricsSnapshot(
  source: Pick<Source, "id" | "handle" | "type" | "active" | "createdAt">,
  decision: LifecycleDecision,
): Prisma.InputJsonObject {
  return {
    source: {
      id: source.id,
      handle: source.handle,
      type: source.type,
      active: source.active,
      createdAt: source.createdAt.toISOString(),
    },
    trustScore: decision.snapshot.trustScore,
    trustLabel: decision.snapshot.trustLabel,
    qualityMetrics: decision.snapshot.qualityMetrics as Prisma.InputJsonValue,
    lifecycle: {
      reason: decision.reason,
      conditionKeys: decision.conditionKeys,
      severe: decision.severe,
      classifiedItemCount28: decision.snapshot.classifiedItemCount28,
      classificationCount28: decision.snapshot.classificationCount28,
      noiseCount28: decision.snapshot.noiseCount28,
      noiseRate: decision.snapshot.noiseRate,
      priorityScore: decision.snapshot.priorityScore,
      thresholds: decision.snapshot.thresholds,
    },
  };
}

function stableReason(conditionKeys: string[]): string {
  return `lifecycle:${conditionKeys.join("+")}`;
}

function conditionKeysFromReason(reason: string): string[] {
  return reason.startsWith("lifecycle:")
    ? reason.slice("lifecycle:".length).split("+").filter(Boolean)
    : [];
}

function conditionKeysFromDemotionEvent(event: {
  reason: string;
  metricsSnapshot: Prisma.JsonValue;
}): string[] {
  const snapshotKeys = stringArrayAt(event.metricsSnapshot, ["lifecycle", "conditionKeys"]);
  return snapshotKeys.length > 0 ? snapshotKeys : conditionKeysFromReason(event.reason);
}

function sharesConditionKeys(
  previousDemote: { reason: string; metricsSnapshot: Prisma.JsonValue } | null,
  currentKeys: string[],
): boolean {
  if (!previousDemote || currentKeys.length === 0) return false;
  const current = new Set(currentKeys);
  return conditionKeysFromDemotionEvent(previousDemote).some((key) => current.has(key));
}

function decideLifecycle(
  source: Source,
  now: Date,
  thresholds: { medianNoiseRate: number | null; priorityBottomDecile: number | null },
): LifecycleDecision {
  const snapshot = readSnapshot(source);
  const sourceAgeCutoff = daysAgo(now, MIN_SOURCE_AGE_DAYS);

  const conditionKeys: string[] = [];
  const noisy =
    snapshot.noiseRate !== null &&
    thresholds.medianNoiseRate !== null &&
    snapshot.noiseRate >= MIN_MATERIAL_NOISE_RATE &&
    snapshot.noiseRate >= thresholds.medianNoiseRate + NOISE_MATERIALITY_DELTA;
  const lowPriority =
    snapshot.priorityScore !== null &&
    thresholds.priorityBottomDecile !== null &&
    snapshot.priorityScore <= thresholds.priorityBottomDecile;
  const lowTrust = typeof snapshot.trustScore === "number" && snapshot.trustScore < 45;

  if (noisy) conditionKeys.push("noisy");
  if (lowPriority) conditionKeys.push("low_priority");
  if (lowTrust) conditionKeys.push("low_trust");

  const baseEligible =
    source.type === "discovered" &&
    source.active &&
    (!source.cooldownUntil || source.cooldownUntil <= now) &&
    source.createdAt < sourceAgeCutoff &&
    snapshot.classifiedItemCount28 >= MIN_CLASSIFIED_ITEMS_28D;

  const shouldAct = baseEligible && conditionKeys.length > 0;
  const reason = stableReason(conditionKeys);

  return {
    shouldAct,
    reason,
    conditionKeys,
    severe: (snapshot.noiseRate ?? 0) >= SEVERE_NOISE_RATE,
    snapshot: {
      ...snapshot,
      thresholds: {
        medianNoiseRate: thresholds.medianNoiseRate,
        priorityBottomDecile: thresholds.priorityBottomDecile,
        noiseMaterialityDelta: NOISE_MATERIALITY_DELTA,
        minimumMaterialNoiseRate: MIN_MATERIAL_NOISE_RATE,
      },
    },
  };
}

async function writeDemotionEvent(
  prisma: DemotionEventClient,
  input: {
    source: Source;
    action: "demote" | "deactivate";
    reason: string;
    decision: LifecycleDecision;
  },
) {
  await prisma.sourceDemotionEvent.create({
    data: {
      sourceId: input.source.id,
      action: input.action,
      reason: input.reason,
      metricsSnapshot: buildMetricsSnapshot(input.source, input.decision),
    },
  });
}

export async function applySourceLifecycle(
  prisma: PrismaClient,
  options: LifecycleOptions = {},
): Promise<LifecycleResult> {
  const logger = options.logger || console;
  const dryRun = Boolean(options.dryRun);
  const now = new Date();

  const sources = await prisma.source.findMany({
    where: {
      type: "discovered",
      active: true,
    },
    orderBy: { handle: "asc" },
  });

  const metricSnapshots = sources.map((source) => ({ source, snapshot: readSnapshot(source) }));
  const eligibleMetricSnapshots = metricSnapshots.filter(
    ({ snapshot }) => snapshot.classifiedItemCount28 >= MIN_CLASSIFIED_ITEMS_28D,
  );
  const medianNoiseRate = median(
    eligibleMetricSnapshots
      .map(({ snapshot }) => snapshot.noiseRate)
      .filter((value): value is number => value !== null),
  );
  const priorityBottomDecile = percentile(
    eligibleMetricSnapshots
      .map(({ snapshot }) => snapshot.priorityScore)
      .filter((value): value is number => value !== null),
    0.1,
  );

  const result: LifecycleResult = {
    dryRun,
    scanned: sources.length,
    eligible: 0,
    flagged: 0,
    deactivated: 0,
    awaitingSecondWindow: 0,
    skipped: 0,
    actions: [],
  };

  for (const source of sources) {
    const decision = decideLifecycle(source, now, { medianNoiseRate, priorityBottomDecile });
    if (!decision.shouldAct) {
      result.skipped += 1;
      continue;
    }

    result.eligible += 1;

    const latestResetEvent = await prisma.sourceDemotionEvent.findFirst({
      where: {
        sourceId: source.id,
        action: { in: ["restore", "deactivate"] },
      },
      orderBy: { at: "desc" },
    });
    const previousDemote = await prisma.sourceDemotionEvent.findFirst({
      where: {
        sourceId: source.id,
        action: "demote",
        ...(latestResetEvent ? { at: { gt: latestResetEvent.at } } : {}),
      },
      orderBy: { at: "desc" },
    });

    const sharedCondition = sharesConditionKeys(previousDemote, decision.conditionKeys);
    const demoteAgeMs = previousDemote ? now.getTime() - previousDemote.at.getTime() : null;
    const demoteAgeDays = demoteAgeMs === null ? null : demoteAgeMs / (24 * 60 * 60 * 1000);
    const inSecondWindow =
      sharedCondition &&
      demoteAgeDays !== null &&
      demoteAgeDays >= DEMOTE_MIN_AGE_DAYS &&
      demoteAgeDays <= DEMOTE_MAX_AGE_DAYS;

    if (inSecondWindow) {
      let deactivated = true;
      if (!dryRun) {
        deactivated = await prisma.$transaction(async (tx) => {
          const updated = await tx.source.updateMany({
            where: { id: source.id, type: "discovered", active: true },
            data: {
              active: false,
              deactivatedAt: now,
              deactivationReason: decision.reason,
              cooldownUntil: addDays(now, COOLDOWN_DAYS),
              ...(decision.severe ? { trustLabel: "blocked" } : {}),
            },
          });
          if (updated.count !== 1) return false;
          await writeDemotionEvent(tx, {
            source,
            action: "deactivate",
            reason: decision.reason,
            decision,
          });
          return true;
        });
      }
      if (!deactivated) {
        result.skipped += 1;
        result.actions.push({
          sourceId: source.id,
          handle: source.handle,
          action: "skip",
          reason: `${decision.reason}:stale_deactivate_target`,
        });
        logger.warn(
          `[source-lifecycle] skip deactivate @${source.handle} reason=${decision.reason} target no longer active discovered`,
        );
        continue;
      }
      result.deactivated += 1;
      result.actions.push({
        sourceId: source.id,
        handle: source.handle,
        action: "deactivate",
        reason: decision.reason,
      });
      logger.warn(
        `[source-lifecycle] ${dryRun ? "dry-run " : ""}deactivate @${source.handle} reason=${decision.reason}`,
      );
      continue;
    }

    if (sharedCondition && demoteAgeDays !== null && demoteAgeDays < DEMOTE_MIN_AGE_DAYS) {
      result.awaitingSecondWindow += 1;
      result.actions.push({
        sourceId: source.id,
        handle: source.handle,
        action: "skip",
        reason: `${decision.reason}:awaiting_second_window`,
      });
      continue;
    }

    if (!dryRun) {
      await writeDemotionEvent(prisma, {
        source,
        action: "demote",
        reason: decision.reason,
        decision,
      });
    }
    result.flagged += 1;
    result.actions.push({
      sourceId: source.id,
      handle: source.handle,
      action: "demote",
      reason: decision.reason,
    });
    logger.warn(
      `[source-lifecycle] ${dryRun ? "dry-run " : ""}demote flag @${source.handle} reason=${decision.reason}`,
    );
  }

  logger.log(
    `[source-lifecycle] scanned=${result.scanned} eligible=${result.eligible} flagged=${result.flagged} deactivated=${result.deactivated} awaiting=${result.awaitingSecondWindow} dryRun=${result.dryRun}`,
  );

  return result;
}

export async function restoreSource(
  prisma: PrismaClient,
  options: RestoreOptions,
): Promise<Source> {
  const logger = options.logger || console;
  const source = await prisma.source.findUnique({ where: { id: options.sourceId } });
  if (!source) {
    throw new Error(`Source ${options.sourceId} not found`);
  }
  if (source.type !== "discovered") {
    throw new Error(`Source ${source.id} cannot be restored because it is not a discovered source`);
  }
  if (!source.deactivatedAt) {
    throw new Error(`Source ${source.id} cannot be restored because it has no lifecycle deactivation`);
  }

  const reason = options.reason || "human:restore";
  const cooldownUntil = addDays(new Date(), COOLDOWN_DAYS);
  const snapshot: Prisma.InputJsonObject = {
    source: {
      id: source.id,
      handle: source.handle,
      type: source.type,
      active: source.active,
      createdAt: source.createdAt.toISOString(),
      deactivatedAt: source.deactivatedAt?.toISOString() || null,
      deactivationReason: source.deactivationReason,
      cooldownUntil: source.cooldownUntil?.toISOString() || null,
    },
    trustScore: source.trustScore,
    trustLabel: source.trustLabel,
    qualityMetrics: source.qualityMetrics as Prisma.InputJsonValue,
    lifecycle: {
      action: "restore",
      actor: options.actor || "human",
    },
  };

  const restored = await prisma.$transaction(async (tx) => {
    const updated = await tx.source.update({
      where: { id: source.id },
      data: {
        active: true,
        deactivatedAt: null,
        deactivationReason: null,
        // Restored sources get a grace cooldown so the next lifecycle pass cannot re-deactivate them immediately.
        cooldownUntil,
        ...(source.trustLabel === "blocked" ? { trustLabel: "unknown" } : {}),
      },
    });
    await tx.sourceDemotionEvent.create({
      data: {
        sourceId: source.id,
        action: "restore",
        reason,
        metricsSnapshot: snapshot,
      },
    });
    return updated;
  });

  logger.log(`[source-lifecycle] restore @${source.handle} reason=${reason}`);
  return restored;
}
