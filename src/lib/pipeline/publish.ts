import { createHash } from "crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  buildEditionSlug,
  buildEditionTitle,
  buildEditionWindow,
  EditionWindow,
  formatDateKey,
} from "./edition";
import {
  loadSourceTrustByHandle,
  normalizeTwitterSourceHandle,
  trustMultiplierFor,
} from "./source-trust";
import { sanitizeText } from "./text-sanitize";

export const PUBLISH_STEP = "step5_publish";
export const PUBLISH_MODEL = "rule-based:v1";

const DEFAULT_LIMIT = 120;
const MAX_SELECTION_LIMIT = 120;
const MAIN_WINDOW_LIMIT = 2000;
const MAIN_WINDOW_LIMIT_PLUS_ONE = MAIN_WINDOW_LIMIT + 1;
const RESCUE_LIMIT = 500;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RESCUE_LOOKBACK_MS = 2 * ONE_DAY_MS;
const FAILED_FALLBACK_INPUT_HASH_PREFIX = "llm_error_fallback::";

const PRIMARY_SECTION_MAP: Record<string, string> = {
  UPDATE: "2_update",
  AGENT: "2b_agent",
  MCP_API: "3_mcp_api",
  TECH: "4_tech",
  RESEARCH: "4b_research",
  DEVICE: "5_device",
  SECURITY: "6_security",
  REGULATION: "7_regulation",
  BUSINESS: "8_business",
  OTHER: "9_other",
  COLUMN: "10_column",
};

const SUBSECTION_MAP: Record<string, string> = {
  NEW_LLM: "2-1_new_llm",
  LLM_UPDATE: "2-2_llm_update",
  OSS_FW: "2-3_oss_fw",
  AGENT_DEV: "2b-1_agent_dev",
  AGENT_OPS: "2b-2_agent_ops",
  MULTI_AGENT: "2b-3_multi_agent",
  AGENT: "4-1_agent",
  PROMPT: "4-2_prompt",
  CTX_ENG: "4-3_context_engineering",
  RAG_SEARCH: "4-4_rag_search",
  PAPER: "4b-1_paper",
  BENCH: "4b-2_bench",
  MCP: "3-1_mcp",
  SDK_API: "3-2_sdk_api",
  PAPER_BENCH: "4-4_paper_bench",
  WEARABLE: "5-1_wearable",
  ROBOTICS_HW: "5-2_robotics_hw",
};

interface LatestStepRun {
  attempt: number;
  inputHash: string | null;
  status: string;
}

interface LatestClassification {
  id: number;
  noise: boolean;
  primaryTag: string | null;
  subTag: string | null;
  actionTag: string | null;
  isHeadlineCandidate: boolean;
  isDup: boolean;
  isPublished: boolean;
  score: number | null;
  updatedAt: Date;
  classifiedAt: Date;
}

interface LatestDecision {
  id: number;
  inputHash: string;
  headlineCandidate: boolean;
  priorityScore: number | null;
  createdAt: Date;
}

const PUBLISH_ITEM_SELECT = {
  id: true,
  platform: true,
  sourceRef: true,
  title: true,
  body: true,
  url: true,
  canonicalUrl: true,
  publishedAt: true,
  ingestedAt: true,
  createdAt: true,
  updatedAt: true,
  classifications: {
    orderBy: { classifiedAt: "desc" },
    take: 1,
    select: {
      id: true,
      noise: true,
      primaryTag: true,
      subTag: true,
      actionTag: true,
      isHeadlineCandidate: true,
      isDup: true,
      isPublished: true,
      score: true,
      updatedAt: true,
      classifiedAt: true,
    },
  },
  crosslinkLlmDecisions: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      id: true,
      inputHash: true,
      headlineCandidate: true,
      priorityScore: true,
      createdAt: true,
    },
  },
  runs: {
    where: { step: PUBLISH_STEP },
    orderBy: { attempt: "desc" },
    take: 1,
    select: {
      attempt: true,
      inputHash: true,
      status: true,
    },
  },
} satisfies Prisma.PipelineItemSelect;

type PipelineItemForPublish = Prisma.PipelineItemGetPayload<{
  select: typeof PUBLISH_ITEM_SELECT;
}>;

interface PublishPlanItem {
  item: PipelineItemForPublish;
  classification: LatestClassification;
  decision: LatestDecision | null;
  headlineCandidate: boolean;
  rank: number;
  section: string;
  subsection: string | null;
  position: number;
  inputHash: string;
  bindingExisted: boolean;
}

export interface PublishOptions {
  dryRun?: boolean;
  allowAppend?: boolean;
  limit?: number;
  platforms?: string[];
  editionDate?: Date;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface PublishCounter {
  scanned: number;
  eligible: number;
  selected: number;
  processed: number;
  skippedUnchanged: number;
  failed: number;
  headlineSelected: number;
  taggedSelected: number;
  bindingsCreated: number;
  bindingsUpdated: number;
  classificationsMarked: number;
  orphansBackfilled: number;
  clamped: boolean;
}

export interface PublishPreview {
  pipelineItemId: string;
  platform: string;
  url: string;
  rank: number;
  section: string;
  subsection: string | null;
  position: number;
  isHeadlineCandidate: boolean;
  primaryTag: string | null;
  subTag: string | null;
  actionTag: string | null;
  score: number | null;
  bindingExisted: boolean;
}

export interface PublishMetrics {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  limit: number;
  editionDate: string;
  platforms?: string[];
  edition: {
    id: string | null;
    slug: string;
    title: string;
    existed: boolean;
  };
  counter: PublishCounter;
  previews: PublishPreview[];
  refusedReason: "edition_already_published" | null;
}

function createCounter(): PublishCounter {
  return {
    scanned: 0,
    eligible: 0,
    selected: 0,
    processed: 0,
    skippedUnchanged: 0,
    failed: 0,
    headlineSelected: 0,
    taggedSelected: 0,
    bindingsCreated: 0,
    bindingsUpdated: 0,
    classificationsMarked: 0,
    orphansBackfilled: 0,
    clamped: false,
  };
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function parseLimit(raw: number | undefined): number {
  if (!raw || Number.isNaN(raw) || raw <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), MAX_SELECTION_LIMIT);
}

function getRecencyTs(item: PipelineItemForPublish): number {
  return (item.publishedAt || item.ingestedAt || item.createdAt).getTime();
}

function toEditionDate(input?: Date): Date {
  const base = input ? new Date(input) : new Date();
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
}

function buildWindowWhere(window: EditionWindow): Prisma.PipelineItemWhereInput {
  return {
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

export function resolveSection(
  classification: LatestClassification,
  decisionHeadlineCandidate: boolean | null,
): { section: string; subsection: string | null } {
  const isHeadlineCandidate = decisionHeadlineCandidate ?? classification.isHeadlineCandidate;
  if (isHeadlineCandidate) {
    return {
      section: "1_latest_ai_news",
      subsection: null,
    };
  }

  return {
    section: PRIMARY_SECTION_MAP[classification.primaryTag || "OTHER"] || "9_other",
    subsection: classification.subTag ? SUBSECTION_MAP[classification.subTag] || null : null,
  };
}

function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/\s+/g, " ").trim();
}

function buildBlurb(item: PipelineItemForPublish): string | null {
  const text = normalizeText(item.body) || normalizeText(item.title);
  if (!text) return null;
  if (text.length <= 280) return text;
  return `${text.slice(0, 279)}…`;
}

function buildInputHash(
  plan: Omit<PublishPlanItem, "inputHash" | "bindingExisted">,
  editionDate: Date,
): string {
  const serialized = JSON.stringify({
    editionDate: editionDate.toISOString(),
    item: {
      id: plan.item.id,
      platform: plan.item.platform,
      url: plan.item.url,
      canonicalUrl: plan.item.canonicalUrl || null,
      title: plan.item.title || null,
      updatedAt: plan.item.updatedAt.toISOString(),
      publishedAt: plan.item.publishedAt ? plan.item.publishedAt.toISOString() : null,
    },
    classification: {
      id: plan.classification.id,
      updatedAt: plan.classification.updatedAt.toISOString(),
      primaryTag: plan.classification.primaryTag,
      subTag: plan.classification.subTag,
      actionTag: plan.classification.actionTag,
      score: plan.classification.score,
      isHeadlineCandidate: plan.classification.isHeadlineCandidate,
      isDup: plan.classification.isDup,
      isPublished: plan.classification.isPublished,
    },
    decision: plan.decision
      ? {
          id: plan.decision.id,
          inputHash: plan.decision.inputHash,
          headlineCandidate: plan.headlineCandidate,
          priorityScore: plan.decision.priorityScore,
        }
      : null,
    placement: {
      rank: plan.rank,
      section: plan.section,
      subsection: plan.subsection,
      position: plan.position,
    },
  });

  return createHash("sha256").update(serialized).digest("hex");
}

async function persistPlanItem(
  prisma: PrismaClient,
  plan: PublishPlanItem,
  editionId: string,
  editionDate: Date,
): Promise<void> {
  const latestRun = plan.item.runs[0];
  const attempt = (latestRun?.attempt || 0) + 1;

  const run = await prisma.pipelineRun.create({
    data: {
      pipelineItemId: plan.item.id,
      step: PUBLISH_STEP,
      status: "running",
      attempt,
      model: PUBLISH_MODEL,
      inputHash: plan.inputHash,
    },
  });

  try {
    const blurb = buildBlurb(plan.item);
    const sanitizedBlurb = blurb === null ? null : sanitizeText(blurb);
    const outputSummary = {
      editionId,
      editionDate: editionDate.toISOString(),
      pipelineItemId: plan.item.id,
      section: plan.section,
      subsection: plan.subsection,
      position: plan.position,
      bindingAction: plan.bindingExisted ? "updated" : "created",
      isHeadlineCandidate: plan.headlineCandidate,
      tags: {
        primary: plan.classification.primaryTag,
        sub: plan.classification.subTag,
        action: plan.classification.actionTag,
      },
    };

    await prisma.$transaction(async (tx) => {
      await tx.newsletterBinding.upsert({
        where: {
          editionId_pipelineItemId: {
            editionId,
            pipelineItemId: plan.item.id,
          },
        },
        create: {
          editionId,
          pipelineItemId: plan.item.id,
          classificationId: plan.classification.id,
          section: plan.section,
          subsection: plan.subsection,
          position: plan.position,
          blurb: sanitizedBlurb,
        },
        update: {
          classificationId: plan.classification.id,
          section: plan.section,
          subsection: plan.subsection,
          position: plan.position,
          blurb: sanitizedBlurb,
        },
      });

      await tx.pipelineClassification.update({
        where: { id: plan.classification.id },
        data: {
          isPublished: true,
        },
      });

      await tx.pipelineRun.update({
        where: { id: run.id },
        data: {
          status: "completed",
          finishedAt: new Date(),
          output: outputSummary as Prisma.InputJsonObject,
        },
      });
    });
  } catch (error) {
    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: sanitizeErrorMessage(error),
      },
    });
    throw error;
  }
}

function pickLatestClassification(item: PipelineItemForPublish): LatestClassification | null {
  return item.classifications[0] || null;
}

function pickLatestDecision(item: PipelineItemForPublish): LatestDecision | null {
  return item.crosslinkLlmDecisions[0] || null;
}

function isSentinelDecision(decision: LatestDecision): boolean {
  return decision.inputHash.startsWith(FAILED_FALLBACK_INPUT_HASH_PREFIX);
}

function pickLatestRun(item: PipelineItemForPublish): LatestStepRun | null {
  return item.runs[0] || null;
}

export async function publishPipelineItems(
  prisma: PrismaClient,
  options: PublishOptions = {},
): Promise<PublishMetrics> {
  const logger = options.logger || console;
  const startedAt = new Date();

  const dryRun = Boolean(options.dryRun);
  const allowAppend = Boolean(options.allowAppend);
  const limit = parseLimit(options.limit);
  const platforms = uniq(
    (options.platforms || [])
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
  const editionDate = toEditionDate(options.editionDate);
  const window = buildEditionWindow(editionDate);

  const mainWhere: Prisma.PipelineItemWhereInput = {
    normalizedAt: { not: null },
    newsletterBindings: { none: {} },
    ...buildWindowWhere(window),
  };

  const rescueWhere: Prisma.PipelineItemWhereInput = {
    normalizedAt: { not: null },
    newsletterBindings: { none: {} },
    publishedAt: {
      gte: new Date(window.startUtc.getTime() - RESCUE_LOOKBACK_MS),
      lt: window.startUtc,
    },
    OR: [
      {
        ingestedAt: {
          gte: window.startUtc,
          lt: window.endUtcExclusive,
        },
      },
      {
        classifications: {
          some: {
            classifiedAt: {
              gte: window.startUtc,
              lt: window.endUtcExclusive,
            },
          },
        },
      },
    ],
  };

  if (platforms.length > 0) {
    mainWhere.platform = { in: platforms };
    rescueWhere.platform = { in: platforms };
  }

  logger.log(
    `[publish] dateJst=${window.dateKeyJst} window=[${window.startUtc.toISOString()}..${window.endUtcExclusive.toISOString()}) limit=${limit} dryRun=${dryRun}${allowAppend ? " allowAppend=true" : ""}`,
  );

  const dateKey = formatDateKey(editionDate);
  const editionSlug = buildEditionSlug(editionDate);
  const editionTitle = buildEditionTitle(editionDate);

  let edition = await prisma.newsletterEdition.findUnique({
    where: {
      editionDate,
    },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
    },
  });

  const editionInitiallyExists = Boolean(edition);

  if (edition?.status === "published" && !allowAppend) {
    logger.log(
      `[publish] edition ${edition.id} for ${window.dateKeyJst} is already published; refusing re-run (pass --allow-append to append)`,
    );
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      dryRun,
      limit,
      editionDate: dateKey,
      platforms: platforms.length > 0 ? platforms : undefined,
      edition: { id: edition.id, slug: edition.slug, title: edition.title, existed: true },
      counter: createCounter(),
      previews: [],
      refusedReason: "edition_already_published",
    };
  }

  const mainRowsWithLimitProbe = await prisma.pipelineItem.findMany({
    where: mainWhere,
    select: PUBLISH_ITEM_SELECT,
    orderBy: [
      { publishedAt: { sort: "desc", nulls: "last" } },
      { ingestedAt: "desc" },
      { createdAt: "desc" },
    ],
    take: MAIN_WINDOW_LIMIT_PLUS_ONE,
  });
  const rescueRows = await prisma.pipelineItem.findMany({
    where: rescueWhere,
    select: PUBLISH_ITEM_SELECT,
    orderBy: [{ publishedAt: "desc" }, { ingestedAt: "desc" }, { createdAt: "desc" }],
    take: RESCUE_LIMIT,
  });

  const counter = createCounter();
  counter.clamped = mainRowsWithLimitProbe.length >= MAIN_WINDOW_LIMIT_PLUS_ONE;
  if (counter.clamped) {
    logger.warn(
      `[publish] main-window rows reached limit=${MAIN_WINDOW_LIMIT}; clamped current run`,
    );
  }

  const rawItemsById = new Map<string, PipelineItemForPublish>();
  for (const item of [...mainRowsWithLimitProbe.slice(0, MAIN_WINDOW_LIMIT), ...rescueRows]) {
    if (!rawItemsById.has(item.id)) rawItemsById.set(item.id, item);
  }
  const rawItems = [...rawItemsById.values()];
  counter.scanned = rawItems.length;

  const sourceTrustByHandle = await loadSourceTrustByHandle(
    prisma,
    rawItems
      .map((item) => normalizeTwitterSourceHandle(item.platform, item.sourceRef))
      .filter((handle): handle is string => Boolean(handle)),
    logger,
  );

  const candidates = rawItems
    .map((item) => {
      const classification = pickLatestClassification(item);
      if (!classification) return null;
      if (classification.noise) return null;
      if (classification.isDup) return null;
      if (classification.isPublished) return null;
      const trackedHandle = normalizeTwitterSourceHandle(item.platform, item.sourceRef);
      const trustLabel =
        sourceTrustByHandle && trackedHandle ? sourceTrustByHandle.get(trackedHandle) ?? null : null;
      if (trustLabel === "blocked") return null;

      const decision = pickLatestDecision(item);
      const headlineCandidate = Boolean(
        decision && !isSentinelDecision(decision) && decision.headlineCandidate,
      );
      const eligibilityHeadlineCandidate = decision
        ? headlineCandidate
        : classification.isHeadlineCandidate;
      if (!eligibilityHeadlineCandidate && !classification.primaryTag) return null;

      const priorityScore = decision
        ? decision.priorityScore ?? 0
        : (classification.score ?? 0) * 100;
      return {
        item,
        classification,
        decision,
        headlineCandidate,
        weightedPriorityScore: priorityScore * trustMultiplierFor(trustLabel),
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  counter.eligible = candidates.length;

  candidates.sort((a, b) => {
    const headlineDiff = Number(b.headlineCandidate) - Number(a.headlineCandidate);
    if (headlineDiff !== 0) return headlineDiff;

    const scoreDiff = b.weightedPriorityScore - a.weightedPriorityScore;
    if (scoreDiff !== 0) return scoreDiff;

    const recencyDiff = getRecencyTs(b.item) - getRecencyTs(a.item);
    if (recencyDiff !== 0) return recencyDiff;

    return a.item.id.localeCompare(b.item.id);
  });

  const selected = candidates.slice(0, limit);
  counter.selected = selected.length;

  if (!edition && !dryRun) {
    edition = await prisma.newsletterEdition.create({
      data: {
        editionDate,
        slug: editionSlug,
        title: editionTitle,
        status: "draft",
      },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
      },
    });
  }

  if (!dryRun && edition && platforms.length === 0) {
    const orphanBackfill = await prisma.voiceSignal.updateMany({
      where: {
        editionId: null,
        pipelineItem: {
          is: buildWindowWhere(window),
        },
      },
      data: {
        editionId: edition.id,
      },
    });
    counter.orphansBackfilled = orphanBackfill.count;
    logger.log(`[publish] orphan voiceSignal backfill: count=${orphanBackfill.count} edition=${edition.id}`);
  } else if (!dryRun && edition) {
    logger.log("[publish] Skipping orphan voice-signal backfill: platforms filter is active");
  }

  const selectedIds = selected.map((entry) => entry.item.id);
  const existingBindings =
    edition && selectedIds.length > 0
      ? await prisma.newsletterBinding.findMany({
          where: {
            editionId: edition.id,
            pipelineItemId: { in: selectedIds },
          },
          select: {
            pipelineItemId: true,
          },
        })
      : [];

  const existingBindingIds = new Set(existingBindings.map((binding) => binding.pipelineItemId));
  const positionOffset = edition
    ? (
        await prisma.newsletterBinding.aggregate({
          where: { editionId: edition.id },
          _max: { position: true },
        })
      )._max.position ?? 0
    : 0;

  const plans: PublishPlanItem[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const selectedItem = selected[index];
    const sectionHeadlineCandidate = selectedItem.decision
      ? selectedItem.headlineCandidate
      : null;
    const placement = resolveSection(selectedItem.classification, sectionHeadlineCandidate);

    const basePlan = {
      item: selectedItem.item,
      classification: selectedItem.classification,
      decision: selectedItem.decision,
      headlineCandidate: selectedItem.headlineCandidate,
      rank: index + 1,
      section: placement.section,
      subsection: placement.subsection,
      position: positionOffset + index + 1,
    };

    const inputHash = buildInputHash(basePlan, editionDate);

    plans.push({
      ...basePlan,
      inputHash,
      bindingExisted: existingBindingIds.has(selectedItem.item.id),
    });
  }

  const previews: PublishPreview[] = [];

  for (const plan of plans) {
    if (plan.headlineCandidate) {
      counter.headlineSelected += 1;
    } else {
      counter.taggedSelected += 1;
    }

    if (previews.length < 20) {
      previews.push({
        pipelineItemId: plan.item.id,
        platform: plan.item.platform,
        url: plan.item.url,
        rank: plan.rank,
        section: plan.section,
        subsection: plan.subsection,
        position: plan.position,
        isHeadlineCandidate: plan.headlineCandidate,
        primaryTag: plan.classification.primaryTag,
        subTag: plan.classification.subTag,
        actionTag: plan.classification.actionTag,
        score: plan.classification.score,
        bindingExisted: plan.bindingExisted,
      });
    }

    const latestRun = pickLatestRun(plan.item);
    if (
      latestRun?.status === "completed" &&
      latestRun.inputHash === plan.inputHash &&
      plan.bindingExisted &&
      plan.classification.isPublished
    ) {
      counter.skippedUnchanged += 1;
      continue;
    }

    try {
      if (!dryRun) {
        if (!edition) {
          throw new Error("Newsletter edition was not created");
        }

        await persistPlanItem(prisma, plan, edition.id, editionDate);
      }

      counter.processed += 1;
      counter.classificationsMarked += 1;

      if (plan.bindingExisted) {
        counter.bindingsUpdated += 1;
      } else {
        counter.bindingsCreated += 1;
      }

      logger.log(
        `[publish] item=${plan.item.id} rank=${plan.rank} section=${plan.section} headline=${plan.headlineCandidate} binding=${plan.bindingExisted ? "updated" : "created"}`,
      );
    } catch (error) {
      counter.failed += 1;
      logger.warn(`[publish] item=${plan.item.id} failed: ${sanitizeErrorMessage(error)}`);
    }
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    dryRun,
    limit,
    editionDate: dateKey,
    platforms: platforms.length > 0 ? platforms : undefined,
    edition: {
      id: edition?.id || null,
      slug: edition?.slug || editionSlug,
      title: edition?.title || editionTitle,
      existed: editionInitiallyExists,
    },
    counter,
    previews,
    refusedReason: null,
  };
}
