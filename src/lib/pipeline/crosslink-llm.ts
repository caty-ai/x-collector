import { createHash } from "crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { sanitizeText, sanitizeToWellFormed } from "./text-sanitize";

export const CROSSLINK_LLM_STEP = "step4_crosslink_llm";
export const CROSSLINK_LLM_CREATED_BY = "step4_crosslink:llm:v1";
export const CROSSLINK_LLM_PROMPT_VERSION = "step4-crosslink-llm-2026-03-09-v2";
export const CROSSLINK_LLM_DEFAULT_MODEL =
  process.env.STEP4_CROSSLINK_LLM_MODEL ||
  process.env.CROSSLINK_LLM_MODEL ||
  "google/gemini-3.1-flash-lite-preview";

const DUP_LINK_TYPE = "DUP_OF";
const HEADLINE_LINK_TYPE = "HEADLINE_CANDIDATE";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_LIMIT = 600;
const DEFAULT_BATCH_SIZE = 45;
const MIN_BATCH_SIZE = 30;
const MAX_BATCH_SIZE = 150;
const DEFAULT_MAX_SUMMARY_CHARS = 280;
const DEFAULT_MAX_RETRIES = 3;
const MAX_OUTPUT_TOKENS_MIN = 1200;
const MAX_OUTPUT_TOKENS_MAX = 20000;
const OUTPUT_TOKENS_BASE = 2000;
const OUTPUT_TOKENS_PER_ITEM = 200;
const DEFAULT_LOOKBACK_HOURS = 48;
const MAX_PREVIEW = 30;
const OPENROUTER_CHAT_TIMEOUT_MS = 120_000;
export const FAILED_FALLBACK_INPUT_HASH_PREFIX = "llm_error_fallback::";
const TRANSIENT_FALLBACK_REASONS = new Set([
  "llm_batch_error_fallback",
  "length_truncation_fallback",
  "llm_missing_item_output",
]);

const JSON_SCHEMA = {
  name: "xcollector_step4_crosslink_llm",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            headlineCandidate: { type: "boolean" },
            headlineScore: { type: "number", minimum: 0, maximum: 100 },
            dupCluster: { type: ["string", "null"] },
            canonicalId: { type: ["string", "null"] },
            dupScore: { type: ["number", "null"], minimum: 0, maximum: 1 },
            priorityReason: { type: "string" },
            priorityScore: { type: "number", minimum: 0, maximum: 100 },
          },
          required: [
            "id",
            "headlineCandidate",
            "headlineScore",
            "dupCluster",
            "canonicalId",
            "dupScore",
            "priorityReason",
            "priorityScore",
          ],
        },
      },
    },
    required: ["items"],
  },
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
  primaryTag: string | null;
  subTag: string | null;
  actionTag: string | null;
  score: number | null;
  isHeadlineCandidate: boolean;
  isDup: boolean;
  isPublished: boolean;
  updatedAt: Date;
  classifiedAt: Date;
}

const CROSSLINK_LLM_ITEM_SELECT = {
  id: true,
  platform: true,
  title: true,
  body: true,
  url: true,
  canonicalUrl: true,
  publishedAt: true,
  ingestedAt: true,
  raw: true,
  createdAt: true,
  classifications: {
    orderBy: { classifiedAt: "desc" },
    take: 1,
    select: {
      id: true,
      noise: true,
      primaryTag: true,
      subTag: true,
      actionTag: true,
      score: true,
      isHeadlineCandidate: true,
      isDup: true,
      isPublished: true,
      updatedAt: true,
      classifiedAt: true,
    },
  },
  runs: {
    where: { step: CROSSLINK_LLM_STEP },
    orderBy: { attempt: "desc" },
    take: 1,
    select: {
      id: true,
      attempt: true,
      inputHash: true,
      status: true,
    },
  },
} satisfies Prisma.PipelineItemSelect;

type PipelineItemForCrosslinkLlm = Prisma.PipelineItemGetPayload<{
  select: typeof CROSSLINK_LLM_ITEM_SELECT;
}>;

interface DateWindow {
  dateKey: string;
  targetDateJst: Date;
  startUtc: Date;
  endUtcExclusive: Date;
}

interface PrefilterSeed {
  clusterId: string;
  canonicalItemId: string;
  seedScore: number;
  seedReason: string;
  isPrunedByRule: boolean;
}

interface ItemPayload {
  id: string;
  platform: string;
  title: string;
  shortSummary: string;
  tags: {
    primary: string | null;
    sub: string | null;
    action: string | null;
    score: number | null;
  };
  keyLinks: string[];
  publishedAt: string | null;
  prefilter: {
    clusterId: string;
    canonicalItemId: string;
    seedScore: number;
    seedReason: string;
    isPrunedByRule: boolean;
  };
}

interface RawLlmDecision {
  id: string;
  headlineCandidate: boolean;
  headlineScore: number;
  dupCluster: string | null;
  canonicalId: string | null;
  dupScore: number | null;
  priorityReason: string;
  priorityScore: number;
}

interface FinalDecision {
  item: PipelineItemForCrosslinkLlm;
  classification: LatestClassification;
  seed: PrefilterSeed;
  payload: ItemPayload;
  inputHash: string;
  batchKey: string;
  headlineCandidate: boolean;
  headlineScore: number;
  dupCluster: string | null;
  canonicalItemId: string | null;
  dupScore: number | null;
  priorityReason: string;
  priorityScore: number;
  llmPayload: Prisma.InputJsonObject | null;
  llmErrorReason: string | null;
  fromExisting: boolean;
}

export interface CrosslinkLlmOptions {
  dryRun?: boolean;
  dateJst?: Date;
  limit?: number;
  platforms?: string[];
  batchSize?: number;
  model?: string;
  promptVersion?: string;
  apiKey?: string;
  maxRetries?: number;
  maxOutputTokens?: number;
  maxSummaryChars?: number;
  maxBatches?: number;
  pendingOnly?: boolean;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface CrosslinkLlmCounter {
  scanned: number;
  inWindow: number;
  noiseExcluded: number;
  selected: number;
  prefilterClusters: number;
  prefilterPruned: number;
  llmCandidates: number;
  llmBatches: number;
  llmCalls: number;
  llmFailedBatches: number;
  llmResolvedItems: number;
  skippedUnchanged: number;
  processed: number;
  persisted: number;
  failed: number;
  dupMarked: number;
  headlineMarked: number;
  linksUpserted: number;
  linksDeleted: number;
}

export interface CrosslinkLlmPreview {
  pipelineItemId: string;
  platform: string;
  headlineCandidate: boolean;
  headlineScore: number;
  dupCluster: string | null;
  canonicalItemId: string | null;
  dupScore: number | null;
  priorityScore: number;
  priorityReason: string;
  prefilterCluster: string;
  prefilterCanonicalItemId: string;
  batchKey: string;
  fromExisting: boolean;
}

export interface CrosslinkLlmMetrics {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  dateJst: string;
  window: {
    startUtc: string;
    endUtcExclusive: string;
  };
  model: string;
  promptVersion: string;
  limit: number;
  batchSize: number;
  pendingOnly: boolean;
  platforms?: string[];
  counter: CrosslinkLlmCounter;
  previews: CrosslinkLlmPreview[];
}

interface PersistResult {
  linksUpserted: number;
  linksDeleted: number;
}

class UnionFind {
  private readonly parent: number[];
  private readonly rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, idx) => idx);
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

function createCounter(): CrosslinkLlmCounter {
  return {
    scanned: 0,
    inWindow: 0,
    noiseExcluded: 0,
    selected: 0,
    prefilterClusters: 0,
    prefilterPruned: 0,
    llmCandidates: 0,
    llmBatches: 0,
    llmCalls: 0,
    llmFailedBatches: 0,
    llmResolvedItems: 0,
    skippedUnchanged: 0,
    processed: 0,
    persisted: 0,
    failed: 0,
    dupMarked: 0,
    headlineMarked: 0,
    linksUpserted: 0,
    linksDeleted: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

class LlmLengthTruncationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmLengthTruncationError";
  }
}

function isLengthTruncationError(error: unknown): boolean {
  return error instanceof LlmLengthTruncationError;
}

function getBatchFailureReason(error: unknown): string {
  return isLengthTruncationError(error) ? "length_truncation" : "llm_batch_error";
}

function formatBatchFailureError(error: unknown): string {
  return `${getBatchFailureReason(error)}: ${sanitizeErrorMessage(error)}`;
}

function normalizeSpaces(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/[\u3000\t\r]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeText(input: string | null | undefined): string {
  return normalizeSpaces(input)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeJsonStrings(value: Prisma.InputJsonValue): {
  value: Prisma.InputJsonValue;
  replacedCount: number;
} {
  if (typeof value === "string") {
    const sanitized = sanitizeToWellFormed(value);
    return { value: sanitized.result, replacedCount: sanitized.replacedCount };
  }

  if (Array.isArray(value)) {
    let replacedCount = 0;
    const result = value.map((entry) => {
      const sanitized = sanitizeJsonStrings(entry as Prisma.InputJsonValue);
      replacedCount += sanitized.replacedCount;
      return sanitized.value;
    }) as Prisma.InputJsonArray;
    return { value: result, replacedCount };
  }

  if (value && typeof value === "object") {
    let replacedCount = 0;
    const result: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, entry] of Object.entries(value as Prisma.InputJsonObject)) {
      const sanitized = sanitizeJsonStrings(entry as Prisma.InputJsonValue);
      replacedCount += sanitized.replacedCount;
      result[key] = sanitized.value;
    }
    return { value: result as Prisma.InputJsonObject, replacedCount };
  }

  return { value, replacedCount: 0 };
}

function normalizeUrlKey(input: string | null | undefined): string | null {
  if (!input) return null;
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/#.*$/, "")
    .replace(/\/?$/, "") || null;
}

function normalizeTitleKey(title: string | null | undefined): string | null {
  const normalized = normalizeText(title);
  if (!normalized || normalized.length < 20) return null;
  return normalized;
}

function parseLimit(raw: number | undefined): number {
  if (!raw || Number.isNaN(raw) || raw <= 0) return DEFAULT_LIMIT;
  return Math.floor(raw);
}

function parseBatchSize(raw: number | undefined): number {
  if (!raw || Number.isNaN(raw) || raw <= 0) return DEFAULT_BATCH_SIZE;
  return clamp(Math.floor(raw), MIN_BATCH_SIZE, MAX_BATCH_SIZE);
}

function deriveMaxOutputTokens(batchSize: number): number {
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  return clamp(
    OUTPUT_TOKENS_BASE + safeBatchSize * OUTPUT_TOKENS_PER_ITEM,
    MAX_OUTPUT_TOKENS_MIN,
    MAX_OUTPUT_TOKENS_MAX,
  );
}

function parseMaxSummaryChars(raw: number | undefined): number {
  if (!raw || Number.isNaN(raw) || raw <= 0) return DEFAULT_MAX_SUMMARY_CHARS;
  return clamp(Math.floor(raw), 120, 1200);
}

function parseMaxRetries(raw: number | undefined): number {
  if (!raw || Number.isNaN(raw) || raw <= 0) return DEFAULT_MAX_RETRIES;
  return clamp(Math.floor(raw), 1, 8);
}

function parseMaxOutputTokens(raw: number | undefined, batchSize: number): number {
  if (!raw || Number.isNaN(raw) || raw <= 0) return deriveMaxOutputTokens(batchSize);
  return clamp(Math.floor(raw), MAX_OUTPUT_TOKENS_MIN, MAX_OUTPUT_TOKENS_MAX);
}

function parseLookbackHours(): number {
  const raw = process.env.STEP4_LOOKBACK_HOURS;
  if (!raw) return DEFAULT_LOOKBACK_HOURS;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_LOOKBACK_HOURS;
  return parsed;
}

function getDateKeyInJst(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function parseJstDate(raw?: Date): DateWindow {
  const dateKey = raw ? getDateKeyInJst(raw) : getDateKeyInJst(new Date());
  const targetDateJst = new Date(`${dateKey}T00:00:00.000+09:00`);
  const startUtc = new Date(targetDateJst);
  const endUtcExclusive = new Date(startUtc.getTime() + ONE_DAY_MS);

  return {
    dateKey,
    targetDateJst,
    startUtc,
    endUtcExclusive,
  };
}

function buildRollingWindow(lookbackHours: number): DateWindow {
  const now = new Date();
  const startUtc = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  const dateKey = getDateKeyInJst(now);
  // Anchor targetDateJst at JST midnight of today so the DB upsert key is
  // stable across multiple runs on the same calendar day.
  const targetDateJst = new Date(`${dateKey}T00:00:00.000+09:00`);
  return {
    dateKey,
    targetDateJst,
    startUtc,
    endUtcExclusive: now,
  };
}

function buildWindowWhere(window: DateWindow): Prisma.PipelineItemWhereInput {
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

function getLatestClassification(item: PipelineItemForCrosslinkLlm): LatestClassification | null {
  return item.classifications[0] || null;
}

function getLatestRun(item: PipelineItemForCrosslinkLlm): LatestStepRun | null {
  return item.runs[0] || null;
}

function summarizeBody(item: PipelineItemForCrosslinkLlm, maxChars: number): string {
  const text = normalizeSpaces(item.body) || normalizeSpaces(item.title);
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

function extractRawLinks(raw: unknown): string[] {
  const links: string[] = [];
  const payload = (raw || {}) as any;

  const enrichmentLinks = payload?.enrichment?.linkContents;
  if (Array.isArray(enrichmentLinks)) {
    for (const entry of enrichmentLinks) {
      const url = typeof entry?.url === "string" ? entry.url : "";
      if (url) links.push(url);
    }
  }

  const youtubeDescriptionUrls = payload?.enrichment?.youtubeTranscript?.descriptionUrls;
  if (Array.isArray(youtubeDescriptionUrls)) {
    for (const url of youtubeDescriptionUrls) {
      if (typeof url === "string" && url.length > 0) {
        links.push(url);
      }
    }
  }

  const dataLinks = payload?.data?.links;
  if (Array.isArray(dataLinks)) {
    for (const link of dataLinks) {
      if (typeof link === "string" && link.length > 0) {
        links.push(link);
      } else if (typeof link?.url === "string" && link.url.length > 0) {
        links.push(link.url);
      }
    }
  }

  return links;
}

function collectKeyLinks(item: PipelineItemForCrosslinkLlm): string[] {
  const rawLinks = extractRawLinks(item.raw);
  const links = uniq([item.url, item.canonicalUrl || "", ...rawLinks]);
  return links.slice(0, 6);
}

function scoreDetail(item: PipelineItemForCrosslinkLlm): number {
  const bodyLen = normalizeSpaces(item.body).length;
  const titleLen = normalizeSpaces(item.title).length;
  const base = Math.min(bodyLen, 3500) * 1.0 + Math.min(titleLen, 220) * 1.6;
  const canonicalBonus = item.canonicalUrl ? 18 : 0;
  const publishedBonus = item.publishedAt ? 12 : 0;
  return Number((base + canonicalBonus + publishedBonus).toFixed(3));
}

function recencyTs(item: PipelineItemForCrosslinkLlm): number {
  return (item.publishedAt || item.ingestedAt || item.createdAt).getTime();
}

function sortByDetailRecency(a: PipelineItemForCrosslinkLlm, b: PipelineItemForCrosslinkLlm): number {
  const detailDiff = scoreDetail(b) - scoreDetail(a);
  if (detailDiff !== 0) return detailDiff;

  const recencyDiff = recencyTs(b) - recencyTs(a);
  if (recencyDiff !== 0) return recencyDiff;

  return a.id.localeCompare(b.id);
}

function tokenizeTitle(title: string | null | undefined): string[] {
  const normalized = normalizeText(title);
  if (!normalized) return [];

  return uniq(
    normalized
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 4),
  );
}

function titleJaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  if (union === 0) return 0;
  return intersection / union;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function buildPrefilterSeeds(
  items: PipelineItemForCrosslinkLlm[],
  dateKey: string,
): {
  seeds: Map<string, PrefilterSeed>;
  canonicalIds: string[];
  clusterCount: number;
  prunedCount: number;
} {
  const itemIds = items.map((item) => item.id);
  const indexById = new Map(itemIds.map((id, idx) => [id, idx] as const));
  const byCanonical = new Map<string, string[]>();
  const byUrl = new Map<string, string[]>();
  const byTitle = new Map<string, string[]>();

  const tokensByIndex: string[][] = [];
  const tokenIndex = new Map<string, number[]>();

  const union = new UnionFind(items.length);
  const reasonByPair = new Map<string, { score: number; reason: string }>();

  const addGroup = (map: Map<string, string[]>, key: string | null, id: string) => {
    if (!key) return;
    const bucket = map.get(key);
    if (bucket) bucket.push(id);
    else map.set(key, [id]);
  };

  const markPair = (a: string, b: string, score: number, reason: string) => {
    if (a === b) return;
    const key = pairKey(a, b);
    const current = reasonByPair.get(key);
    if (!current || current.score < score) {
      reasonByPair.set(key, { score, reason });
    }
  };

  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx];
    addGroup(byCanonical, normalizeUrlKey(item.canonicalUrl || item.url), item.id);
    addGroup(byUrl, normalizeUrlKey(item.url), item.id);
    addGroup(byTitle, normalizeTitleKey(item.title), item.id);

    const tokens = tokenizeTitle(item.title);
    tokensByIndex[idx] = tokens;
    for (const token of tokens) {
      const bucket = tokenIndex.get(token);
      if (bucket) bucket.push(idx);
      else tokenIndex.set(token, [idx]);
    }
  }

  const applyExactGroups = (groups: Map<string, string[]>, reason: string, score: number) => {
    for (const group of groups.values()) {
      const uniqGroup = uniq(group);
      if (uniqGroup.length <= 1) continue;

      const anchor = indexById.get(uniqGroup[0]);
      if (anchor === undefined) continue;

      for (let i = 1; i < uniqGroup.length; i += 1) {
        const idx = indexById.get(uniqGroup[i]);
        if (idx === undefined) continue;
        union.union(anchor, idx);
      }

      for (let i = 0; i < uniqGroup.length; i += 1) {
        for (let j = i + 1; j < uniqGroup.length; j += 1) {
          markPair(uniqGroup[i], uniqGroup[j], score, reason);
        }
      }
    }
  };

  applyExactGroups(byCanonical, "canonical_url_match", 1);
  applyExactGroups(byUrl, "url_match", 0.96);
  applyExactGroups(byTitle, "title_exact_match", 0.9);

  for (let i = 0; i < items.length; i += 1) {
    const baseTokens = tokensByIndex[i] || [];
    if (baseTokens.length < 4) continue;

    const candidateIndexes = new Set<number>();
    for (const token of baseTokens.slice(0, 4)) {
      const hits = tokenIndex.get(token) || [];
      for (const idx of hits) {
        if (idx > i) candidateIndexes.add(idx);
      }
    }

    let inspected = 0;
    for (const j of candidateIndexes) {
      if (inspected >= 80) break;
      inspected += 1;

      const otherTokens = tokensByIndex[j] || [];
      if (otherTokens.length < 4) continue;

      const sim = titleJaccard(baseTokens, otherTokens);
      if (sim >= 0.82) {
        union.union(i, j);
        markPair(items[i].id, items[j].id, Number(sim.toFixed(3)), "title_similarity");
      }
    }
  }

  const byRoot = new Map<number, string[]>();
  for (let idx = 0; idx < items.length; idx += 1) {
    const root = union.find(idx);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(items[idx].id);
    else byRoot.set(root, [items[idx].id]);
  }

  const seeds = new Map<string, PrefilterSeed>();
  const canonicalIds: string[] = [];
  let clusterSerial = 0;
  let prunedCount = 0;

  for (const memberIds of byRoot.values()) {
    clusterSerial += 1;
    const clusterId = `${dateKey}-c${String(clusterSerial).padStart(4, "0")}`;
    const memberItems = memberIds
      .map((id) => items[indexById.get(id) || 0])
      .sort(sortByDetailRecency);

    const canonical = memberItems[0];
    canonicalIds.push(canonical.id);

    for (const member of memberItems) {
      const isPrunedByRule = member.id !== canonical.id;
      if (isPrunedByRule) prunedCount += 1;

      const evidence = reasonByPair.get(pairKey(member.id, canonical.id));
      seeds.set(member.id, {
        clusterId,
        canonicalItemId: canonical.id,
        seedScore: isPrunedByRule ? evidence?.score || 0.76 : 0,
        seedReason: isPrunedByRule ? evidence?.reason || "cluster_similarity" : "cluster_canonical",
        isPrunedByRule,
      });
    }
  }

  return {
    seeds,
    canonicalIds,
    clusterCount: byRoot.size,
    prunedCount,
  };
}

function buildPayload(
  item: PipelineItemForCrosslinkLlm,
  classification: LatestClassification,
  seed: PrefilterSeed,
  maxSummaryChars: number,
): ItemPayload {
  return {
    id: item.id,
    platform: item.platform,
    title: normalizeSpaces(item.title),
    shortSummary: summarizeBody(item, maxSummaryChars),
    tags: {
      primary: classification.primaryTag,
      sub: classification.subTag,
      action: classification.actionTag,
      score: classification.score,
    },
    keyLinks: collectKeyLinks(item),
    publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
    prefilter: {
      clusterId: seed.clusterId,
      canonicalItemId: seed.canonicalItemId,
      seedScore: seed.seedScore,
      seedReason: seed.seedReason,
      isPrunedByRule: seed.isPrunedByRule,
    },
  };
}

export function buildInputHash(params: {
  title: string;
  shortSummary: string;
  tags: ItemPayload["tags"];
  keyLinks: string[];
  model: string;
  promptVersion: string;
}): string {
  const serialized = JSON.stringify({
    title: params.title,
    shortSummary: params.shortSummary,
    tags: params.tags,
    keyLinks: params.keyLinks,
    model: params.model,
    promptVersion: params.promptVersion,
  });
  return createHash("sha256").update(serialized).digest("hex");
}

function parseOpenRouterJson(raw: string): unknown {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    throw new Error("LLM response content is empty");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error(`LLM response is not valid JSON: ${trimmed.slice(0, 240)}`);
  }
}

function normalizeLlmDecision(raw: unknown, batchIds: Set<string>): RawLlmDecision[] {
  const obj = (raw || {}) as Record<string, unknown>;
  const list = Array.isArray(obj.items) ? obj.items : [];
  const decisions: RawLlmDecision[] = [];

  for (const row of list) {
    const item = (row || {}) as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : "";
    if (!id || !batchIds.has(id)) continue;

    const headlineCandidate = Boolean(item.headlineCandidate);
    const headlineScore =
      typeof item.headlineScore === "number" && Number.isFinite(item.headlineScore)
        ? clamp(item.headlineScore, 0, 100)
        : 0;
    const dupCluster = typeof item.dupCluster === "string" ? item.dupCluster.trim() || null : null;

    const rawCanonicalId = typeof item.canonicalId === "string" ? item.canonicalId : null;
    const canonicalId = rawCanonicalId && batchIds.has(rawCanonicalId) ? rawCanonicalId : null;

    const dupScore =
      typeof item.dupScore === "number" && Number.isFinite(item.dupScore)
        ? clamp(item.dupScore, 0, 1)
        : null;

    const priorityReason =
      typeof item.priorityReason === "string" && item.priorityReason.trim().length > 0
        ? item.priorityReason.trim().slice(0, 700)
        : "not_provided";

    const priorityScore =
      typeof item.priorityScore === "number" && Number.isFinite(item.priorityScore)
        ? clamp(item.priorityScore, 0, 100)
        : 0;

    decisions.push({
      id,
      headlineCandidate,
      headlineScore: Number(headlineScore.toFixed(3)),
      dupCluster,
      canonicalId,
      dupScore: dupScore !== null ? Number(dupScore.toFixed(3)) : null,
      priorityReason,
      priorityScore: Number(priorityScore.toFixed(3)),
    });
  }

  return decisions;
}

function getOpenRouterRetryDelayMs(error: unknown, attempt: number): number {
  const message = sanitizeErrorMessage(error).toLowerCase();
  if (message.includes("openrouter 429") || message.includes("rate limit")) {
    return Math.min(15000, 2500 * attempt);
  }
  return Math.min(5000, 700 * attempt);
}

async function callOpenRouterBatch(params: {
  apiKey: string;
  model: string;
  promptVersion: string;
  dateJst: string;
  batchKey: string;
  items: ItemPayload[];
  maxRetries: number;
  maxOutputTokens: number;
}): Promise<RawLlmDecision[]> {
  const {
    apiKey,
    model,
    promptVersion,
    dateJst,
    batchKey,
    items,
    maxRetries,
    maxOutputTokens,
  } = params;

  const systemPrompt = [
    "You are the editorial desk for a daily AI newspaper.",
    "Skilled reporters have already pre-screened and tagged these items (Step1-3).",
    "Your desk mission: choose front-page candidates, consolidate duplicates, and set practical priority.",
    "Return STRICT JSON only that matches the provided schema.",
    "Scoring definitions:",
    "- headlineScore (0-100): front-page news value (timeliness, impact breadth, originality/source quality, business relevance).",
    "- priorityScore (0-100): practical action value for AI practitioners (immediate applicability, decision usefulness).",
    "Duplicate and canonical policy:",
    "- Group reports of the same event/announcement across sources into the same dupCluster.",
    "- canonicalId must be one of IDs in this batch or null.",
    "- Select canonicalId by source authority, information density, specificity, and downstream reference utility.",
    "- If an item is duplicate, set headlineCandidate=false unless it is the canonical representative.",
    "Tag usage policy:",
    "- primaryTag/subTag/actionTag are useful hints.",
    "- actionTag=APPLY is a positive signal for priorityScore.",
    "- You may override tag implications when cross-item context is clearly stronger.",
    "Reason policy:",
    "- priorityReason must be Japanese, concise, concrete, auditable, and <=100 chars.",
    "- Avoid vague claims; include the deciding factor.",
    "Quality constraints:",
    "- Include every input id exactly once in items.",
    "- Do not output extra keys, prose, or markdown.",
    "- Use prefilter hints (cluster/seed), but override when clearly better.",
    `PromptVersion: ${promptVersion}`,
  ].join("\n");

  const userPayload = {
    dateJst,
    batchKey,
    itemCount: items.length,
    ids: items.map((item) => item.id),
    items,
  };

  const body = {
    model,
    temperature: 0,
    max_tokens: maxOutputTokens,
    response_format: {
      type: "json_schema",
      json_schema: JSON_SCHEMA,
    },
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: JSON.stringify(userPayload),
      },
    ],
  };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://localhost",
    "X-Title": "xcollector-step4-crosslink-llm",
  };

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt += 1) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OPENROUTER_CHAT_TIMEOUT_MS),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`OpenRouter ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
      }

      const choice = payload?.choices?.[0];
      const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
      const content = choice?.message?.content;
      if (finishReason === "length") {
        throw new LlmLengthTruncationError(
          `OpenRouter finish_reason=length batchKey=${batchKey} itemCount=${items.length} max_tokens=${maxOutputTokens}`,
        );
      }

      if (typeof content !== "string") {
        throw new Error(`OpenRouter returned non-text content: ${JSON.stringify(content).slice(0, 200)}`);
      }

      const parsed = parseOpenRouterJson(content);
      const batchIds = new Set(items.map((item) => item.id));
      return normalizeLlmDecision(parsed, batchIds);
    } catch (error) {
      lastError = error;
      if (isLengthTruncationError(error)) {
        throw error;
      }
      if (attempt < maxRetries) {
        const delayMs = getOpenRouterRetryDelayMs(error, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("OpenRouter request failed with unknown error");
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function decisionFromExisting(
  item: PipelineItemForCrosslinkLlm,
  classification: LatestClassification,
  seed: PrefilterSeed,
  payload: ItemPayload,
  inputHash: string,
  batchKey: string,
  existing: {
    headlineCandidate: boolean;
    headlineScore: number | null;
    dupCluster: string | null;
    canonicalItemId: string | null;
    dupScore: number | null;
    priorityReason: string | null;
    priorityScore: number | null;
    llmPayload: Prisma.JsonValue | null;
  },
): FinalDecision {
  const isDup = Boolean(existing.canonicalItemId && existing.canonicalItemId !== item.id);

  return {
    item,
    classification,
    seed,
    payload,
    inputHash,
    batchKey,
    headlineCandidate: !isDup && Boolean(existing.headlineCandidate),
    headlineScore: Number((existing.headlineScore || 0).toFixed(3)),
    dupCluster: existing.dupCluster || seed.clusterId,
    canonicalItemId: isDup ? existing.canonicalItemId : null,
    dupScore: isDup ? Number((existing.dupScore || seed.seedScore || 0.72).toFixed(3)) : null,
    priorityReason: existing.priorityReason || "unchanged_existing_result",
    priorityScore: Number((existing.priorityScore || 0).toFixed(3)),
    llmPayload: (existing.llmPayload as Prisma.InputJsonObject | null) || null,
    llmErrorReason: null,
    fromExisting: true,
  };
}

function fallbackDecision(
  item: PipelineItemForCrosslinkLlm,
  classification: LatestClassification,
  seed: PrefilterSeed,
  payload: ItemPayload,
  inputHash: string,
  batchKey: string,
  reason: string,
  llmErrorReason: string | null = null,
): FinalDecision {
  const isDup = seed.canonicalItemId !== item.id;

  return {
    item,
    classification,
    seed,
    payload,
    inputHash,
    batchKey,
    headlineCandidate: false,
    headlineScore: 0,
    dupCluster: seed.clusterId,
    canonicalItemId: isDup ? seed.canonicalItemId : null,
    dupScore: isDup ? Number((seed.seedScore || 0.72).toFixed(3)) : null,
    priorityReason: reason,
    priorityScore: Number((((classification.score || 0.5) * 100) / 2).toFixed(3)),
    llmPayload: null,
    llmErrorReason,
    fromExisting: false,
  };
}

function convertLlmDecision(
  item: PipelineItemForCrosslinkLlm,
  classification: LatestClassification,
  seed: PrefilterSeed,
  payload: ItemPayload,
  inputHash: string,
  batchKey: string,
  llm: RawLlmDecision,
): FinalDecision {
  const canonicalCandidate = llm.canonicalId;
  const isDup = Boolean(canonicalCandidate && canonicalCandidate !== item.id);

  return {
    item,
    classification,
    seed,
    payload,
    inputHash,
    batchKey,
    headlineCandidate: !isDup && llm.headlineCandidate,
    headlineScore: Number(clamp(llm.headlineScore, 0, 100).toFixed(3)),
    dupCluster: llm.dupCluster || seed.clusterId,
    canonicalItemId: isDup ? canonicalCandidate : null,
    dupScore: isDup ? Number((llm.dupScore ?? seed.seedScore ?? 0.7).toFixed(3)) : null,
    priorityReason: llm.priorityReason || "llm_missing_reason",
    priorityScore: Number(clamp(llm.priorityScore, 0, 100).toFixed(3)),
    llmPayload: llm as unknown as Prisma.InputJsonObject,
    llmErrorReason: null,
    fromExisting: false,
  };
}

function shouldPersistFallbackWithSentinel(decision: FinalDecision): boolean {
  return (
    decision.llmErrorReason != null &&
    TRANSIENT_FALLBACK_REASONS.has(decision.priorityReason)
  );
}

async function persistDecision(
  prisma: PrismaClient,
  decision: FinalDecision,
  targetDateJst: Date,
  model: string,
  promptVersion: string,
  logger: Pick<Console, "warn">,
): Promise<PersistResult> {
  const latestRun = getLatestRun(decision.item);
  const attempt = (latestRun?.attempt || 0) + 1;
  const persistedInputHash =
    !shouldPersistFallbackWithSentinel(decision)
      ? decision.inputHash
      : `${FAILED_FALLBACK_INPUT_HASH_PREFIX}${decision.inputHash}`;

  const run = await prisma.pipelineRun.create({
    data: {
      pipelineItemId: decision.item.id,
      step: CROSSLINK_LLM_STEP,
      status: "running",
      attempt,
      model,
      inputHash: persistedInputHash,
    },
  });

  try {
    const sanitizedPriorityReason = sanitizeToWellFormed(decision.priorityReason);
    const sanitizedLlmPayload = decision.llmPayload ? sanitizeJsonStrings(decision.llmPayload) : null;
    const sanitizedKeyLinks = sanitizeJsonStrings(
      decision.payload.keyLinks as unknown as Prisma.InputJsonValue,
    );
    const priorityReason = sanitizedPriorityReason.result;
    const replacedCount =
      sanitizedPriorityReason.replacedCount +
      (sanitizedLlmPayload?.replacedCount || 0) +
      sanitizedKeyLinks.replacedCount;
    if (replacedCount > 0) {
      logger.warn(
        `[crosslink-llm] item=${decision.item.id} sanitized ill-formed code units before decision write: priorityReason=${sanitizedPriorityReason.replacedCount} llmPayload=${sanitizedLlmPayload?.replacedCount || 0} keyLinks=${sanitizedKeyLinks.replacedCount}`,
      );
    }

    const persisted = await prisma.$transaction(async (tx) => {
      await tx.pipelineCrosslinkLlmDecision.upsert({
        where: {
          targetDateJst_pipelineItemId_model_promptVersion: {
            targetDateJst,
            pipelineItemId: decision.item.id,
            model,
            promptVersion,
          },
        },
        create: {
          pipelineItemId: decision.item.id,
          targetDateJst,
          model,
          promptVersion,
          batchKey: decision.batchKey,
          inputHash: persistedInputHash,
          headlineCandidate: decision.headlineCandidate,
          headlineScore: decision.headlineScore,
          dupCluster: decision.dupCluster,
          canonicalItemId: decision.canonicalItemId,
          dupScore: decision.dupScore,
          priorityReason,
          priorityScore: decision.priorityScore,
          prefilterCluster: decision.seed.clusterId,
          prefilterCanonicalItemId: decision.seed.canonicalItemId,
          prefilterScore: decision.seed.seedScore,
          keyLinks: sanitizedKeyLinks.value,
          llmPayload: (sanitizedLlmPayload?.value as Prisma.InputJsonObject | undefined) ?? Prisma.JsonNull,
        },
        update: {
          batchKey: decision.batchKey,
          inputHash: persistedInputHash,
          headlineCandidate: decision.headlineCandidate,
          headlineScore: decision.headlineScore,
          dupCluster: decision.dupCluster,
          canonicalItemId: decision.canonicalItemId,
          dupScore: decision.dupScore,
          priorityReason,
          priorityScore: decision.priorityScore,
          prefilterCluster: decision.seed.clusterId,
          prefilterCanonicalItemId: decision.seed.canonicalItemId,
          prefilterScore: decision.seed.seedScore,
          keyLinks: sanitizedKeyLinks.value,
          llmPayload: (sanitizedLlmPayload?.value as Prisma.InputJsonObject | undefined) ?? Prisma.JsonNull,
        },
      });

      await tx.pipelineClassification.update({
        where: { id: decision.classification.id },
        data: {
          isDup: Boolean(decision.canonicalItemId),
          isHeadlineCandidate: !decision.canonicalItemId && decision.headlineCandidate,
        },
      });

      const desiredLinks: Array<{ toItemId: string; linkType: string; score: number; note: string }> = [];

      if (decision.canonicalItemId && decision.canonicalItemId !== decision.item.id) {
        desiredLinks.push({
          toItemId: decision.canonicalItemId,
          linkType: DUP_LINK_TYPE,
          score: Number((decision.dupScore || 0.72).toFixed(3)),
          note: `${decision.dupCluster || decision.seed.clusterId}:${priorityReason}`.slice(0, 1000),
        });
      }

      if (!decision.canonicalItemId && decision.headlineCandidate) {
        desiredLinks.push({
          toItemId: decision.item.id,
          linkType: HEADLINE_LINK_TYPE,
          score: Number(decision.headlineScore.toFixed(3)),
          note: priorityReason.slice(0, 1000),
        });
      }

      const existingLinks = await tx.pipelineLink.findMany({
        where: {
          fromItemId: decision.item.id,
          createdBy: CROSSLINK_LLM_CREATED_BY,
          linkType: {
            in: [DUP_LINK_TYPE, HEADLINE_LINK_TYPE],
          },
        },
        select: {
          id: true,
          toItemId: true,
          linkType: true,
        },
      });

      const desiredKeys = new Set(desiredLinks.map((link) => `${link.linkType}::${link.toItemId}`));
      const deleteIds = existingLinks
        .filter((link) => !desiredKeys.has(`${link.linkType}::${link.toItemId}`))
        .map((link) => link.id);

      if (deleteIds.length > 0) {
        await tx.pipelineLink.deleteMany({
          where: { id: { in: deleteIds } },
        });
      }

      for (const link of desiredLinks) {
        await tx.pipelineLink.upsert({
          where: {
            fromItemId_toItemId_linkType: {
              fromItemId: decision.item.id,
              toItemId: link.toItemId,
              linkType: link.linkType,
            },
          },
          create: {
            fromItemId: decision.item.id,
            toItemId: link.toItemId,
            linkType: link.linkType,
            score: link.score,
            note: link.note,
            createdBy: CROSSLINK_LLM_CREATED_BY,
          },
          update: {
            score: link.score,
            note: link.note,
            createdBy: CROSSLINK_LLM_CREATED_BY,
          },
        });
      }

      const output = {
        pipelineItemId: decision.item.id,
        dateJst: getDateKeyInJst(targetDateJst),
        model,
        promptVersion,
        batchKey: decision.batchKey,
        headlineCandidate: decision.headlineCandidate,
        headlineScore: decision.headlineScore,
        dupCluster: decision.dupCluster,
        canonicalItemId: decision.canonicalItemId,
        dupScore: decision.dupScore,
        priorityReason,
        priorityScore: decision.priorityScore,
        ...(decision.llmErrorReason ? { llmErrorReason: sanitizeText(decision.llmErrorReason) } : {}),
      } as Prisma.InputJsonObject;

      await tx.pipelineRun.update({
        where: { id: run.id },
        data: {
          status: "completed",
          finishedAt: new Date(),
          error: decision.llmErrorReason == null ? decision.llmErrorReason : sanitizeText(decision.llmErrorReason),
          output,
        },
      });

      return {
        linksUpserted: desiredLinks.length,
        linksDeleted: deleteIds.length,
      };
    });

    return persisted;
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

export async function crosslinkPipelineItemsByLlm(
  prisma: PrismaClient,
  options: CrosslinkLlmOptions = {},
): Promise<CrosslinkLlmMetrics> {
  const logger = options.logger || console;
  const startedAt = new Date();

  const dryRun = Boolean(options.dryRun);
  const limit = parseLimit(options.limit);
  const batchSize = parseBatchSize(options.batchSize);
  const maxSummaryChars = parseMaxSummaryChars(options.maxSummaryChars);
  const maxRetries = parseMaxRetries(options.maxRetries);
  const maxOutputTokens = parseMaxOutputTokens(options.maxOutputTokens, batchSize);
  const maxBatches = options.maxBatches && options.maxBatches > 0 ? Math.floor(options.maxBatches) : undefined;
  const pendingOnly = options.pendingOnly !== false;

  const model = (options.model || CROSSLINK_LLM_DEFAULT_MODEL).trim();
  const promptVersion = options.promptVersion || CROSSLINK_LLM_PROMPT_VERSION;
  const window = options.dateJst !== undefined
    ? parseJstDate(options.dateJst)
    : buildRollingWindow(parseLookbackHours());

  const platforms = uniq(
    (options.platforms || [])
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );

  const counter = createCounter();

  logger.log(
    `[step4-llm] start dateJst=${window.dateKey} window=[${window.startUtc.toISOString()}..${window.endUtcExclusive.toISOString()}) model=${model} batchSize=${batchSize} maxOutputTokens=${maxOutputTokens} dryRun=${dryRun}`,
  );

  const where: Prisma.PipelineItemWhereInput = {
    normalizedAt: { not: null },
    ...buildWindowWhere(window),
  };

  if (platforms.length > 0) {
    where.platform = { in: platforms };
  }

  const rawItems = await prisma.pipelineItem.findMany({
    where,
    select: CROSSLINK_LLM_ITEM_SELECT,
    orderBy: [{ publishedAt: "desc" }, { ingestedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(limit * 3, limit),
  });

  counter.scanned = rawItems.length;
  counter.inWindow = rawItems.length;

  const candidates = rawItems
    .map((item) => {
      const classification = getLatestClassification(item);
      if (!classification) return null;
      if (classification.noise) {
        counter.noiseExcluded += 1;
        return null;
      }
      return { item, classification };
    })
    .filter(
      (
        value,
      ): value is {
        item: PipelineItemForCrosslinkLlm;
        classification: LatestClassification;
      } => Boolean(value),
    )
    .slice(0, limit);

  counter.selected = candidates.length;

  logger.log(
    `[step4-llm] selected=${counter.selected} noiseExcluded=${counter.noiseExcluded} (limit=${limit})`,
  );

  const selectedItems = candidates.map((entry) => entry.item);

  const prefilter = buildPrefilterSeeds(selectedItems, window.dateKey);
  counter.prefilterClusters = prefilter.clusterCount;
  counter.prefilterPruned = prefilter.prunedCount;

  logger.log(
    `[step4-llm] prefilter clusters=${counter.prefilterClusters} pruned=${counter.prefilterPruned} canonical=${prefilter.canonicalIds.length}`,
  );

  const candidateById = new Map(candidates.map((entry) => [entry.item.id, entry] as const));

  const payloadById = new Map<string, ItemPayload>();
  const inputHashById = new Map<string, string>();

  for (const entry of candidates) {
    const seed = prefilter.seeds.get(entry.item.id);
    if (!seed) continue;

    const payload = buildPayload(entry.item, entry.classification, seed, maxSummaryChars);
    payloadById.set(entry.item.id, payload);

    // Load-bearing: unchanged-day flag preservation now relies solely on D5
    // classification carry-forward. PR-C must not land (or survive a revert)
    // without PR-B/D5.
    inputHashById.set(
      entry.item.id,
      buildInputHash({
        title: payload.title,
        shortSummary: payload.shortSummary,
        tags: payload.tags,
        keyLinks: payload.keyLinks,
        model,
        promptVersion,
      }),
    );
  }

  const existingRows =
    candidates.length > 0
      ? await prisma.pipelineCrosslinkLlmDecision.findMany({
          where: {
            pipelineItemId: { in: candidates.map((entry) => entry.item.id) },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            pipelineItemId: true,
            inputHash: true,
            headlineCandidate: true,
            headlineScore: true,
            dupCluster: true,
            canonicalItemId: true,
            dupScore: true,
            priorityReason: true,
            priorityScore: true,
            llmPayload: true,
          },
        })
      : [];

  const existingByItemId = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    if (!existingByItemId.has(row.pipelineItemId)) {
      existingByItemId.set(row.pipelineItemId, row);
    }
  }

  const decisionsByItemId = new Map<string, FinalDecision>();

  for (const entry of candidates) {
    const seed = prefilter.seeds.get(entry.item.id);
    const payload = payloadById.get(entry.item.id);
    const inputHash = inputHashById.get(entry.item.id);
    if (!seed || !payload || !inputHash) continue;

    const existing = existingByItemId.get(entry.item.id);
    if (pendingOnly && existing && existing.inputHash === inputHash) {
      const unchanged = decisionFromExisting(
        entry.item,
        entry.classification,
        seed,
        payload,
        inputHash,
        "existing",
        existing,
      );
      decisionsByItemId.set(entry.item.id, unchanged);
      counter.skippedUnchanged += 1;
    }
  }

  const llmCandidateIds = prefilter.canonicalIds.filter((id) => {
    if (!candidateById.has(id)) return false;
    return !decisionsByItemId.has(id);
  });

  counter.llmCandidates = llmCandidateIds.length;

  const prunedCandidateIds = candidates
    .map((entry) => entry.item.id)
    .filter((id) => prefilter.seeds.get(id)?.isPrunedByRule)
    .filter((id) => !decisionsByItemId.has(id));

  for (const id of prunedCandidateIds) {
    const entry = candidateById.get(id);
    const seed = prefilter.seeds.get(id);
    const payload = payloadById.get(id);
    const inputHash = inputHashById.get(id);
    if (!entry || !seed || !payload || !inputHash) continue;

    decisionsByItemId.set(
      id,
      fallbackDecision(
        entry.item,
        entry.classification,
        seed,
        payload,
        inputHash,
        "prefilter",
        `prefilter_dup_of:${seed.canonicalItemId}`,
      ),
    );
  }

  if (llmCandidateIds.length > 0) {
    const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set (required for Step4 LLM crosslink)");
    }

    const llmBatches = chunk(llmCandidateIds, batchSize);
    const targetBatches = typeof maxBatches === "number" ? llmBatches.slice(0, maxBatches) : llmBatches;
    counter.llmBatches = targetBatches.length;

    for (let batchIndex = 0; batchIndex < targetBatches.length; batchIndex += 1) {
      const batchIds = targetBatches[batchIndex];
      const batchItems = batchIds
        .map((id) => payloadById.get(id))
        .filter((value): value is ItemPayload => Boolean(value));

      const batchKey = `${window.dateKey}-b${String(batchIndex + 1).padStart(3, "0")}`;

      logger.log(
        `[step4-llm] LLM batch ${batchIndex + 1}/${targetBatches.length} batchKey=${batchKey} items=${batchItems.length}`,
      );

      try {
        counter.llmCalls += 1;
        const llmDecisions = await callOpenRouterBatch({
          apiKey,
          model,
          promptVersion,
          dateJst: window.dateKey,
          batchKey,
          items: batchItems,
          maxRetries,
          maxOutputTokens,
        });

        const decisionMap = new Map(llmDecisions.map((row) => [row.id, row] as const));
        counter.llmResolvedItems += llmDecisions.length;

        for (const id of batchIds) {
          const entry = candidateById.get(id);
          const seed = prefilter.seeds.get(id);
          const payload = payloadById.get(id);
          const inputHash = inputHashById.get(id);
          if (!entry || !seed || !payload || !inputHash) continue;

          const llm = decisionMap.get(id);
          const finalDecision = llm
            ? convertLlmDecision(
                entry.item,
                entry.classification,
                seed,
                payload,
                inputHash,
                batchKey,
                llm,
              )
            : fallbackDecision(
                entry.item,
                entry.classification,
                seed,
                payload,
                inputHash,
                batchKey,
                "llm_missing_item_output",
                "llm_missing_item_output",
              );

          decisionsByItemId.set(id, finalDecision);
        }

        logger.log(
          `[step4-llm] LLM batch done batchKey=${batchKey} resolved=${llmDecisions.length}/${batchIds.length}`,
        );
      } catch (error) {
        counter.llmFailedBatches += 1;
        const failureReason = getBatchFailureReason(error);
        const persistedError = formatBatchFailureError(error);
        logger.warn(
          `[step4-llm] LLM batch failed batchKey=${batchKey} reason=${failureReason}: ${sanitizeErrorMessage(error)}`,
        );

        for (const id of batchIds) {
          const entry = candidateById.get(id);
          const seed = prefilter.seeds.get(id);
          const payload = payloadById.get(id);
          const inputHash = inputHashById.get(id);
          if (!entry || !seed || !payload || !inputHash) continue;

          decisionsByItemId.set(
            id,
            fallbackDecision(
              entry.item,
              entry.classification,
              seed,
              payload,
              inputHash,
              batchKey,
              failureReason === "length_truncation"
                ? "length_truncation_fallback"
                : "llm_batch_error_fallback",
              persistedError,
            ),
          );
        }
      }
    }
  }

  const finalDecisions = candidates
    .map((entry) => decisionsByItemId.get(entry.item.id))
    .filter((value): value is FinalDecision => Boolean(value));

  for (const decision of finalDecisions) {
    if (decision.canonicalItemId && decision.canonicalItemId !== decision.item.id) {
      counter.dupMarked += 1;
    }
    if (!decision.canonicalItemId && decision.headlineCandidate) {
      counter.headlineMarked += 1;
    }
  }

  const previews: CrosslinkLlmPreview[] = finalDecisions.slice(0, MAX_PREVIEW).map((decision) => ({
    pipelineItemId: decision.item.id,
    platform: decision.item.platform,
    headlineCandidate: decision.headlineCandidate,
    headlineScore: decision.headlineScore,
    dupCluster: decision.dupCluster,
    canonicalItemId: decision.canonicalItemId,
    dupScore: decision.dupScore,
    priorityScore: decision.priorityScore,
    priorityReason: decision.priorityReason,
    prefilterCluster: decision.seed.clusterId,
    prefilterCanonicalItemId: decision.seed.canonicalItemId,
    batchKey: decision.batchKey,
    fromExisting: decision.fromExisting,
  }));

  logger.log(
    `[step4-llm] decisions built=${finalDecisions.length} (existing=${counter.skippedUnchanged}, new=${finalDecisions.length - counter.skippedUnchanged})`,
  );

  if (!dryRun) {
    for (let idx = 0; idx < finalDecisions.length; idx += 1) {
      const decision = finalDecisions[idx];
      if (decision.fromExisting) continue;

      counter.processed += 1;

      try {
        const persisted = await persistDecision(
          prisma,
          decision,
          window.targetDateJst,
          model,
          promptVersion,
          logger,
        );

        counter.persisted += 1;
        counter.linksUpserted += persisted.linksUpserted;
        counter.linksDeleted += persisted.linksDeleted;

        if ((counter.persisted % 25 === 0 || idx === finalDecisions.length - 1) && counter.persisted > 0) {
          logger.log(
            `[step4-llm] persisted ${counter.persisted}/${finalDecisions.length - counter.skippedUnchanged} changed items`,
          );
        }
      } catch (error) {
        counter.failed += 1;
        logger.warn(
          `[step4-llm] persist failed item=${decision.item.id}: ${sanitizeErrorMessage(error)}`,
        );
      }
    }
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    dryRun,
    dateJst: window.dateKey,
    window: {
      startUtc: window.startUtc.toISOString(),
      endUtcExclusive: window.endUtcExclusive.toISOString(),
    },
    model,
    promptVersion,
    limit,
    batchSize,
    pendingOnly,
    platforms: platforms.length > 0 ? platforms : undefined,
    counter,
    previews,
  };
}
