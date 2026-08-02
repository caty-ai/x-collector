import { CandidateAccount, PrismaClient } from "@prisma/client";
import { DEFAULT_LLM_MODEL } from "../lib/pipeline/classify-llm";
import { sanitizeToWellFormed } from "../lib/pipeline/text-sanitize";

const DEFAULT_LIMIT = 20;
const MAX_OUTPUT_TOKENS = 700;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const OPENROUTER_CHAT_TIMEOUT_MS = 120_000;

const CATEGORIES = [
  "ai_research",
  "ai_product",
  "ads",
  "infra",
  "policy",
  "media",
  "other",
] as const;
const RECOMMENDATIONS = ["reject", "watch", "queue_review"] as const;
const SAMPLE_QUALITIES = ["poor", "mixed", "good"] as const;

type CandidateCategory = (typeof CATEGORIES)[number];
type CandidateRecommendation = (typeof RECOMMENDATIONS)[number];
type SampleQuality = (typeof SAMPLE_QUALITIES)[number];
type CandidateStatus = "rejected" | "watch" | "needs_review";

type Logger = Pick<Console, "log" | "warn">;

interface MentionerInput {
  handle: string;
  trusted: boolean;
}

interface CandidateInputBundle {
  handle: string;
  displayName: string | null;
  bio: string;
  followersCount: number | null;
  followingCount: number | null;
  tweetCount: number | null;
  mentionCount: number;
  mentionedBy: MentionerInput[];
  sampleTweets: unknown[];
}

interface CandidatePrediction {
  score: number;
  confidence: number;
  category: CandidateCategory;
  recommendation: CandidateRecommendation;
  riskFlags: string[];
  sampleQuality: SampleQuality;
  reason: string;
}

export interface CandidateEvaluationPreview {
  handle: string;
  status: CandidateStatus;
  score: number | null;
  trustedMentioners: number;
  reason: string;
}

export interface CandidateEvaluationMetrics {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  limit: number;
  selected: number;
  prefiltered: number;
  evaluated: number;
  written: number;
  failed: number;
  previews: CandidateEvaluationPreview[];
}

export interface EvaluateCandidatesOptions {
  limit?: number;
  dryRun?: boolean;
  logger?: Logger;
}

const JSON_SCHEMA = {
  name: "xcollector_candidate_account_evaluation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      score: {
        type: "number",
        minimum: 0,
        maximum: 100,
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      category: {
        type: "string",
        enum: CATEGORIES,
      },
      recommendation: {
        type: "string",
        enum: RECOMMENDATIONS,
      },
      riskFlags: {
        type: "array",
        items: { type: "string" },
      },
      sampleQuality: {
        type: "string",
        enum: SAMPLE_QUALITIES,
      },
      reason: {
        type: "string",
        maxLength: 200,
      },
    },
    required: [
      "score",
      "confidence",
      "category",
      "recommendation",
      "riskFlags",
      "sampleQuality",
      "reason",
    ],
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const handle = raw.trim().replace(/^@/, "");
  if (!HANDLE_RE.test(handle)) return null;
  return handle.toLowerCase();
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeSampleTweets(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 10).map((tweet) => {
    if (typeof tweet === "string") {
      return { text: tweet.slice(0, 500) };
    }

    const obj = getObject(tweet);
    if (!obj) return tweet;

    return {
      text: getString(obj.text)?.slice(0, 500) || "",
      createdAt: getString(obj.createdAt),
      likes: getNumber(obj.likes),
      retweets: getNumber(obj.retweets),
      views: getNumber(obj.views),
    };
  });
}

function extractJson(raw: string): unknown {
  const trimmed = (raw || "").trim();
  if (!trimmed) throw new Error("LLM response content is empty");

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`LLM response is not valid JSON: ${trimmed.slice(0, 240)}`);
  }
}

function normalizePrediction(raw: unknown): CandidatePrediction {
  const obj = (raw || {}) as Record<string, unknown>;
  const riskFlags = Array.isArray(obj.riskFlags)
    ? obj.riskFlags
        .filter((flag): flag is string => typeof flag === "string")
        .map((flag) => flag.trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];

  const category =
    typeof obj.category === "string" && CATEGORIES.includes(obj.category as CandidateCategory)
      ? (obj.category as CandidateCategory)
      : "other";
  const recommendation =
    typeof obj.recommendation === "string" &&
    RECOMMENDATIONS.includes(obj.recommendation as CandidateRecommendation)
      ? (obj.recommendation as CandidateRecommendation)
      : "watch";
  const sampleQuality =
    typeof obj.sampleQuality === "string" && SAMPLE_QUALITIES.includes(obj.sampleQuality as SampleQuality)
      ? (obj.sampleQuality as SampleQuality)
      : "mixed";

  return {
    score:
      typeof obj.score === "number" && Number.isFinite(obj.score)
        ? clamp(obj.score, 0, 100)
        : 0,
    confidence:
      typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
        ? clamp(obj.confidence, 0, 1)
        : 0.5,
    category,
    recommendation,
    riskFlags,
    sampleQuality,
    reason: typeof obj.reason === "string" ? obj.reason.trim().slice(0, 200) : "",
  };
}

function hasSevereRiskFlag(riskFlags: string[]): boolean {
  return riskFlags.some((flag) => {
    const normalized = flag.toLowerCase();
    return normalized.includes("spam") || normalized.includes("impersonat");
  });
}

function statusFromPrediction(prediction: CandidatePrediction, trustedMentionerCount: number): CandidateStatus {
  if (hasSevereRiskFlag(prediction.riskFlags) || prediction.score < 45) return "rejected";
  if (prediction.score < 65) return "watch";
  if (prediction.score < 78) {
    return trustedMentionerCount >= 1 && prediction.sampleQuality !== "poor" ? "needs_review" : "watch";
  }

  if (
    prediction.confidence >= 0.65 &&
    (trustedMentionerCount >= 2 ||
      (trustedMentionerCount >= 1 && prediction.sampleQuality === "good"))
  ) {
    return "needs_review";
  }

  return "watch";
}

function shouldPrefilterReject(candidate: CandidateAccount, sampleTweets: unknown[]): boolean {
  const hasBio = Boolean(candidate.description?.trim());
  const followersCount = candidate.followersCount ?? 0;
  return !hasBio && followersCount < 100 && sampleTweets.length === 0;
}

function buildInputBundle(candidate: CandidateAccount, trustedSourceHandles: Set<string>): CandidateInputBundle {
  const sampleTweets = normalizeSampleTweets(candidate.sampleTweets);
  const mentionedBy = uniq(candidate.mentionedBy.map((handle) => normalizeHandle(handle) || "")).map(
    (handle) => ({
      handle,
      trusted: trustedSourceHandles.has(handle),
    }),
  );

  return {
    handle: candidate.handle,
    displayName: candidate.displayName,
    bio: candidate.description || "",
    followersCount: candidate.followersCount,
    followingCount: candidate.followingCount,
    tweetCount: candidate.tweetCount,
    mentionCount: candidate.mentionCount,
    mentionedBy,
    sampleTweets,
  };
}

async function loadTrustedSourceHandles(prisma: PrismaClient, candidates: CandidateAccount[]): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();

  const sources = await prisma.source.findMany({
    where: {
      active: true,
    },
    select: { handle: true },
  });

  return new Set(
    sources
      .map((source) => normalizeHandle(source.handle))
      .filter((handle): handle is string => Boolean(handle)),
  );
}

async function callOpenRouter(apiKey: string, model: string, input: CandidateInputBundle): Promise<CandidatePrediction> {
  const systemPrompt = [
    "You evaluate candidate X/Twitter accounts for an AI and advertising newsletter source list.",
    "Score source quality on topical fit, originality/signal density, expertise or primary-source value, spam/engagement-bait risk, and trust cues.",
    "Prefer primary operators, researchers, builders, policy experts, product teams, and consistently high-signal media accounts.",
    "Penalize vague bios, recycled engagement bait, impersonation risk, generic hustle content, and weak evidence.",
    "Return only strict JSON matching the schema. The reason must be 200 characters or fewer.",
  ].join(" ");

  const body = {
    model,
    temperature: 0,
    max_tokens: MAX_OUTPUT_TOKENS,
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
        content: JSON.stringify(input),
      },
    ],
  };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://localhost",
    "X-Title": "xcollector-candidate-evaluation",
  };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(OPENROUTER_CHAT_TIMEOUT_MS),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}: ${JSON.stringify(payload).slice(0, 400)}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`OpenRouter returned non-text content: ${JSON.stringify(content).slice(0, 200)}`);
  }

  return normalizePrediction(extractJson(content));
}

function clampLimit(limit: number | undefined): number {
  if (!limit || limit <= 0) return DEFAULT_LIMIT;
  return Math.floor(limit);
}

export async function selectPendingCandidatesForEvaluation(prisma: PrismaClient, limit = DEFAULT_LIMIT) {
  return prisma.candidateAccount.findMany({
    where: {
      profileFetched: true,
      aiEvaluatedAt: null,
      status: "pending",
    },
    orderBy: { mentionCount: "desc" },
    take: clampLimit(limit),
  });
}

export async function evaluatePendingCandidates(
  prisma: PrismaClient,
  opts: EvaluateCandidatesOptions = {},
): Promise<CandidateEvaluationMetrics> {
  const logger = opts.logger || console;
  const startedAt = new Date();
  const dryRun = Boolean(opts.dryRun);
  const limit = clampLimit(opts.limit);
  const model = DEFAULT_LLM_MODEL.trim();

  const candidates = await selectPendingCandidatesForEvaluation(prisma, limit);
  const trustedSourceHandles = await loadTrustedSourceHandles(prisma, candidates);

  const metrics: CandidateEvaluationMetrics = {
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    dryRun,
    limit,
    selected: candidates.length,
    prefiltered: 0,
    evaluated: 0,
    written: 0,
    failed: 0,
    previews: [],
  };

  for (const candidate of candidates) {
    try {
      const input = buildInputBundle(candidate, trustedSourceHandles);
      const trustedMentionerCount = input.mentionedBy.filter((mentioner) => mentioner.trusted).length;
      const now = new Date();

      if (shouldPrefilterReject(candidate, input.sampleTweets)) {
        if (!dryRun) {
          await prisma.candidateAccount.update({
            where: { id: candidate.id },
            data: {
              status: "rejected",
              aiReason: "PREFILTER: insufficient profile signal",
              aiEvaluatedAt: now,
            },
          });
          metrics.written += 1;
        }

        metrics.prefiltered += 1;
        metrics.previews.push({
          handle: candidate.handle,
          status: "rejected",
          score: null,
          trustedMentioners: trustedMentionerCount,
          reason: "PREFILTER: insufficient profile signal",
        });

        logger.log(`[evaluate-candidates] @${candidate.handle} prefilter rejected`);
        continue;
      }

      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY is not set");
      }

      const prediction = await callOpenRouter(apiKey, model, input);
      const status = statusFromPrediction(prediction, trustedMentionerCount);
      const aiReason = JSON.stringify(prediction);
      const sanitizedAiReason = sanitizeToWellFormed(aiReason);

      if (!dryRun) {
        await prisma.candidateAccount.update({
          where: { id: candidate.id },
          data: {
            status,
            aiScore: prediction.score,
            aiReason: sanitizedAiReason.result,
            aiEvaluatedAt: now,
          },
        });
        metrics.written += 1;
      }

      metrics.evaluated += 1;
      metrics.previews.push({
        handle: candidate.handle,
        status,
        score: prediction.score,
        trustedMentioners: trustedMentionerCount,
        reason: prediction.reason,
      });

      logger.log(
        `[evaluate-candidates] @${candidate.handle} score=${prediction.score.toFixed(1)} confidence=${prediction.confidence.toFixed(2)} trusted=${trustedMentionerCount} sample=${prediction.sampleQuality} status=${status}`,
      );
    } catch (error) {
      metrics.failed += 1;
      logger.warn(`[evaluate-candidates] @${candidate.handle} failed: ${sanitizeErrorMessage(error)}`);
    }
  }

  metrics.finishedAt = new Date().toISOString();
  return metrics;
}
