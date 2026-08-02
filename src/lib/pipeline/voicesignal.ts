import { createHash } from "crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { buildEditionSlug, buildEditionTitle, buildEditionWindow, editionKey } from "./edition";
import { sanitizeToWellFormed } from "./text-sanitize";

export const VOICE_SIGNAL_STEP = "step6_voicesignal";
export const VOICE_SIGNAL_MODEL = "rule-based:v1";

const DEFAULT_LIMIT = 50;
const MAX_PREVIEW = 20;
const MAX_SUMMARY_LEN = 240;
const VOICE_SIGNAL_SCAN_BATCH_SIZE = 500;
const VOICE_SIGNAL_LOOKBACK_MS = 48 * 60 * 60 * 1000;

const SOCIAL_PLATFORMS = new Set(["twitter", "facebook", "reddit", "instagram"]);

const TOPIC_FALLBACK_BY_PRIMARY: Record<string, string> = {
  UPDATE: "AI Update",
  MCP_API: "MCP/API",
  TECH: "AI Engineering",
  DEVICE: "AI Device",
  SECURITY: "AI Security",
  REGULATION: "AI Policy",
  BUSINESS: "AI Business",
  COLUMN: "AI Commentary",
  OTHER: "AI General",
};

const POSITIVE_KEYWORDS = [
  "great",
  "good",
  "love",
  "amazing",
  "awesome",
  "excellent",
  "impressive",
  "useful",
  "helpful",
  "fast",
  "faster",
  "stable",
  "smooth",
  "best",
  "solid",
  "works",
  "神",
  "最高",
  "便利",
  "助かる",
  "速い",
  "良い",
  "使える",
  "コスパ",
  "推せる",
  "改善",
] as const;

const NEGATIVE_KEYWORDS = [
  "bad",
  "worse",
  "worst",
  "slow",
  "broken",
  "bug",
  "bugs",
  "issue",
  "error",
  "fail",
  "failing",
  "hate",
  "disappoint",
  "expensive",
  "overpriced",
  "unusable",
  "crash",
  "脆弱",
  "最悪",
  "遅い",
  "高い",
  "重い",
  "微妙",
  "使えない",
  "バグ",
  "不安定",
] as const;

const USAGE_CONTEXT_RULES: Record<string, readonly string[]> = {
  coding: [
    "code",
    "coding",
    "dev",
    "developer",
    "programming",
    "repo",
    "github",
    "pr",
    "pull request",
    "api",
    "sdk",
    "cli",
    "debug",
    "implementation",
    "実装",
    "開発",
    "コード",
    "デバッグ",
  ],
  ideation: [
    "idea",
    "ideation",
    "brainstorm",
    "creative",
    "concept",
    "design",
    "strategy",
    "planning",
    "企画",
    "発想",
    "アイデア",
    "壁打ち",
  ],
  speed: [
    "fast",
    "faster",
    "speed",
    "latency",
    "quick",
    "realtime",
    "response time",
    "throughput",
    "高速",
    "速い",
    "遅い",
    "性能",
  ],
  cost: [
    "cost",
    "price",
    "pricing",
    "cheap",
    "expensive",
    "token",
    "budget",
    "subscription",
    "credit",
    "料金",
    "コスト",
    "高い",
    "安い",
    "課金",
  ],
  automation: [
    "agent",
    "workflow",
    "automation",
    "tool use",
    "mcp",
    "integration",
    "orchestration",
    "自動化",
    "連携",
    "運用",
  ],
  quality: [
    "quality",
    "accuracy",
    "hallucination",
    "reliable",
    "trust",
    "precision",
    "benchmark",
    "品質",
    "精度",
    "信頼",
    "幻覚",
  ],
};

const TOPIC_PATTERNS: Array<{ pattern: RegExp; toTopic: (match: string) => string }> = [
  {
    pattern: /\bgpt[-\s]?\d+(?:\.\d+)?(?:\s*(?:mini|nano|pro|high|turbo|o\d))?/i,
    toTopic: (match) => match.toUpperCase().replace(/\s+/g, " ").trim(),
  },
  {
    pattern: /\bclaude(?:\s+[a-z0-9.-]+){0,2}/i,
    toTopic: (match) => toTitleToken(match),
  },
  {
    pattern: /\bgemini(?:\s+[a-z0-9.-]+){0,2}/i,
    toTopic: (match) => toTitleToken(match),
  },
  {
    pattern: /\bdeepseek(?:\s+[a-z0-9.-]+){0,2}/i,
    toTopic: (match) => toTitleToken(match),
  },
  {
    pattern: /\bqwen(?:\s+[a-z0-9.-]+){0,2}/i,
    toTopic: (match) => toTitleToken(match),
  },
  {
    pattern: /\bllama(?:\s*\d+(?:\.\d+)?)?(?:\s+[a-z0-9.-]+)?/i,
    toTopic: (match) => toTitleToken(match),
  },
  {
    pattern: /\bcursor\b/i,
    toTopic: () => "Cursor",
  },
  {
    pattern: /\bcopilot\b/i,
    toTopic: () => "GitHub Copilot",
  },
  {
    pattern: /\bopenrouter\b/i,
    toTopic: () => "OpenRouter",
  },
  {
    pattern: /\bmodel context protocol\b|\bmcp\b/i,
    toTopic: () => "MCP / API",
  },
  {
    pattern: /\bopenai\b/i,
    toTopic: () => "OpenAI",
  },
  {
    pattern: /\banthropic\b/i,
    toTopic: () => "Anthropic",
  },
];

interface LatestClassification {
  id: number;
  noise: boolean;
  isDup: boolean;
  isPublished: boolean;
  score: number | null;
  primaryTag: string | null;
  actionTag: string | null;
  updatedAt: Date;
  classifiedAt: Date;
}

interface LatestStepRun {
  attempt: number;
  inputHash: string | null;
  status: string;
}

const VOICE_SIGNAL_RECORD_SELECT = {
  id: true,
  pipelineItemId: true,
  editionId: true,
  edition: {
    select: {
      status: true,
    },
  },
  topic: true,
  sentiment: true,
  usageContext: true,
  summary: true,
  model: true,
  confidence: true,
  sampleSize: true,
  createdAt: true,
} satisfies Prisma.VoiceSignalSelect;

type VoiceSignalRecord = Prisma.VoiceSignalGetPayload<{
  select: typeof VOICE_SIGNAL_RECORD_SELECT;
}>;

const VOICE_SIGNAL_ITEM_SELECT = {
  id: true,
  platform: true,
  sourceRef: true,
  title: true,
  body: true,
  url: true,
  canonicalUrl: true,
  publishedAt: true,
  ingestedAt: true,
  raw: true,
  createdAt: true,
  updatedAt: true,
  classifications: {
    orderBy: { classifiedAt: "desc" },
    take: 1,
    select: {
      id: true,
      noise: true,
      isDup: true,
      isPublished: true,
      score: true,
      primaryTag: true,
      actionTag: true,
      updatedAt: true,
      classifiedAt: true,
    },
  },
  runs: {
    where: { step: VOICE_SIGNAL_STEP },
    orderBy: { attempt: "desc" },
    take: 1,
    select: {
      attempt: true,
      inputHash: true,
      status: true,
    },
  },
} satisfies Prisma.PipelineItemSelect;

type PipelineItemForVoiceSignal = Prisma.PipelineItemGetPayload<{
  select: typeof VOICE_SIGNAL_ITEM_SELECT;
}>;

export interface VoiceSignalOptions {
  dryRun?: boolean;
  limit?: number;
  platforms?: string[];
  editionDate?: Date;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface VoiceSignalCounter {
  scanned: number;
  eligible: number;
  selected: number;
  processed: number;
  created: number;
  updated: number;
  skippedUnchanged: number;
  skippedPublishedEdition: number;
  failed: number;
}

export interface VoiceSignalPreview {
  pipelineItemId: string;
  platform: string;
  topic: string;
  sentiment: string;
  usageContext: string;
  confidence: number;
  sampleSize: number;
  editionId: string | null;
  score: number;
}

export interface VoiceSignalMetrics {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  limit: number;
  platforms?: string[];
  editionDate?: string;
  edition: {
    id: string | null;
    found: boolean;
    created: boolean;
  };
  model: string;
  counter: VoiceSignalCounter;
  previews: VoiceSignalPreview[];
}

interface InferredVoiceSignal {
  topic: string;
  sentiment: "positive" | "negative" | "neutral";
  usageContext: string;
  summary: string | null;
  confidence: number;
  sampleSize: number;
  signaledAt: Date;
  matchedSignals: string[];
  editionId: string | null;
}

interface PlannedVoiceSignal {
  item: PipelineItemForVoiceSignal;
  classification: LatestClassification;
  inference: InferredVoiceSignal;
  score: number;
  inputHash: string;
  latestRun: LatestStepRun | null;
}

interface RetainedVoiceSignalCandidates {
  byModel: VoiceSignalRecord | null;
  byEdition: VoiceSignalRecord | null;
  exact: VoiceSignalRecord | null;
}

function createCounter(): VoiceSignalCounter {
  return {
    scanned: 0,
    eligible: 0,
    selected: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skippedUnchanged: 0,
    skippedPublishedEdition: 0,
    failed: 0,
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
  return Math.floor(raw);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSpaces(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/[\u3000\t\r]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeLower(input: string | null | undefined): string {
  return normalizeSpaces(input).toLowerCase();
}

function toEditionDate(input?: Date): Date | undefined {
  if (!input) return undefined;
  const value = new Date(input);
  if (Number.isNaN(value.getTime())) return undefined;
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function formatDateKeyUtc(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getUTCDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002");
}

function recencyTs(item: PipelineItemForVoiceSignal): number {
  return (item.publishedAt || item.ingestedAt || item.createdAt).getTime();
}

function getPrimaryText(item: PipelineItemForVoiceSignal): string {
  return normalizeSpaces(item.body) || normalizeSpaces(item.title) || normalizeSpaces(item.sourceRef);
}

function getCombinedText(item: PipelineItemForVoiceSignal): string {
  return normalizeSpaces([item.title, item.body, item.sourceRef, item.url].filter(Boolean).join("\n"));
}

function matchKeywords(text: string, keywords: readonly string[]): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const keyword of keywords) {
    if (lower.includes(keyword.toLowerCase())) {
      hits.push(keyword);
    }
  }
  return hits;
}

function toTitleToken(input: string): string {
  return normalizeSpaces(input)
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      if (/^[a-z]{1,4}\d+(?:\.\d+)?$/i.test(token)) return token.toUpperCase();
      if (/^[a-z]{1,6}$/i.test(token) && token === token.toUpperCase()) return token;
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(" ");
}

function inferTopic(item: PipelineItemForVoiceSignal, classification: LatestClassification): string {
  const text = getCombinedText(item);

  for (const candidate of TOPIC_PATTERNS) {
    const matched = text.match(candidate.pattern);
    if (matched?.[0]) {
      const resolved = candidate.toTopic(matched[0]);
      if (resolved.length > 0) return resolved.slice(0, 60);
    }
  }

  if (item.sourceRef) {
    const sourceRef = normalizeSpaces(item.sourceRef).replace(/^@/, "");
    if (sourceRef.length > 0) {
      return sourceRef.slice(0, 60);
    }
  }

  const fallback = TOPIC_FALLBACK_BY_PRIMARY[classification.primaryTag || "OTHER"] || "AI General";
  return fallback;
}

function inferSentiment(text: string): {
  sentiment: "positive" | "negative" | "neutral";
  confidence: number;
  matchedSignals: string[];
} {
  const positiveHits = matchKeywords(text, POSITIVE_KEYWORDS);
  const negativeHits = matchKeywords(text, NEGATIVE_KEYWORDS);

  const score = positiveHits.length - negativeHits.length;

  let sentiment: "positive" | "negative" | "neutral" = "neutral";
  if (score >= 1) sentiment = "positive";
  if (score <= -1) sentiment = "negative";

  let confidence = 0.54;
  confidence += Math.min(Math.abs(score), 4) * 0.09;

  if (positiveHits.length > 0 && negativeHits.length > 0) {
    confidence -= 0.08;
  }

  if (sentiment === "neutral" && positiveHits.length === 0 && negativeHits.length === 0) {
    confidence -= 0.08;
  }

  confidence = clamp(confidence, 0.42, 0.93);

  return {
    sentiment,
    confidence,
    matchedSignals: [
      ...positiveHits.map((value) => `positive:${value}`),
      ...negativeHits.map((value) => `negative:${value}`),
    ].slice(0, 12),
  };
}

function inferUsageContext(text: string): { usageContext: string; matchedSignals: string[] } {
  const ordering = ["coding", "ideation", "speed", "cost", "automation", "quality"];
  let bestContext = "general";
  let bestScore = 0;
  let bestMatched: string[] = [];

  for (const context of ordering) {
    const keywords = USAGE_CONTEXT_RULES[context];
    const hits = matchKeywords(text, keywords);
    const score = hits.length;

    if (score > bestScore) {
      bestContext = context;
      bestScore = score;
      bestMatched = hits;
    }
  }

  return {
    usageContext: bestScore > 0 ? bestContext : "general",
    matchedSignals: bestMatched.map((keyword) => `context:${bestContext}:${keyword}`).slice(0, 8),
  };
}

function inferSampleSize(item: PipelineItemForVoiceSignal): number {
  const raw = (item.raw || {}) as any;
  const data = (raw?.data || {}) as Record<string, any>;

  const numbers: number[] = [];

  const metrics = data.metrics;
  if (metrics && typeof metrics === "object") {
    for (const value of Object.values(metrics)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        numbers.push(value);
      }
    }
  }

  const directKeys = [
    "reactionCount",
    "commentCount",
    "likesCount",
    "stocksCount",
    "score",
    "likeCount",
    "stars",
    "forks",
    "viewCount",
  ];

  for (const key of directKeys) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      numbers.push(value);
    }
  }

  const engagement = numbers.reduce((sum, value) => sum + value, 0);
  if (engagement <= 0) return 1;

  const scaled = 1 + Math.floor(Math.log10(engagement + 1));
  return clamp(scaled, 1, 9);
}

function buildSummary(item: PipelineItemForVoiceSignal): string | null {
  const text = getPrimaryText(item);
  if (!text) return null;
  if (text.length <= MAX_SUMMARY_LEN) return text;
  return `${text.slice(0, MAX_SUMMARY_LEN - 1)}…`;
}

function isVoiceCandidate(item: PipelineItemForVoiceSignal): { ok: boolean; textLen: number; isSocial: boolean } {
  const text = getPrimaryText(item);
  const textLen = text.length;
  const isSocial = SOCIAL_PLATFORMS.has(item.platform);

  if (textLen < 20) return { ok: false, textLen, isSocial };

  if (isSocial) {
    return { ok: textLen <= 420, textLen, isSocial };
  }

  return { ok: textLen <= 180, textLen, isSocial };
}

function scoreCandidate(item: PipelineItemForVoiceSignal, classification: LatestClassification): number {
  const candidate = isVoiceCandidate(item);
  if (!candidate.ok) return -999;

  let score = 0;

  if (!classification.isDup) score += 30;
  else score -= 24;

  if (!classification.isPublished) score += 8;
  else score -= 6;

  if (candidate.isSocial) score += 18;

  if (candidate.textLen >= 40 && candidate.textLen <= 260) score += 12;
  else if (candidate.textLen <= 420) score += 5;

  const classifierScore = classification.score ?? 0.5;
  score += classifierScore * 12;

  if (classification.actionTag === "APPLY" || classification.actionTag === "EVAL") {
    score += 3;
  }

  const ageHours = (Date.now() - recencyTs(item)) / 36_000_00;
  if (ageHours <= 24) score += 8;
  else if (ageHours <= 72) score += 4;
  else if (ageHours <= 168) score += 1;

  return Number(score.toFixed(3));
}

function buildInference(
  item: PipelineItemForVoiceSignal,
  classification: LatestClassification,
  editionId: string | null,
): InferredVoiceSignal {
  const combined = normalizeLower(getCombinedText(item));

  const topic = inferTopic(item, classification);
  const sentiment = inferSentiment(combined);
  const usage = inferUsageContext(combined);

  const confidenceBase = sentiment.confidence;
  const contextBoost = usage.usageContext === "general" ? -0.04 : 0.04;
  const classifierBoost = ((classification.score ?? 0.5) - 0.5) * 0.2;
  const confidence = clamp(confidenceBase + contextBoost + classifierBoost, 0.4, 0.95);

  return {
    topic,
    sentiment: sentiment.sentiment,
    usageContext: usage.usageContext,
    summary: buildSummary(item),
    confidence: Number(confidence.toFixed(3)),
    sampleSize: inferSampleSize(item),
    signaledAt: item.publishedAt || item.ingestedAt || new Date(),
    matchedSignals: uniq([...sentiment.matchedSignals, ...usage.matchedSignals]).slice(0, 18),
    editionId,
  };
}

function buildInputHash(plan: PlannedVoiceSignal): string {
  const serialized = JSON.stringify({
    item: {
      id: plan.item.id,
      platform: plan.item.platform,
      url: plan.item.url,
      canonicalUrl: plan.item.canonicalUrl || null,
      title: plan.item.title || null,
      bodyHash: createHash("sha256").update(plan.item.body || "").digest("hex"),
      publishedAt: plan.item.publishedAt ? plan.item.publishedAt.toISOString() : null,
      updatedAt: plan.item.updatedAt.toISOString(),
    },
    classification: {
      id: plan.classification.id,
      updatedAt: plan.classification.updatedAt.toISOString(),
      score: plan.classification.score,
      primaryTag: plan.classification.primaryTag,
      actionTag: plan.classification.actionTag,
      isDup: plan.classification.isDup,
      isPublished: plan.classification.isPublished,
    },
    inference: {
      topic: plan.inference.topic,
      sentiment: plan.inference.sentiment,
      usageContext: plan.inference.usageContext,
      summary: plan.inference.summary,
      confidence: plan.inference.confidence,
      sampleSize: plan.inference.sampleSize,
      editionId: plan.inference.editionId,
      signaledAt: plan.inference.signaledAt.toISOString(),
      matchedSignals: plan.inference.matchedSignals,
    },
  });

  return createHash("sha256").update(serialized).digest("hex");
}

function isSameSignal(existing: VoiceSignalRecord, inference: InferredVoiceSignal): boolean {
  return (
    existing.topic === inference.topic &&
    existing.sentiment === inference.sentiment &&
    (existing.usageContext || null) === (inference.usageContext || null) &&
    (existing.summary || null) === (inference.summary || null) &&
    (existing.model || null) === VOICE_SIGNAL_MODEL &&
    Number((existing.confidence || 0).toFixed(3)) === Number((inference.confidence || 0).toFixed(3)) &&
    existing.sampleSize === inference.sampleSize &&
    (existing.editionId || null) === (inference.editionId || null)
  );
}

function compareVoiceSignalRecency(a: VoiceSignalRecord, b: VoiceSignalRecord): number {
  const createdAtDiff = b.createdAt.getTime() - a.createdAt.getTime();
  if (createdAtDiff !== 0) return createdAtDiff;
  return b.id - a.id;
}

function isNewerVoiceSignal(candidate: VoiceSignalRecord, current: VoiceSignalRecord | null): boolean {
  if (!current) return true;
  return compareVoiceSignalRecency(candidate, current) < 0;
}

function isExactSignalMatch(signal: VoiceSignalRecord, inference: InferredVoiceSignal): boolean {
  return (
    (signal.editionId || null) === (inference.editionId || null) &&
    signal.topic === inference.topic &&
    signal.sentiment === inference.sentiment &&
    (signal.usageContext || null) === (inference.usageContext || null)
  );
}

function compactRetainedSignals(candidates: RetainedVoiceSignalCandidates): VoiceSignalRecord[] {
  const deduped = new Map<number, VoiceSignalRecord>();
  for (const signal of [candidates.byModel, candidates.byEdition, candidates.exact]) {
    if (signal) deduped.set(signal.id, signal);
  }
  return [...deduped.values()].sort(compareVoiceSignalRecency);
}

async function loadExistingSignalsByItem(
  prisma: PrismaClient,
  plans: PlannedVoiceSignal[],
): Promise<Map<string, VoiceSignalRecord[]>> {
  const retainedByItem = new Map<string, RetainedVoiceSignalCandidates>();
  const planByItemId = new Map(plans.map((plan) => [plan.item.id, plan] as const));
  const selectedIds = plans.map((plan) => plan.item.id);

  if (selectedIds.length === 0) {
    return new Map();
  }

  let cursorId: number | undefined;

  while (true) {
    const batch = await prisma.voiceSignal.findMany({
      where: {
        pipelineItemId: { in: selectedIds },
        model: VOICE_SIGNAL_MODEL,
      },
      orderBy: [{ id: "asc" }],
      take: VOICE_SIGNAL_SCAN_BATCH_SIZE,
      ...(cursorId !== undefined
        ? {
            cursor: { id: cursorId },
            skip: 1,
          }
        : {}),
      select: VOICE_SIGNAL_RECORD_SELECT,
    });

    if (batch.length === 0) {
      break;
    }

    for (const signal of batch) {
      const pipelineItemId = signal.pipelineItemId;
      if (!pipelineItemId) continue;

      const plan = planByItemId.get(pipelineItemId);
      if (!plan) continue;

      const retained = retainedByItem.get(pipelineItemId) || {
        byModel: null,
        byEdition: null,
        exact: null,
      };

      if (isNewerVoiceSignal(signal, retained.byModel)) {
        retained.byModel = signal;
      }

      if (
        (signal.editionId || null) === (plan.inference.editionId || null) &&
        isNewerVoiceSignal(signal, retained.byEdition)
      ) {
        retained.byEdition = signal;
      }

      if (isExactSignalMatch(signal, plan.inference) && isNewerVoiceSignal(signal, retained.exact)) {
        retained.exact = signal;
      }

      retainedByItem.set(pipelineItemId, retained);
    }

    if (batch.length < VOICE_SIGNAL_SCAN_BATCH_SIZE) {
      break;
    }

    cursorId = batch[batch.length - 1]?.id;
  }

  const existingByItem = new Map<string, VoiceSignalRecord[]>();
  for (const [pipelineItemId, retained] of retainedByItem.entries()) {
    existingByItem.set(pipelineItemId, compactRetainedSignals(retained));
  }

  return existingByItem;
}

function pickExistingSignal(
  candidates: VoiceSignalRecord[],
  inference: InferredVoiceSignal,
): { exact: VoiceSignalRecord | null; byEdition: VoiceSignalRecord | null; byModel: VoiceSignalRecord | null } {
  let exact: VoiceSignalRecord | null = null;
  let byEdition: VoiceSignalRecord | null = null;
  let byModel: VoiceSignalRecord | null = null;

  for (const signal of candidates) {
    if ((signal.model || null) !== VOICE_SIGNAL_MODEL) continue;

    if (!byModel) {
      byModel = signal;
    }

    if ((signal.editionId || null) === (inference.editionId || null) && !byEdition) {
      byEdition = signal;
    }

    if (
      (signal.editionId || null) === (inference.editionId || null) &&
      signal.topic === inference.topic &&
      signal.sentiment === inference.sentiment &&
      (signal.usageContext || null) === (inference.usageContext || null)
    ) {
      exact = signal;
      break;
    }
  }

  return { exact, byEdition, byModel };
}

async function persistVoiceSignal(
  prisma: PrismaClient,
  plan: PlannedVoiceSignal,
  existingSignals: VoiceSignalRecord[],
  logger: Pick<Console, "warn">,
): Promise<"created" | "updated" | "skippedPublishedEdition"> {
  const pick = pickExistingSignal(existingSignals, plan.inference);
  const target = pick.exact || pick.byEdition || pick.byModel;

  if (
    target?.editionId &&
    target.edition?.status === "published" &&
    target.editionId !== plan.inference.editionId
  ) {
    return "skippedPublishedEdition";
  }

  const attempt = (plan.latestRun?.attempt || 0) + 1;

  const run = await prisma.pipelineRun.create({
    data: {
      pipelineItemId: plan.item.id,
      step: VOICE_SIGNAL_STEP,
      status: "running",
      attempt,
      model: VOICE_SIGNAL_MODEL,
      inputHash: plan.inputHash,
    },
  });

  try {
    const sanitizedTopic = sanitizeToWellFormed(plan.inference.topic);
    const sanitizedUsageContext =
      plan.inference.usageContext === null ? null : sanitizeToWellFormed(plan.inference.usageContext);
    const sanitizedSummary =
      plan.inference.summary === null ? null : sanitizeToWellFormed(plan.inference.summary);
    const topic = sanitizedTopic.result;
    const usageContext = sanitizedUsageContext?.result ?? null;
    const summary = sanitizedSummary?.result ?? null;
    const replacedCount =
      sanitizedTopic.replacedCount +
      (sanitizedUsageContext?.replacedCount || 0) +
      (sanitizedSummary?.replacedCount || 0);
    if (replacedCount > 0) {
      logger.warn(
        `[voicesignal] item=${plan.item.id} sanitized ill-formed code units before signal write: topic=${sanitizedTopic.replacedCount} usageContext=${sanitizedUsageContext?.replacedCount || 0} summary=${sanitizedSummary?.replacedCount || 0}`,
      );
    }
    const result = await prisma.$transaction(async (tx) => {
      if (target) {
        await tx.voiceSignal.update({
          where: { id: target.id },
          data: {
            editionId: plan.inference.editionId,
            topic,
            sentiment: plan.inference.sentiment,
            usageContext,
            summary,
            model: VOICE_SIGNAL_MODEL,
            confidence: plan.inference.confidence,
            sampleSize: plan.inference.sampleSize,
            signaledAt: plan.inference.signaledAt,
          },
        });

        return { action: "updated" as const, signalId: target.id };
      }

      const created = await tx.voiceSignal.create({
        data: {
          pipelineItemId: plan.item.id,
          editionId: plan.inference.editionId,
          topic,
          sentiment: plan.inference.sentiment,
          usageContext,
          summary,
          model: VOICE_SIGNAL_MODEL,
          confidence: plan.inference.confidence,
          sampleSize: plan.inference.sampleSize,
          signaledAt: plan.inference.signaledAt,
        },
      });

      return { action: "created" as const, signalId: created.id };
    });

    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        output: {
          action: result.action,
          voiceSignalId: result.signalId,
          topic,
          sentiment: plan.inference.sentiment,
          usageContext,
          confidence: plan.inference.confidence,
          sampleSize: plan.inference.sampleSize,
          editionId: plan.inference.editionId,
          matchedSignals: plan.inference.matchedSignals,
        } as Prisma.InputJsonObject,
      },
    });

    return result.action;
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

function pickLatestClassification(item: PipelineItemForVoiceSignal): LatestClassification | null {
  return item.classifications[0] || null;
}

function pickLatestRun(item: PipelineItemForVoiceSignal): LatestStepRun | null {
  return item.runs[0] || null;
}

export async function aggregateVoiceSignals(
  prisma: PrismaClient,
  options: VoiceSignalOptions = {},
): Promise<VoiceSignalMetrics> {
  const logger = options.logger || console;
  const startedAt = new Date();

  const dryRun = Boolean(options.dryRun);
  const limit = parseLimit(options.limit);
  const platforms = uniq(
    (options.platforms || [])
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
  const editionDate = toEditionDate(options.editionDate);
  const candidateWindow = buildEditionWindow(
    editionDate || new Date(`${editionKey(new Date())}T00:00:00.000Z`),
  );
  const candidateFloor = new Date(candidateWindow.startUtc.getTime() - VOICE_SIGNAL_LOOKBACK_MS);

  const where: Prisma.PipelineItemWhereInput = {
    normalizedAt: { not: null },
    OR: [
      { publishedAt: { gte: candidateFloor } },
      { publishedAt: null, ingestedAt: { gte: candidateFloor } },
    ],
  };

  if (platforms.length > 0) {
    where.platform = { in: platforms };
  }

  let edition = editionDate
    ? await prisma.newsletterEdition.findUnique({
        where: { editionDate },
        select: { id: true },
      })
    : null;
  let editionCreated = false;

  if (editionDate && !edition) {
    const dateKey = formatDateKeyUtc(editionDate);

    if (dryRun) {
      logger.log(`[voicesignal] dryRun: skipping edition create for ${dateKey}`);
    } else {
      try {
        edition = await prisma.newsletterEdition.create({
          data: {
            editionDate,
            slug: buildEditionSlug(editionDate),
            title: buildEditionTitle(editionDate),
            status: "draft",
          },
          select: { id: true },
        });
        editionCreated = true;
        logger.log(`[voicesignal] edition not found for ${dateKey}, created draft edition=${edition.id}`);
      } catch (error) {
        if (!isPrismaUniqueConstraintError(error)) {
          throw error;
        }

        edition = await prisma.newsletterEdition.findUnique({
          where: { editionDate },
          select: { id: true },
        });
      }
    }
  }

  const editionMap = new Map<string, { id: string; status: string }>();

  const rawItems = await prisma.pipelineItem.findMany({
    where,
    select: VOICE_SIGNAL_ITEM_SELECT,
    orderBy: [{ publishedAt: "desc" }, { ingestedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(limit * 8, limit),
  });

  const counter = createCounter();
  counter.scanned = rawItems.length;

  const scored = rawItems
    .map((item) => {
      const classification = pickLatestClassification(item);
      if (!classification) return null;
      if (classification.noise) return null;

      const score = scoreCandidate(item, classification);
      if (score < 0) return null;

      return { item, classification, score };
    })
    .filter(
      (
        value,
      ): value is {
        item: PipelineItemForVoiceSignal;
        classification: LatestClassification;
        score: number;
      } => Boolean(value),
    )
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return recencyTs(b.item) - recencyTs(a.item);
    });

  counter.eligible = scored.length;

  const selected = scored.slice(0, limit);
  counter.selected = selected.length;

  const dateKeys = uniq(
    selected
      .map((entry) => entry.item.publishedAt || entry.item.ingestedAt || entry.item.createdAt)
      .map(editionKey),
  );

  if (dateKeys.length > 0) {
    const dateRanges = dateKeys.map((key) => new Date(`${key}T00:00:00.000Z`));
    const editions = await prisma.newsletterEdition.findMany({
      where: {
        editionDate: {
          in: dateRanges,
        },
      },
      select: {
        id: true,
        editionDate: true,
        status: true,
      },
    });

    for (const item of editions) {
      editionMap.set(formatDateKeyUtc(item.editionDate), {
        id: item.id,
        status: item.status,
      });
    }
  }

  const previews: VoiceSignalPreview[] = [];
  const plans: PlannedVoiceSignal[] = [];
  for (const entry of selected) {
    const itemDate = entry.item.publishedAt || entry.item.ingestedAt || entry.item.createdAt;
    const resolvedEdition = editionMap.get(editionKey(itemDate));

    // Published papers are frozen: late items get neither new rows nor rewrites.
    if (resolvedEdition?.status === "published") {
      counter.skippedPublishedEdition += 1;
      continue;
    }

    const editionId = resolvedEdition?.id || null;
    const inference = buildInference(entry.item, entry.classification, editionId);

    const plan: PlannedVoiceSignal = {
      item: entry.item,
      classification: entry.classification,
      inference,
      score: entry.score,
      inputHash: "",
      latestRun: pickLatestRun(entry.item),
    };

    plan.inputHash = buildInputHash(plan);
    plans.push(plan);
  }

  const existingByItem = await loadExistingSignalsByItem(prisma, plans);

  for (const plan of plans) {
    const currentSignals = existingByItem.get(plan.item.id) || [];
    const picked = pickExistingSignal(currentSignals, plan.inference);
    const current = picked.exact || picked.byEdition || picked.byModel;

    if (
      current &&
      plan.latestRun?.status === "completed" &&
      plan.latestRun.inputHash === plan.inputHash &&
      isSameSignal(current, plan.inference)
    ) {
      counter.skippedUnchanged += 1;
      continue;
    }

    if (previews.length < MAX_PREVIEW) {
      previews.push({
        pipelineItemId: plan.item.id,
        platform: plan.item.platform,
        topic: plan.inference.topic,
        sentiment: plan.inference.sentiment,
        usageContext: plan.inference.usageContext,
        confidence: plan.inference.confidence,
        sampleSize: plan.inference.sampleSize,
        editionId: plan.inference.editionId,
        score: plan.score,
      });
    }

    try {
      if (!dryRun) {
        const action = await persistVoiceSignal(prisma, plan, currentSignals, logger);

        if (action === "created") {
          counter.created += 1;
        } else if (action === "updated") {
          counter.updated += 1;
        } else {
          counter.skippedPublishedEdition += 1;
          continue;
        }
      }

      counter.processed += 1;
      logger.log(
        `[voicesignal] item=${plan.item.id} topic=${plan.inference.topic} sentiment=${plan.inference.sentiment} context=${plan.inference.usageContext} edition=${plan.inference.editionId || "-"}`,
      );
    } catch (error) {
      counter.failed += 1;
      logger.warn(`[voicesignal] item=${plan.item.id} failed: ${sanitizeErrorMessage(error)}`);
    }
  }

  logger.log(
    `[voicesignal] skippedPublishedEdition=${counter.skippedPublishedEdition}`,
  );

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    dryRun,
    limit,
    platforms: platforms.length > 0 ? platforms : undefined,
    editionDate: editionDate ? formatDateKeyUtc(editionDate) : undefined,
    edition: {
      id: edition?.id || null,
      found: Boolean(edition?.id),
      created: editionCreated,
    },
    model: VOICE_SIGNAL_MODEL,
    counter,
    previews,
  };
}
