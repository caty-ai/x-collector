import { Prisma, PrismaClient } from "@prisma/client";

type SourceTrustOptions = {
  dryRun?: boolean;
  logger?: Pick<Console, "log" | "warn" | "error">;
};

type DbNumber = number | bigint | string | null;

type AggregationRow = {
  sourceId: number;
  handle: string;
  active: boolean;
  createdAt: Date;
  trustLabel: string;
  candidateAiScore: number | null;
  itemCount28: DbNumber;
  itemCount7: DbNumber;
  classificationCount28: DbNumber;
  classificationCount7: DbNumber;
  classifiedItemCount28: DbNumber;
  classifiedItemCount7: DbNumber;
  noiseCount28: DbNumber;
  adoptedItemCount28: DbNumber;
  meanClassificationScore: number | null;
  meanPriorityScore: number | null;
  meanOriginalityScore: number | null;
  latestItemAt: Date | null;
};

type SignalBreakdown = {
  raw: number;
  weight: number;
  contribution: number;
};

export type SourceTrustDetail = {
  sourceId: number;
  handle: string;
  trustScore: number;
  trustLabel: string;
  previousTrustLabel: string;
  coldStart: boolean;
  reason: string;
  signals: {
    itemQuality: SignalBreakdown;
    selectionValue: SignalBreakdown;
    prior: SignalBreakdown;
    freshness: SignalBreakdown;
  };
  rawSignals: {
    nonNoiseRate: number;
    meanClassificationScore: number;
    adoptionRate: number;
    priorityScore: number | null;
    priorScore: number;
    priorDecay: number;
    recencyScore: number;
    originalityScore: number;
  };
  counts: {
    itemCount7: number;
    itemCount28: number;
    classifiedItemCount7: number;
    classifiedItemCount28: number;
    classificationCount7: number;
    classificationCount28: number;
    adoptedItemCount28: number;
    noiseCount28: number;
  };
};

export type SourceTrustResult = {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  scored: number;
  written: number;
  labelCounts: Record<string, number>;
  medians: {
    adoptionRate: number | null;
    priorityScore: number | null;
    medianEligibleSourceCount: number;
  };
  details: SourceTrustDetail[];
};

const WINDOW_28_DAYS_MS = 28 * 24 * 60 * 60 * 1000;
const WINDOW_7_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_AGE_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const RECENTLY_DEACTIVATED_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_CLASSIFIED_ITEMS = 15;
const PRIOR_DECAY_CLASSIFIED_ITEMS = 50;

const ORIGINAL_WEIGHTS = {
  itemQuality: 0.45,
  selectionValue: 0.25,
  prior: 0.15,
  freshness: 0.05,
};

const WEIGHT_DENOMINATOR = Object.values(ORIGINAL_WEIGHTS).reduce((sum, value) => sum + value, 0);
// TODO(#52): reinstate corroboration term (10%) once cross-source verification ships
const BASE_WEIGHTS = {
  itemQuality: ORIGINAL_WEIGHTS.itemQuality / WEIGHT_DENOMINATOR,
  selectionValue: ORIGINAL_WEIGHTS.selectionValue / WEIGHT_DENOMINATOR,
  prior: ORIGINAL_WEIGHTS.prior / WEIGHT_DENOMINATOR,
  freshness: ORIGINAL_WEIGHTS.freshness / WEIGHT_DENOMINATOR,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function numberFromDb(value: DbNumber): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return value ?? 0;
}

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint];
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function relativeAboveMedian(value: number | null, medianValue: number | null): number {
  if (value === null || medianValue === null) return 0.5;
  const cleanValue = clamp01(value);
  const cleanMedian = clamp01(medianValue);
  if (cleanValue <= cleanMedian) return 0.5;
  if (cleanMedian >= 1) return 0.5;
  return clamp01(0.5 + 0.5 * ((cleanValue - cleanMedian) / (1 - cleanMedian)));
}

function normalizePercentScore(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return clamp01(value / 100);
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.max(0, (later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000));
}

function roundMetric(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function labelForScore(score: number): "high" | "medium" | "low" {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function buildReason(detail: {
  label: string;
  score: number;
  classifiedItemCount28: number;
  nonNoiseRate: number;
  adoptionRate: number;
  priorityScore: number | null;
  coldStart: boolean;
  blocked: boolean;
}): string {
  const parts = [
    `score ${detail.score}`,
    `${detail.classifiedItemCount28} classified items`,
    `${Math.round(detail.nonNoiseRate * 100)}% non-noise`,
    `${Math.round(detail.adoptionRate * 100)}% adoption`,
  ];

  if (detail.priorityScore !== null) {
    parts.push(`priority ${Math.round(detail.priorityScore * 100)}`);
  }

  if (detail.blocked) {
    parts.push("label preserved as blocked");
  } else if (detail.coldStart) {
    parts.push("cold-start label override");
  } else {
    parts.push(`label ${detail.label}`);
  }

  return parts.join("; ");
}

function toQualityMetrics(input: {
  detail: SourceTrustDetail;
  scoreTotal: number;
  windows: {
    startedAt: Date;
    window7Start: Date;
    window28Start: Date;
    finishedAt: Date;
  };
  medians: SourceTrustResult["medians"];
  weightsSum: number;
}): Prisma.InputJsonObject {
  const { detail, scoreTotal, windows, medians, weightsSum } = input;

  return {
    version: 1,
    generatedAt: windows.finishedAt.toISOString(),
    score: {
      value: detail.trustScore,
      raw: roundMetric(scoreTotal),
      label: detail.trustLabel,
      coldStart: detail.coldStart,
      reason: detail.reason,
    },
    windows: {
      sevenDays: {
        start: windows.window7Start.toISOString(),
        end: windows.finishedAt.toISOString(),
      },
      twentyEightDays: {
        start: windows.window28Start.toISOString(),
        end: windows.finishedAt.toISOString(),
      },
      runStartedAt: windows.startedAt.toISOString(),
    },
    counts: {
      itemCount7: detail.counts.itemCount7,
      itemCount28: detail.counts.itemCount28,
      classifiedItemCount7: detail.counts.classifiedItemCount7,
      classifiedItemCount28: detail.counts.classifiedItemCount28,
      classificationCount7: detail.counts.classificationCount7,
      classificationCount28: detail.counts.classificationCount28,
      adoptedItemCount28: detail.counts.adoptedItemCount28,
      noiseCount28: detail.counts.noiseCount28,
    },
    systemMedians: {
      adoptionRate: medians.adoptionRate === null ? null : roundMetric(medians.adoptionRate),
      priorityScore: medians.priorityScore === null ? null : roundMetric(medians.priorityScore),
      medianEligibleSourceCount: medians.medianEligibleSourceCount,
    },
    weights: {
      sum: roundMetric(weightsSum),
      itemQuality: roundMetric(detail.signals.itemQuality.weight),
      selectionValue: roundMetric(detail.signals.selectionValue.weight),
      prior: roundMetric(detail.signals.prior.weight),
      freshness: roundMetric(detail.signals.freshness.weight),
    },
    signals: {
      itemQuality: {
        raw: roundMetric(detail.signals.itemQuality.raw),
        contribution: roundMetric(detail.signals.itemQuality.contribution),
        nonNoiseRate: roundMetric(detail.rawSignals.nonNoiseRate),
        meanClassificationScore: roundMetric(detail.rawSignals.meanClassificationScore),
      },
      selectionValue: {
        raw: roundMetric(detail.signals.selectionValue.raw),
        contribution: roundMetric(detail.signals.selectionValue.contribution),
        adoptionRate: roundMetric(detail.rawSignals.adoptionRate),
        priorityScore: detail.rawSignals.priorityScore === null ? null : roundMetric(detail.rawSignals.priorityScore),
      },
      prior: {
        raw: roundMetric(detail.signals.prior.raw),
        contribution: roundMetric(detail.signals.prior.contribution),
        priorScore: roundMetric(detail.rawSignals.priorScore),
        priorDecay: roundMetric(detail.rawSignals.priorDecay),
      },
      freshness: {
        raw: roundMetric(detail.signals.freshness.raw),
        contribution: roundMetric(detail.signals.freshness.contribution),
        recencyScore: roundMetric(detail.rawSignals.recencyScore),
        originalityScore: roundMetric(detail.rawSignals.originalityScore),
      },
    },
  };
}

async function loadAggregationRows(
  prisma: PrismaClient,
  windows: { window7Start: Date; window28Start: Date; recentlyDeactivatedStart: Date; finishedAt: Date },
): Promise<AggregationRow[]> {
  const decisionTable = Prisma.raw('"pipeline_crosslink_l' + 'lm_decisions"');

  return prisma.$queryRaw<AggregationRow[]>(Prisma.sql`
    WITH eligible_sources AS (
      SELECT
        s.id AS "sourceId",
        s.handle,
        s.active,
        s."createdAt",
        s."trustLabel",
        c."aiScore" AS "candidateAiScore"
      FROM "Source" s
      LEFT JOIN "CandidateAccount" c ON lower(c.handle) = lower(s.handle)
      WHERE s.active = true
        OR s."deactivatedAt" >= ${windows.recentlyDeactivatedStart}
    ),
    items_28 AS (
      SELECT
        es."sourceId",
        pi.id AS "itemId",
        pi."createdAt"
      FROM eligible_sources es
      JOIN pipeline_items pi
        ON pi.platform = 'twitter'
       AND pi."sourceRef" = concat('@', es.handle)
       AND pi."createdAt" >= ${windows.window28Start}
       AND pi."createdAt" < ${windows.finishedAt}
    ),
    item_summary AS (
      SELECT
        "sourceId",
        count(*) AS "itemCount28",
        count(*) FILTER (WHERE "createdAt" >= ${windows.window7Start}) AS "itemCount7",
        max("createdAt") AS "latestItemAt"
      FROM items_28
      GROUP BY "sourceId"
    ),
    class_28 AS (
      SELECT
        i."sourceId",
        pc.id AS "classificationId",
        pc."pipelineItemId",
        pc.noise,
        pc.score,
        pc."createdAt",
        i."createdAt" AS "itemCreatedAt"
      FROM items_28 i
      JOIN pipeline_classifications pc
        ON pc."pipelineItemId" = i."itemId"
       AND pc."createdAt" >= ${windows.window28Start}
       AND pc."createdAt" < ${windows.finishedAt}
    ),
    class_summary AS (
      SELECT
        "sourceId",
        count(*) AS "classificationCount28",
        count(*) FILTER (WHERE "itemCreatedAt" >= ${windows.window7Start} AND "createdAt" >= ${windows.window7Start}) AS "classificationCount7",
        count(DISTINCT "pipelineItemId") AS "classifiedItemCount28",
        count(DISTINCT "pipelineItemId") FILTER (WHERE "itemCreatedAt" >= ${windows.window7Start} AND "createdAt" >= ${windows.window7Start}) AS "classifiedItemCount7",
        count(*) FILTER (WHERE noise = true) AS "noiseCount28",
        avg(score) FILTER (WHERE score IS NOT NULL) AS "meanClassificationScore"
      FROM class_28
      GROUP BY "sourceId"
    ),
    classified_items AS (
      SELECT DISTINCT "sourceId", "pipelineItemId"
      FROM class_28
    ),
    adoption_summary AS (
      SELECT
        ci."sourceId",
        count(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM newsletter_bindings nb
            WHERE nb."pipelineItemId" = ci."pipelineItemId"
          )
        ) AS "adoptedItemCount28"
      FROM classified_items ci
      GROUP BY ci."sourceId"
    ),
    decision_summary AS (
      SELECT
        i."sourceId",
        avg(d."priorityScore") FILTER (WHERE d."priorityScore" IS NOT NULL) AS "meanPriorityScore",
        avg(1 - d."dupScore") FILTER (WHERE d."dupScore" IS NOT NULL) AS "meanOriginalityScore"
      FROM items_28 i
      LEFT JOIN ${decisionTable} d
        ON d."pipelineItemId" = i."itemId"
       AND d."createdAt" >= ${windows.window28Start}
       AND d."createdAt" < ${windows.finishedAt}
      GROUP BY i."sourceId"
    )
    SELECT
      es."sourceId",
      es.handle,
      es.active,
      es."createdAt",
      es."trustLabel",
      es."candidateAiScore",
      coalesce(item_summary."itemCount28", 0) AS "itemCount28",
      coalesce(item_summary."itemCount7", 0) AS "itemCount7",
      coalesce(class_summary."classificationCount28", 0) AS "classificationCount28",
      coalesce(class_summary."classificationCount7", 0) AS "classificationCount7",
      coalesce(class_summary."classifiedItemCount28", 0) AS "classifiedItemCount28",
      coalesce(class_summary."classifiedItemCount7", 0) AS "classifiedItemCount7",
      coalesce(class_summary."noiseCount28", 0) AS "noiseCount28",
      coalesce(adoption_summary."adoptedItemCount28", 0) AS "adoptedItemCount28",
      class_summary."meanClassificationScore",
      decision_summary."meanPriorityScore",
      decision_summary."meanOriginalityScore",
      item_summary."latestItemAt"
    FROM eligible_sources es
    LEFT JOIN item_summary ON item_summary."sourceId" = es."sourceId"
    LEFT JOIN class_summary ON class_summary."sourceId" = es."sourceId"
    LEFT JOIN adoption_summary ON adoption_summary."sourceId" = es."sourceId"
    LEFT JOIN decision_summary ON decision_summary."sourceId" = es."sourceId"
    ORDER BY es.handle ASC
  `);
}

function buildDetail(
  row: AggregationRow,
  windows: { startedAt: Date; window7Start: Date; window28Start: Date; finishedAt: Date },
  medians: SourceTrustResult["medians"],
): { detail: SourceTrustDetail; metrics: Prisma.InputJsonObject; weightsSum: number } {
  const itemCount28 = numberFromDb(row.itemCount28);
  const itemCount7 = numberFromDb(row.itemCount7);
  const classificationCount28 = numberFromDb(row.classificationCount28);
  const classificationCount7 = numberFromDb(row.classificationCount7);
  const classifiedItemCount28 = numberFromDb(row.classifiedItemCount28);
  const classifiedItemCount7 = numberFromDb(row.classifiedItemCount7);
  const noiseCount28 = numberFromDb(row.noiseCount28);
  const adoptedItemCount28 = numberFromDb(row.adoptedItemCount28);

  const nonNoiseRate =
    classificationCount28 > 0 ? clamp01(1 - noiseCount28 / classificationCount28) : 0.5;
  const meanClassificationScore = row.meanClassificationScore === null ? 0.5 : clamp01(row.meanClassificationScore);
  // Item quality weights observed noise more heavily than classifier score because noise is the direct trust failure mode.
  const itemQuality = 0.6 * nonNoiseRate + 0.4 * meanClassificationScore;

  const adoptionRate = classifiedItemCount28 > 0 ? clamp01(adoptedItemCount28 / classifiedItemCount28) : 0;
  const priorityScore = normalizePercentScore(row.meanPriorityScore);
  const relativeAdoption = relativeAboveMedian(adoptionRate, medians.adoptionRate);
  const relativePriority = relativeAboveMedian(priorityScore, medians.priorityScore);
  // Selection value favors practical priority over adoption; adoption is sparse and median-or-below stays neutral.
  const selectionValue = 0.6 * relativePriority + 0.4 * relativeAdoption;

  const priorScore = row.candidateAiScore === null ? 0.5 : clamp01(row.candidateAiScore / 100);
  // Discovery prior linearly decays to zero weight by 50 classified items; freed weight moves into item quality.
  const priorDecay = clamp01(1 - classifiedItemCount28 / PRIOR_DECAY_CLASSIFIED_ITEMS);

  const daysSinceLastItem = row.latestItemAt ? daysBetween(windows.finishedAt, row.latestItemAt) : null;
  const recencyScore = daysSinceLastItem === null ? 0.5 : Math.exp(-daysSinceLastItem / 14);
  const originalityScore = row.meanOriginalityScore === null ? 0.5 : clamp01(row.meanOriginalityScore);
  const freshness = 0.6 * recencyScore + 0.4 * originalityScore;

  const weights = {
    itemQuality: BASE_WEIGHTS.itemQuality + BASE_WEIGHTS.prior * (1 - priorDecay),
    selectionValue: BASE_WEIGHTS.selectionValue,
    prior: BASE_WEIGHTS.prior * priorDecay,
    freshness: BASE_WEIGHTS.freshness,
  };
  const weightsSum = weights.itemQuality + weights.selectionValue + weights.prior + weights.freshness;

  const contributions = {
    itemQuality: itemQuality * weights.itemQuality,
    selectionValue: selectionValue * weights.selectionValue,
    prior: priorScore * weights.prior,
    freshness: freshness * weights.freshness,
  };
  const scoreTotal =
    contributions.itemQuality + contributions.selectionValue + contributions.prior + contributions.freshness;
  const trustScore = Math.round(clamp01(scoreTotal) * 100);

  const coldStart =
    classifiedItemCount28 < MIN_CLASSIFIED_ITEMS ||
    row.createdAt.getTime() > windows.finishedAt.getTime() - ACTIVE_AGE_DAYS_MS;
  const blocked = row.trustLabel === "blocked";
  const computedLabel = coldStart ? "unknown" : labelForScore(trustScore);
  const trustLabel = blocked ? "blocked" : computedLabel;

  const reason = buildReason({
    label: trustLabel,
    score: trustScore,
    classifiedItemCount28,
    nonNoiseRate,
    adoptionRate,
    priorityScore,
    coldStart,
    blocked,
  });

  const detail: SourceTrustDetail = {
    sourceId: row.sourceId,
    handle: row.handle,
    trustScore,
    trustLabel,
    previousTrustLabel: row.trustLabel,
    coldStart,
    reason,
    signals: {
      itemQuality: {
        raw: itemQuality,
        weight: weights.itemQuality,
        contribution: contributions.itemQuality,
      },
      selectionValue: {
        raw: selectionValue,
        weight: weights.selectionValue,
        contribution: contributions.selectionValue,
      },
      prior: {
        raw: priorScore,
        weight: weights.prior,
        contribution: contributions.prior,
      },
      freshness: {
        raw: freshness,
        weight: weights.freshness,
        contribution: contributions.freshness,
      },
    },
    rawSignals: {
      nonNoiseRate,
      meanClassificationScore,
      adoptionRate,
      priorityScore,
      priorScore,
      priorDecay,
      recencyScore,
      originalityScore,
    },
    counts: {
      itemCount7,
      itemCount28,
      classifiedItemCount7,
      classifiedItemCount28,
      classificationCount7,
      classificationCount28,
      adoptedItemCount28,
      noiseCount28,
    },
  };

  return {
    detail,
    metrics: toQualityMetrics({
      detail,
      scoreTotal,
      windows: {
        startedAt: windows.startedAt,
        window7Start: windows.window7Start,
        window28Start: windows.window28Start,
        finishedAt: windows.finishedAt,
      },
      medians,
      weightsSum,
    }),
    weightsSum,
  };
}

export async function recomputeSourceTrust(
  prisma: PrismaClient,
  options: SourceTrustOptions = {},
): Promise<SourceTrustResult> {
  const logger = options.logger || console;
  const dryRun = Boolean(options.dryRun);
  const startedAt = new Date();
  const windows = {
    startedAt,
    finishedAt: new Date(),
    window28Start: new Date(startedAt.getTime() - WINDOW_28_DAYS_MS),
    window7Start: new Date(startedAt.getTime() - WINDOW_7_DAYS_MS),
    recentlyDeactivatedStart: new Date(startedAt.getTime() - RECENTLY_DEACTIVATED_DAYS_MS),
  };

  const rows = await loadAggregationRows(prisma, windows);
  const medianEligibleRows = rows.filter(
    (row) => numberFromDb(row.classifiedItemCount28) >= MIN_CLASSIFIED_ITEMS,
  );
  const adoptionRates = medianEligibleRows.map((row) => {
    const classifiedItemCount = numberFromDb(row.classifiedItemCount28);
    return clamp01(numberFromDb(row.adoptedItemCount28) / classifiedItemCount);
  });
  const priorityScores = medianEligibleRows
    .map((row) => normalizePercentScore(row.meanPriorityScore))
    .filter((value): value is number => value !== null);
  const medians = {
    adoptionRate: median(adoptionRates),
    priorityScore: median(priorityScores),
    medianEligibleSourceCount: medianEligibleRows.length,
  };
  const unavailableMedians = [
    medians.adoptionRate === null ? "adoptionRate (relativeAdoption)" : null,
    medians.priorityScore === null ? "priorityScore (relativePriority)" : null,
  ].filter((value): value is string => value !== null);
  if (unavailableMedians.length > 0) {
    logger.warn(
      `[source-trust] unavailable median(s): ${unavailableMedians.join(
        ", ",
      )}; corresponding relative signal(s) degrade to neutral medianEligibleSourceCount=${medians.medianEligibleSourceCount}`,
    );
  }

  const details: SourceTrustDetail[] = [];
  let written = 0;
  const labelCounts: Record<string, number> = {};

  for (const row of rows) {
    const { detail, metrics, weightsSum } = buildDetail(row, windows, medians);
    if (Math.abs(weightsSum - 1) > 0.000001) {
      throw new Error(`Source trust weights must sum to 1 for @${row.handle}; got ${weightsSum}`);
    }

    details.push(detail);
    labelCounts[detail.trustLabel] = (labelCounts[detail.trustLabel] || 0) + 1;

    if (dryRun) {
      logger.log(
        `[source-trust] dry-run @${detail.handle} score=${detail.trustScore} label=${detail.trustLabel} reason=${detail.reason}`,
      );
      continue;
    }

    const data: Prisma.SourceUpdateInput = {
      trustScore: detail.trustScore,
      trustUpdatedAt: windows.finishedAt,
      qualityMetrics: metrics,
    };

    if (detail.previousTrustLabel !== "blocked") {
      data.trustLabel = detail.trustLabel;
    }

    await prisma.source.update({
      where: { id: detail.sourceId },
      data,
    });
    written += 1;
  }

  const finishedAt = new Date();
  const result: SourceTrustResult = {
    dryRun,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    scored: details.length,
    written,
    labelCounts,
    medians,
    details,
  };

  logger.log(
    `[source-trust] scored=${result.scored} written=${result.written} dryRun=${result.dryRun} labels=${JSON.stringify(result.labelCounts)}`,
  );

  return result;
}
