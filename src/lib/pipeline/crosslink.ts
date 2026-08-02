import { createHash } from "crypto";
import { PipelineItem, Prisma, PrismaClient } from "@prisma/client";
import { normalizeCanonicalUrl } from "./normalize";

export const CROSSLINK_STEP = "step4_crosslink";
export const CROSSLINK_MODEL = "rule-based:v1";
export const CROSSLINK_CREATED_BY = "step4_crosslink:v1";

const DUP_LINK_TYPE = "DUP_OF";
const PUBLISHED_LINK_TYPE = "PUBLISHED_MATCH";
const HEADLINE_LINK_TYPE = "HEADLINE_CANDIDATE";

const DEFAULT_LIMIT = 120;
const DEFAULT_PUBLISHED_LOOKBACK_DAYS = 90;
const MAX_HEADLINE_SLOTS = 5;
const MIN_HEADLINE_SCORE = 35;

const HEADLINE_PRIMARY_WEIGHTS: Record<string, number> = {
  SECURITY: 24,
  REGULATION: 20,
  MCP_API: 18,
  AGENT: 17,
  UPDATE: 16,
  TECH: 14,
  RESEARCH: 12,
  DEVICE: 10,
  BUSINESS: 8,
  COLUMN: 6,
  OTHER: 4,
};

const HEADLINE_ACTION_WEIGHTS: Record<string, number> = {
  APPLY: 8,
  EVAL: 6,
  WATCH: 4,
  INFO: 2,
};

const DETAIL_PLATFORM_BONUS: Record<string, number> = {
  alerts: 30,
  qiita: 24,
  github: 22,
  reddit: 14,
  facebook: 12,
  instagram: 8,
  twitter: 6,
};

interface LatestStepRun {
  id: number;
  attempt: number;
  inputHash: string | null;
  status: string;
}

interface LatestClassification {
  id: number;
  noise: boolean;
  score: number | null;
  primaryTag: string | null;
  actionTag: string | null;
  isHeadlineCandidate: boolean;
  isDup: boolean;
  isPublished: boolean;
  updatedAt: Date;
}

type PipelineItemForCrosslink = PipelineItem & {
  classifications: LatestClassification[];
  runs: LatestStepRun[];
};

interface PublishedItem {
  id: string;
  url: string;
  canonicalUrl: string | null;
  title: string | null;
}

interface CrosslinkOptions {
  dryRun?: boolean;
  limit?: number;
  platforms?: string[];
  logger?: Pick<Console, "log" | "warn" | "error">;
}

interface CrosslinkCounter {
  scanned: number;
  candidates: number;
  processed: number;
  skippedUnchanged: number;
  failed: number;
  dupMarked: number;
  publishedMarked: number;
  headlineMarked: number;
  linksPlanned: number;
  linksUpserted: number;
  linksDeleted: number;
}

interface CrosslinkPreview {
  pipelineItemId: string;
  platform: string;
  url: string;
  isDup: boolean;
  dupMasterId: string | null;
  isHeadlineCandidate: boolean;
  headlineScore: number;
  isPublished: boolean;
  publishedMatchIds: string[];
  linkCount: number;
}

export interface CrosslinkMetrics {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  limit: number;
  platforms?: string[];
  counter: CrosslinkCounter;
  previews: CrosslinkPreview[];
}

interface DesiredLink {
  toItemId: string;
  linkType: string;
  score: number;
  note: string;
}

interface ItemAnalysis {
  item: PipelineItemForCrosslink;
  classification: LatestClassification;
  isDup: boolean;
  dupMasterId: string | null;
  dupReasons: string[];
  isPublished: boolean;
  publishedMatchIds: string[];
  isHeadlineCandidate: boolean;
  headlineScore: number;
  headlineReasons: string[];
  desiredLinks: DesiredLink[];
  inputHash: string;
}

interface PersistResult {
  upserted: number;
  deleted: number;
}

class UnionFind {
  private readonly parent: number[];
  private readonly rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }

  find(value: number): number {
    if (this.parent[value] !== value) {
      this.parent[value] = this.find(this.parent[value]);
    }
    return this.parent[value];
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;

    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
      return;
    }

    if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
      return;
    }

    this.parent[rootB] = rootA;
    this.rank[rootA] += 1;
  }
}

function createCounter(): CrosslinkCounter {
  return {
    scanned: 0,
    candidates: 0,
    processed: 0,
    skippedUnchanged: 0,
    failed: 0,
    dupMarked: 0,
    publishedMarked: 0,
    headlineMarked: 0,
    linksPlanned: 0,
    linksUpserted: 0,
    linksDeleted: 0,
  };
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitleKey(title: string | null | undefined): string | null {
  const normalized = normalizeText(title);
  if (!normalized) return null;
  if (normalized.length < 24) return null;
  return normalized;
}

function normalizeUrlKey(input: string | null | undefined): string | null {
  if (!input) return null;
  const normalized = normalizeCanonicalUrl(input).trim().toLowerCase();
  return normalized || null;
}

function parseLimit(raw: number | undefined): number {
  if (!raw || Number.isNaN(raw) || raw <= 0) return DEFAULT_LIMIT;
  return Math.floor(raw);
}

function parsePublishedLookbackDays(): number {
  const parsed = Number.parseInt(process.env.CROSSLINK_PUBLISHED_LOOKBACK_DAYS || "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_PUBLISHED_LOOKBACK_DAYS;
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function scoreDetail(item: PipelineItem): number {
  const bodyLen = (item.body || "").trim().length;
  const titleLen = (item.title || "").trim().length;
  const lengthScore = Math.min(bodyLen, 4000) * 1.0 + Math.min(titleLen, 220) * 1.8;
  const canonicalBonus = item.canonicalUrl ? 20 : 0;
  const publishedAtBonus = item.publishedAt ? 14 : 0;
  const platformBonus = DETAIL_PLATFORM_BONUS[item.platform] || 0;

  return Number((lengthScore + canonicalBonus + publishedAtBonus + platformBonus).toFixed(3));
}

function sortByRecencyThenId(a: PipelineItem, b: PipelineItem): number {
  const aTime = (a.publishedAt || a.ingestedAt || a.createdAt).getTime();
  const bTime = (b.publishedAt || b.ingestedAt || b.createdAt).getTime();
  if (aTime !== bTime) return bTime - aTime;
  return a.id.localeCompare(b.id);
}

function matchScoreFromReasons(reasons: string[]): number {
  if (reasons.includes("direct_binding")) return 1;
  if (reasons.includes("canonical_url_match")) return 0.96;
  if (reasons.includes("url_match")) return 0.92;
  if (reasons.includes("title_exact_match")) return 0.82;
  return 0.7;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function addMapEntry(map: Map<string, string[]>, key: string | null, value: string): void {
  if (!key) return;
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
    return;
  }
  map.set(key, [value]);
}

function addPairEvidence(store: Map<string, Set<string>>, a: string, b: string, reason: string): void {
  if (a === b) return;
  const key = pairKey(a, b);
  const reasons = store.get(key);
  if (reasons) {
    reasons.add(reason);
    return;
  }
  store.set(key, new Set([reason]));
}

function groupByRoot(itemIds: string[], unionFind: UnionFind): Map<number, string[]> {
  const byRoot = new Map<number, string[]>();
  for (let i = 0; i < itemIds.length; i += 1) {
    const root = unionFind.find(i);
    const existing = byRoot.get(root);
    if (existing) {
      existing.push(itemIds[i]);
    } else {
      byRoot.set(root, [itemIds[i]]);
    }
  }
  return byRoot;
}

function inferDupReasons(
  item: PipelineItem,
  master: PipelineItem,
  pairEvidence: Set<string> | undefined,
): string[] {
  const reasons = new Set<string>(pairEvidence ? [...pairEvidence] : []);

  const itemCanonical = normalizeUrlKey(item.canonicalUrl || item.url);
  const masterCanonical = normalizeUrlKey(master.canonicalUrl || master.url);
  if (itemCanonical && masterCanonical && itemCanonical === masterCanonical) {
    reasons.add("canonical_url_match");
  }

  const itemUrl = normalizeUrlKey(item.url);
  const masterUrl = normalizeUrlKey(master.url);
  if (itemUrl && masterUrl && itemUrl === masterUrl) {
    reasons.add("url_match");
  }

  const itemTitle = normalizeTitleKey(item.title);
  const masterTitle = normalizeTitleKey(master.title);
  if (itemTitle && masterTitle && itemTitle === masterTitle) {
    reasons.add("title_exact_match");
  }

  if (reasons.size === 0) {
    reasons.add("cluster_match");
  }

  return [...reasons].sort();
}

function scoreFreshness(item: PipelineItem): { score: number; reason: string } {
  const timestamp = item.publishedAt || item.ingestedAt || item.createdAt;
  const ageHours = (Date.now() - timestamp.getTime()) / 36_000_00;

  if (ageHours <= 24) return { score: 20, reason: "fresh_24h" };
  if (ageHours <= 72) return { score: 14, reason: "fresh_72h" };
  if (ageHours <= 168) return { score: 8, reason: "fresh_7d" };
  if (ageHours <= 336) return { score: 4, reason: "fresh_14d" };
  return { score: 0, reason: "fresh_older" };
}

function scoreHeadline(item: PipelineItem, classification: LatestClassification): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  let score = 10;

  const classifierScore = classification.score ?? 0.5;
  score += classifierScore * 40;
  reasons.push(`classifier:${classifierScore.toFixed(3)}`);

  const primaryWeight = HEADLINE_PRIMARY_WEIGHTS[classification.primaryTag || "OTHER"] || 0;
  score += primaryWeight;
  if (primaryWeight > 0) reasons.push(`primary:${classification.primaryTag || "OTHER"}+${primaryWeight}`);

  const actionWeight = HEADLINE_ACTION_WEIGHTS[classification.actionTag || "INFO"] || 0;
  score += actionWeight;
  if (actionWeight > 0) reasons.push(`action:${classification.actionTag || "INFO"}+${actionWeight}`);

  const bodyLen = (item.body || "").trim().length;
  const titleLen = (item.title || "").trim().length;
  const bodyScore = Math.min(bodyLen, 1200) / 120;
  const titleScore = Math.min(titleLen, 120) / 30;

  score += bodyScore + titleScore;
  reasons.push(`body:+${bodyScore.toFixed(2)}`);
  reasons.push(`title:+${titleScore.toFixed(2)}`);

  const freshness = scoreFreshness(item);
  score += freshness.score;
  reasons.push(freshness.reason);

  if (item.platform === "qiita" || item.platform === "github" || item.platform === "alerts") {
    score += 2;
    reasons.push("platform_detail_bonus");
  }

  if (bodyLen > 900) {
    score += 3;
    reasons.push("long_form_bonus");
  }

  if (bodyLen < 60) {
    score -= 4;
    reasons.push("short_penalty");
  }

  return {
    score: Number(clamp(score, 0, 120).toFixed(3)),
    reasons,
  };
}

function buildInputHash(analysis: ItemAnalysis): string {
  const item = analysis.item;
  const classification = analysis.classification;

  const bodyHash = createHash("sha256").update(item.body || "").digest("hex");
  const linkPayload = analysis.desiredLinks
    .map((link) => ({
      toItemId: link.toItemId,
      linkType: link.linkType,
      score: Number(link.score.toFixed(3)),
      note: link.note,
    }))
    .sort((a, b) => `${a.linkType}:${a.toItemId}`.localeCompare(`${b.linkType}:${b.toItemId}`));

  const serialized = JSON.stringify({
    id: item.id,
    platform: item.platform,
    url: item.url,
    canonicalUrl: item.canonicalUrl || null,
    title: item.title || null,
    bodyHash,
    publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
    updatedAt: item.updatedAt ? item.updatedAt.toISOString() : null,
    classification: {
      id: classification.id,
      updatedAt: classification.updatedAt.toISOString(),
      score: classification.score,
      primaryTag: classification.primaryTag,
      actionTag: classification.actionTag,
    },
    result: {
      isDup: analysis.isDup,
      dupMasterId: analysis.dupMasterId,
      dupReasons: analysis.dupReasons,
      isPublished: analysis.isPublished,
      publishedMatchIds: analysis.publishedMatchIds,
      isHeadlineCandidate: analysis.isHeadlineCandidate,
      headlineScore: Number(analysis.headlineScore.toFixed(3)),
      headlineReasons: analysis.headlineReasons,
      links: linkPayload,
    },
  });

  return createHash("sha256").update(serialized).digest("hex");
}

async function persistItemCrosslink(
  prisma: PrismaClient,
  analysis: ItemAnalysis,
  inputHash: string,
): Promise<PersistResult> {
  const latestRun = analysis.item.runs[0];
  const attempt = (latestRun?.attempt || 0) + 1;

  const run = await prisma.pipelineRun.create({
    data: {
      pipelineItemId: analysis.item.id,
      step: CROSSLINK_STEP,
      status: "running",
      attempt,
      model: CROSSLINK_MODEL,
      inputHash,
    },
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.pipelineClassification.update({
        where: { id: analysis.classification.id },
        data: {
          isDup: analysis.isDup,
          isHeadlineCandidate: analysis.isHeadlineCandidate,
          isPublished: analysis.isPublished,
        },
      });

      const existingLinks = await tx.pipelineLink.findMany({
        where: {
          fromItemId: analysis.item.id,
          createdBy: CROSSLINK_CREATED_BY,
          linkType: {
            in: [DUP_LINK_TYPE, PUBLISHED_LINK_TYPE, HEADLINE_LINK_TYPE],
          },
        },
        select: {
          id: true,
          toItemId: true,
          linkType: true,
        },
      });

      const desiredKeys = new Set(
        analysis.desiredLinks.map((link) => `${link.linkType}::${link.toItemId}`),
      );

      const deleteIds = existingLinks
        .filter((link) => !desiredKeys.has(`${link.linkType}::${link.toItemId}`))
        .map((link) => link.id);

      if (deleteIds.length > 0) {
        await tx.pipelineLink.deleteMany({
          where: { id: { in: deleteIds } },
        });
      }

      for (const link of analysis.desiredLinks) {
        await tx.pipelineLink.upsert({
          where: {
            fromItemId_toItemId_linkType: {
              fromItemId: analysis.item.id,
              toItemId: link.toItemId,
              linkType: link.linkType,
            },
          },
          create: {
            fromItemId: analysis.item.id,
            toItemId: link.toItemId,
            linkType: link.linkType,
            score: link.score,
            note: link.note,
            createdBy: CROSSLINK_CREATED_BY,
          },
          update: {
            score: link.score,
            note: link.note,
            createdBy: CROSSLINK_CREATED_BY,
          },
        });
      }

      return {
        upserted: analysis.desiredLinks.length,
        deleted: deleteIds.length,
      };
    });

    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        output: {
          pipelineItemId: analysis.item.id,
          flags: {
            isDup: analysis.isDup,
            dupMasterId: analysis.dupMasterId,
            isHeadlineCandidate: analysis.isHeadlineCandidate,
            headlineScore: analysis.headlineScore,
            isPublished: analysis.isPublished,
            publishedMatchIds: analysis.publishedMatchIds,
          },
          links: analysis.desiredLinks.map((link) => ({
            toItemId: link.toItemId,
            linkType: link.linkType,
            score: link.score,
            note: link.note,
          })),
          linksDeleted: result.deleted,
        } as Prisma.InputJsonObject,
      },
    });

    return result;
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

function buildPublishedKeyMaps(items: PublishedItem[]): {
  itemIds: Set<string>;
  canonical: Map<string, string[]>;
  url: Map<string, string[]>;
  title: Map<string, string[]>;
} {
  const itemIds = new Set<string>();
  const canonical = new Map<string, string[]>();
  const url = new Map<string, string[]>();
  const title = new Map<string, string[]>();

  for (const item of items) {
    itemIds.add(item.id);
    addMapEntry(canonical, normalizeUrlKey(item.canonicalUrl || item.url), item.id);
    addMapEntry(url, normalizeUrlKey(item.url), item.id);
    addMapEntry(title, normalizeTitleKey(item.title), item.id);
  }

  return { itemIds, canonical, url, title };
}

function getLatestClassification(item: PipelineItemForCrosslink): LatestClassification | null {
  return item.classifications[0] || null;
}

function getLatestRun(item: PipelineItemForCrosslink): LatestStepRun | null {
  return item.runs[0] || null;
}

export async function crosslinkPipelineItems(
  prisma: PrismaClient,
  options: CrosslinkOptions = {},
): Promise<CrosslinkMetrics> {
  const logger = options.logger || console;
  const startedAt = new Date();
  const dryRun = Boolean(options.dryRun);
  const limit = parseLimit(options.limit);
  const publishedLookbackDays = parsePublishedLookbackDays();
  const publishedSince = new Date(startedAt.getTime() - publishedLookbackDays * 24 * 60 * 60 * 1000);
  const platforms = uniq(
    (options.platforms || [])
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );

  const where: {
    normalizedAt: { not: null };
    platform?: { in: string[] };
  } = {
    normalizedAt: { not: null },
  };

  if (platforms.length > 0) {
    where.platform = { in: platforms };
  }

  const rawItems = await prisma.pipelineItem.findMany({
    where,
    include: {
      classifications: {
        orderBy: { classifiedAt: "desc" },
        take: 1,
        select: {
          id: true,
          noise: true,
          score: true,
          primaryTag: true,
          actionTag: true,
          isHeadlineCandidate: true,
          isDup: true,
          isPublished: true,
          updatedAt: true,
        },
      },
      runs: {
        where: { step: CROSSLINK_STEP },
        orderBy: { attempt: "desc" },
        take: 1,
        select: {
          id: true,
          attempt: true,
          inputHash: true,
          status: true,
        },
      },
    },
    orderBy: [{ publishedAt: "desc" }, { ingestedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(limit * 3, limit),
  });

  const candidateItems = rawItems
    .filter((item) => {
      const classification = getLatestClassification(item);
      return Boolean(classification && !classification.noise);
    })
    .slice(0, limit);

  const publishedBindings = await prisma.newsletterBinding.findMany({
    where: {
      edition: {
        status: "published",
        publishedAt: {
          gte: publishedSince,
        },
      },
    },
    select: {
      pipelineItem: {
        select: {
          id: true,
          url: true,
          canonicalUrl: true,
          title: true,
        },
      },
    },
  });

  const publishedItemsMap = new Map<string, PublishedItem>();
  for (const binding of publishedBindings) {
    if (!binding.pipelineItem) continue;
    if (publishedItemsMap.has(binding.pipelineItem.id)) continue;
    publishedItemsMap.set(binding.pipelineItem.id, {
      id: binding.pipelineItem.id,
      url: binding.pipelineItem.url,
      canonicalUrl: binding.pipelineItem.canonicalUrl,
      title: binding.pipelineItem.title,
    });
  }

  const publishedItems = [...publishedItemsMap.values()];
  const publishedKeyMaps = buildPublishedKeyMaps(publishedItems);

  const counter = createCounter();
  const previews: CrosslinkPreview[] = [];

  const analysisById = new Map<string, ItemAnalysis>();
  const itemIds = candidateItems.map((item) => item.id);
  const itemIdToIndex = new Map(itemIds.map((id, index) => [id, index] as const));

  for (const item of candidateItems) {
    const classification = getLatestClassification(item);
    if (!classification) continue;

    analysisById.set(item.id, {
      item,
      classification,
      isDup: false,
      dupMasterId: null,
      dupReasons: [],
      isPublished: false,
      publishedMatchIds: [],
      isHeadlineCandidate: false,
      headlineScore: 0,
      headlineReasons: [],
      desiredLinks: [],
      inputHash: "",
    });
  }

  const unionFind = new UnionFind(itemIds.length);
  const pairEvidence = new Map<string, Set<string>>();

  const canonicalGroups = new Map<string, string[]>();
  const urlGroups = new Map<string, string[]>();
  const titleGroups = new Map<string, string[]>();

  for (const item of candidateItems) {
    addMapEntry(canonicalGroups, normalizeUrlKey(item.canonicalUrl || item.url), item.id);
    addMapEntry(urlGroups, normalizeUrlKey(item.url), item.id);
    addMapEntry(titleGroups, normalizeTitleKey(item.title), item.id);
  }

  const applyGroups = (groups: Map<string, string[]>, reason: string) => {
    for (const group of groups.values()) {
      const uniqueGroup = uniq(group);
      if (uniqueGroup.length <= 1) continue;

      const baseIndex = itemIdToIndex.get(uniqueGroup[0]);
      if (baseIndex === undefined) continue;

      for (let i = 1; i < uniqueGroup.length; i += 1) {
        const nextIndex = itemIdToIndex.get(uniqueGroup[i]);
        if (nextIndex === undefined) continue;
        unionFind.union(baseIndex, nextIndex);
      }

      for (let i = 0; i < uniqueGroup.length; i += 1) {
        for (let j = i + 1; j < uniqueGroup.length; j += 1) {
          addPairEvidence(pairEvidence, uniqueGroup[i], uniqueGroup[j], reason);
        }
      }
    }
  };

  applyGroups(canonicalGroups, "canonical_url_match");
  applyGroups(urlGroups, "url_match");
  applyGroups(titleGroups, "title_exact_match");

  const clusters = groupByRoot(itemIds, unionFind);

  for (const clusterIds of clusters.values()) {
    if (clusterIds.length <= 1) continue;

    const clusterItems = clusterIds
      .map((id) => analysisById.get(id))
      .filter((analysis): analysis is ItemAnalysis => Boolean(analysis));

    if (clusterItems.length <= 1) continue;

    clusterItems.sort((a, b) => {
      const detailDiff = scoreDetail(b.item) - scoreDetail(a.item);
      if (detailDiff !== 0) return detailDiff;
      return sortByRecencyThenId(a.item, b.item);
    });

    const master = clusterItems[0];

    for (let i = 1; i < clusterItems.length; i += 1) {
      const current = clusterItems[i];
      const evidence = pairEvidence.get(pairKey(current.item.id, master.item.id));
      const reasons = inferDupReasons(current.item, master.item, evidence);
      const score = matchScoreFromReasons(reasons);

      current.isDup = true;
      current.dupMasterId = master.item.id;
      current.dupReasons = reasons;
      current.desiredLinks.push({
        toItemId: master.item.id,
        linkType: DUP_LINK_TYPE,
        score,
        note: reasons.join(","),
      });
    }
  }

  const publishedItemsById = new Map(publishedItems.map((item) => [item.id, item]));

  for (const analysis of analysisById.values()) {
    const matchReasonsById = new Map<string, Set<string>>();

    const registerMatch = (matchedId: string, reason: string) => {
      const entry = matchReasonsById.get(matchedId);
      if (entry) {
        entry.add(reason);
      } else {
        matchReasonsById.set(matchedId, new Set([reason]));
      }
    };

    if (publishedKeyMaps.itemIds.has(analysis.item.id)) {
      registerMatch(analysis.item.id, "direct_binding");
    }

    const canonicalKey = normalizeUrlKey(analysis.item.canonicalUrl || analysis.item.url);
    const urlKey = normalizeUrlKey(analysis.item.url);
    const titleKey = normalizeTitleKey(analysis.item.title);

    for (const id of publishedKeyMaps.canonical.get(canonicalKey || "") || []) {
      registerMatch(id, "canonical_url_match");
    }

    for (const id of publishedKeyMaps.url.get(urlKey || "") || []) {
      registerMatch(id, "url_match");
    }

    for (const id of publishedKeyMaps.title.get(titleKey || "") || []) {
      registerMatch(id, "title_exact_match");
    }

    if (matchReasonsById.size === 0) continue;

    analysis.isPublished = true;
    analysis.publishedMatchIds = [...matchReasonsById.keys()].sort();

    for (const matchId of analysis.publishedMatchIds.slice(0, 5)) {
      const reasons = [...(matchReasonsById.get(matchId) || [])].sort();
      const target = publishedItemsById.get(matchId);
      if (!target) continue;

      analysis.desiredLinks.push({
        toItemId: target.id,
        linkType: PUBLISHED_LINK_TYPE,
        score: matchScoreFromReasons(reasons),
        note: reasons.join(","),
      });
    }
  }

  const headlineCandidates = [...analysisById.values()]
    .filter((analysis) => !analysis.isDup && !analysis.isPublished)
    .map((analysis) => {
      const scored = scoreHeadline(analysis.item, analysis.classification);
      analysis.headlineScore = scored.score;
      analysis.headlineReasons = scored.reasons;
      return analysis;
    })
    .sort((a, b) => {
      if (b.headlineScore !== a.headlineScore) return b.headlineScore - a.headlineScore;
      return sortByRecencyThenId(a.item, b.item);
    });

  if (headlineCandidates.length > 0) {
    const headlineSlots = clamp(Math.ceil(headlineCandidates.length * 0.2), 1, MAX_HEADLINE_SLOTS);
    let selected = headlineCandidates.filter((analysis) => analysis.headlineScore >= MIN_HEADLINE_SCORE).slice(0, headlineSlots);

    if (selected.length === 0) {
      selected = [headlineCandidates[0]];
    }

    for (const analysis of selected) {
      analysis.isHeadlineCandidate = true;
      analysis.desiredLinks.push({
        toItemId: analysis.item.id,
        linkType: HEADLINE_LINK_TYPE,
        score: Number(analysis.headlineScore.toFixed(3)),
        note: analysis.headlineReasons.slice(0, 8).join(","),
      });
    }
  }

  for (const analysis of analysisById.values()) {
    analysis.inputHash = buildInputHash(analysis);
  }

  for (const analysis of analysisById.values()) {
    counter.scanned += 1;

    if (analysis.isDup) counter.dupMarked += 1;
    if (analysis.isPublished) counter.publishedMarked += 1;
    if (analysis.isHeadlineCandidate) counter.headlineMarked += 1;
    counter.linksPlanned += analysis.desiredLinks.length;

    if (previews.length < 20) {
      previews.push({
        pipelineItemId: analysis.item.id,
        platform: analysis.item.platform,
        url: analysis.item.url,
        isDup: analysis.isDup,
        dupMasterId: analysis.dupMasterId,
        isHeadlineCandidate: analysis.isHeadlineCandidate,
        headlineScore: analysis.headlineScore,
        isPublished: analysis.isPublished,
        publishedMatchIds: analysis.publishedMatchIds,
        linkCount: analysis.desiredLinks.length,
      });
    }

    const latestRun = getLatestRun(analysis.item);
    if (latestRun?.status === "completed" && latestRun.inputHash === analysis.inputHash) {
      counter.skippedUnchanged += 1;
      continue;
    }

    counter.candidates += 1;

    try {
      if (!dryRun) {
        const persisted = await persistItemCrosslink(prisma, analysis, analysis.inputHash);
        counter.linksUpserted += persisted.upserted;
        counter.linksDeleted += persisted.deleted;
      }

      counter.processed += 1;
      logger.log(
        `[crosslink] item=${analysis.item.id} dup=${analysis.isDup} headline=${analysis.isHeadlineCandidate} published=${analysis.isPublished} links=${analysis.desiredLinks.length}`,
      );
    } catch (error) {
      counter.failed += 1;
      logger.warn(`[crosslink] item=${analysis.item.id} failed: ${sanitizeErrorMessage(error)}`);
    }
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    dryRun,
    limit,
    platforms: platforms.length > 0 ? platforms : undefined,
    counter,
    previews,
  };
}
