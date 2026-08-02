import { createHash } from "crypto";
import { PipelineItem, PrismaClient } from "@prisma/client";
import { sanitizeToWellFormed } from "./text-sanitize";

export const CLASSIFY_STEP = "step1_3_classify";
export const RULE_BASED_MODEL = "rule-based:v1";
export const RULE_PROMPT_VERSION = "step1-3-rules-2026-07-05-v2";

const STALE_DAYS = 31;
const DEFAULT_LIMIT = 100;

export const PRIMARY_TAGS = [
  "UPDATE",
  "AGENT",
  "TECH",
  "RESEARCH",
  "MCP_API",
  "DEVICE",
  "SECURITY",
  "REGULATION",
  "BUSINESS",
  "COLUMN",
  "OTHER",
] as const;

export const SUB_TAGS = [
  "NEW_LLM",
  "LLM_UPDATE",
  "OSS_FW",
  "AGENT_DEV",
  "AGENT_OPS",
  "MULTI_AGENT",
  "PROMPT",
  "CTX_ENG",
  "RAG_SEARCH",
  "PAPER",
  "BENCH",
  "MCP",
  "SDK_API",
  "WEARABLE",
  "ROBOTICS_HW",
] as const;

export const ACTION_TAGS = ["APPLY", "EVAL", "WATCH", "INFO"] as const;

export type PrimaryTag = (typeof PRIMARY_TAGS)[number];
export type SubTag = (typeof SUB_TAGS)[number];
export type ActionTag = (typeof ACTION_TAGS)[number];

export interface RuleClassification {
  noise: boolean;
  noiseReason: string | null;
  primaryTag: PrimaryTag | null;
  subTag: SubTag | null;
  actionTag: ActionTag | null;
  titleJa?: string | null;
  summaryJa?: string | null;
  auxTags: string[];
  confidence: number;
  model: string;
  promptVersion: string;
  matchedSignals: string[];
}

export interface ClassifyOptions {
  dryRun?: boolean;
  limit?: number;
  platforms?: string[];
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface ClassifyCounter {
  scanned: number;
  candidates: number;
  classified: number;
  skippedUnchanged: number;
  failed: number;
}

export interface ClassifyPreview {
  pipelineItemId: string;
  platform: string;
  url: string;
  result: RuleClassification;
}

export interface ClassifyMetrics {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  limit: number;
  platforms?: string[];
  counter: ClassifyCounter;
  previews: ClassifyPreview[];
}

interface LatestStepRun {
  id: number;
  attempt: number;
  inputHash: string | null;
  status: string;
}

type PipelineItemWithLatestRun = PipelineItem & { runs: LatestStepRun[] };

interface PlatformRuleConfig {
  lowInfoMinChars?: number;
  forceNoisePatterns?: RegExp[];
  primaryKeywordBoosts?: Partial<Record<PrimaryTag, string[]>>;
  actionKeywordBoosts?: Partial<Record<ActionTag, string[]>>;
}

// Keyword scoring cannot express the prompt's "pure model release stays UPDATE
// even when agent-related" exception; on equal scores AGENT wins here. The LLM
// classifier (primary path in prod) enforces the exception; this rule fallback
// accepts the drift.
const PRIMARY_TIE_BREAK_ORDER: PrimaryTag[] = [
  "SECURITY",
  "REGULATION",
  "MCP_API",
  "AGENT",
  "RESEARCH",
  "UPDATE",
  "TECH",
  "DEVICE",
  "BUSINESS",
  "COLUMN",
  "OTHER",
];

const ACTION_TIE_BREAK_ORDER: ActionTag[] = ["APPLY", "EVAL", "WATCH", "INFO"];

const AI_DOMAIN_KEYWORDS = [
  "ai",
  "llm",
  "gpt",
  "claude",
  "gemini",
  "model",
  "inference",
  "machine learning",
  "ml",
  "neural",
  "transformer",
  "mcp",
  "prompt",
  "rag",
  "agent",
  "agents",
  "openai",
  "anthropic",
  "deepseek",
  "chatgpt",
  "生成ai",
  "生成 ai",
  "エージェント",
  "機械学習",
  "人工知能",
  "大規模言語",
  "論文",
  "ベンチマーク",
] as const;

const PRIMARY_KEYWORDS: Record<PrimaryTag, string[]> = {
  UPDATE: [
    "release",
    "launched",
    "launch",
    "shipping",
    "changelog",
    "update",
    "updated",
    "new model",
    "new version",
    "preview",
    "一般提供",
    "新機能",
    "アップデート",
    "公開",
  ],
  MCP_API: [
    "mcp",
    "model context protocol",
    "mcp server",
    "mcp client",
    "api",
    "sdk",
    "endpoint",
    "webhook",
    "integration",
    "connector",
    "client library",
    "rest",
    "graphql",
    "tool calling",
    "連携",
    "api連携",
  ],
  AGENT: [
    "agent",
    "agents",
    "ai agent",
    "autonomous agent",
    "agentic",
    "agent framework",
    "agent sdk",
    "agent workflow",
    "orchestration",
    "multi-agent",
    "a2a",
    "operator",
    "エージェント",
    "マルチエージェント",
    "自律エージェント",
    "オーケストレーション",
  ],
  TECH: [
    "prompt",
    "rag",
    "retrieval",
    "embedding",
    "search pipeline",
    "fine-tuning",
    "finetuning",
    "context engineering",
    "implementation",
    "実装",
    "検証",
    "手法",
    "プロンプト",
    "検索",
    "埋め込み",
    "コンテキスト",
  ],
  RESEARCH: [
    "paper",
    "arxiv",
    "preprint",
    "benchmark",
    "leaderboard",
    "sota",
    "state of the art",
    "eval",
    "evaluation",
    "dataset",
    "method",
    "research",
    "論文",
    "研究",
    "ベンチマーク",
    "評価",
    "リーダーボード",
  ],
  DEVICE: [
    "hardware",
    "chip",
    "gpu",
    "npu",
    "device",
    "wearable",
    "glasses",
    "robot",
    "robotics",
    "embedded",
    "edge ai",
    "デバイス",
    "ウェアラブル",
    "半導体",
  ],
  SECURITY: [
    "security",
    "vulnerability",
    "cve",
    "prompt injection",
    "jailbreak",
    "exploit",
    "data leak",
    "breach",
    "リスク",
    "脆弱性",
    "セキュリティ",
  ],
  REGULATION: [
    "regulation",
    "policy",
    "compliance",
    "governance",
    "government",
    "law",
    "legal",
    "eu ai act",
    "条例",
    "規制",
    "政策",
    "法案",
    "ガバナンス",
  ],
  BUSINESS: [
    "funding",
    "raised",
    "raises",
    "acquisition",
    "acquired",
    "merger",
    "partnership",
    "revenue",
    "enterprise",
    "valuation",
    "資金調達",
    "提携",
    "買収",
    "事業",
  ],
  COLUMN: [
    "opinion",
    "hot take",
    "meme",
    "humor",
    "funny",
    "satire",
    "culture",
    "コラム",
    "雑談",
    "ネタ",
  ],
  OTHER: [],
};

const SUB_KEYWORDS: Record<SubTag, string[]> = {
  NEW_LLM: [
    "new model",
    "new llm",
    "foundation model",
    "general availability",
    "announce",
    "発表",
    "新モデル",
  ],
  LLM_UPDATE: [
    "model update",
    "improved",
    "upgrade",
    "faster",
    "context window",
    "pricing",
    "性能向上",
    "改善",
  ],
  OSS_FW: ["open source", "oss", "framework", "library", "sdk", "github", "repo", "パッケージ"],
  AGENT_DEV: [
    "agent framework",
    "agent sdk",
    "agent library",
    "agent builder",
    "tool use",
    "function calling",
    "agent 開発",
    "エージェント開発",
    "フレームワーク",
  ],
  AGENT_OPS: [
    "agent ops",
    "production agent",
    "agent workflow",
    "reliability",
    "cost",
    "monitoring",
    "evals in production",
    "運用",
    "本番",
    "信頼性",
    "コスト",
  ],
  MULTI_AGENT: [
    "multi-agent",
    "multi agent",
    "a2a",
    "agent-to-agent",
    "orchestration",
    "swarm",
    "マルチエージェント",
    "複数エージェント",
    "オーケストレーション",
  ],
  PROMPT: ["prompt", "system prompt", "jailbreak prompt", "instruction", "プロンプト"],
  CTX_ENG: ["context", "memory", "context engineering", "long context", "コンテキスト", "メモリ"],
  RAG_SEARCH: [
    "rag",
    "retrieval",
    "embedding",
    "vector search",
    "search pipeline",
    "hybrid search",
    "検索",
    "埋め込み",
    "ベクトル検索",
  ],
  PAPER: ["paper", "arxiv", "preprint", "method", "research", "論文", "研究", "手法"],
  BENCH: ["benchmark", "leaderboard", "sota", "evaluation", "eval", "ベンチマーク", "評価", "リーダーボード"],
  MCP: ["mcp", "model context protocol", "mcp server", "mcp client", "mcpサーバー"],
  SDK_API: ["api", "sdk", "endpoint", "webhook", "connector", "client library", "api連携", "連携"],
  WEARABLE: ["wearable", "smart glasses", "headset", "ring", "watch", "ウェアラブル"],
  ROBOTICS_HW: ["robot", "robotics", "drone", "chip", "gpu", "hardware", "ロボット", "ハードウェア"],
};

export const SUB_TAGS_BY_PRIMARY: Partial<Record<PrimaryTag, SubTag[]>> = {
  UPDATE: ["NEW_LLM", "LLM_UPDATE", "OSS_FW"],
  AGENT: ["AGENT_DEV", "AGENT_OPS", "MULTI_AGENT"],
  TECH: ["PROMPT", "CTX_ENG", "RAG_SEARCH"],
  RESEARCH: ["PAPER", "BENCH"],
  MCP_API: ["MCP", "SDK_API"],
  DEVICE: ["WEARABLE", "ROBOTICS_HW"],
};

const ACTION_KEYWORDS: Record<ActionTag, string[]> = {
  APPLY: [
    "how to",
    "tutorial",
    "guide",
    "implementation",
    "sample code",
    "example",
    "repo",
    "quickstart",
    "hands-on",
    "導入",
    "実装",
    "手順",
  ],
  EVAL: [
    "benchmark",
    "compare",
    "comparison",
    "vs",
    "evaluation",
    "latency",
    "accuracy",
    "ab test",
    "検証",
    "比較",
    "評価",
  ],
  WATCH: [
    "preview",
    "roadmap",
    "rumor",
    "teaser",
    "coming soon",
    "waitlist",
    "beta",
    "予定",
    "今後",
    "様子見",
  ],
  INFO: [],
};

const PLATFORM_RULES: Record<string, PlatformRuleConfig> = {
  twitter: {
    lowInfoMinChars: 32,
    forceNoisePatterns: [/^rt\s+@/i, /^@\w+\s*$/i],
    primaryKeywordBoosts: {
      UPDATE: ["ship", "shipped", "drop", "thread"],
      COLUMN: ["hot take", "my take"],
    },
  },
  github: {
    lowInfoMinChars: 24,
    primaryKeywordBoosts: {
      UPDATE: ["release notes", "tag", "v1.", "v2.", "v3."],
      TECH: ["pull request", "commit", "issue", "diff"],
    },
    actionKeywordBoosts: {
      APPLY: ["readme", "quick start", "install"],
    },
  },
  qiita: {
    lowInfoMinChars: 50,
    primaryKeywordBoosts: {
      TECH: ["手順", "実装", "ハンズオン", "解説"],
    },
  },
  reddit: {
    lowInfoMinChars: 40,
    primaryKeywordBoosts: {
      TECH: ["discussion", "show hn", "ama"],
    },
  },
};

function createCounter(): ClassifyCounter {
  return {
    scanned: 0,
    candidates: 0,
    classified: 0,
    skippedUnchanged: 0,
    failed: 0,
  };
}

function normalizeText(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n")
    .toLowerCase()
    .replace(/[\u3000\t\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countHits(text: string, keywords: string[]): number {
  if (!text || keywords.length === 0) return 0;
  let score = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword.toLowerCase())) {
      score += 1;
    }
  }
  return score;
}

function collectMatches(text: string, keywords: string[], prefix: string): string[] {
  const matched: string[] = [];
  for (const keyword of keywords) {
    if (text.includes(keyword.toLowerCase())) {
      matched.push(`${prefix}:${keyword}`);
    }
  }
  return matched;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolvePrimaryTag(
  text: string,
  config: PlatformRuleConfig,
): { tag: PrimaryTag; score: number; matchedSignals: string[] } {
  const scores: Record<PrimaryTag, number> = {
    UPDATE: 0,
    AGENT: 0,
    MCP_API: 0,
    TECH: 0,
    RESEARCH: 0,
    DEVICE: 0,
    SECURITY: 0,
    REGULATION: 0,
    BUSINESS: 0,
    COLUMN: 0,
    OTHER: 0,
  };

  const matchedSignals: string[] = [];

  for (const tag of PRIMARY_TAGS) {
    const baseKeywords = PRIMARY_KEYWORDS[tag];
    const boosted = config.primaryKeywordBoosts?.[tag] || [];
    const allKeywords = [...baseKeywords, ...boosted];
    const score = countHits(text, allKeywords);
    scores[tag] = score;
    matchedSignals.push(...collectMatches(text, allKeywords, `primary:${tag}`));
  }

  let bestTag: PrimaryTag = "OTHER";
  let bestScore = 0;

  for (const tag of PRIMARY_TIE_BREAK_ORDER) {
    const score = scores[tag];
    if (score > bestScore) {
      bestTag = tag;
      bestScore = score;
    }
  }

  if (bestScore === 0) {
    return {
      tag: "OTHER",
      score: 1,
      matchedSignals,
    };
  }

  return {
    tag: bestTag,
    score: bestScore,
    matchedSignals,
  };
}

function resolveSubTag(primaryTag: PrimaryTag, text: string): { tag: SubTag | null; score: number; matchedSignals: string[] } {
  const candidates = SUB_TAGS_BY_PRIMARY[primaryTag] || [];
  let bestTag: SubTag | null = null;
  let bestScore = 0;
  const matchedSignals: string[] = [];

  for (const subTag of candidates) {
    const keywords = SUB_KEYWORDS[subTag];
    const score = countHits(text, keywords);
    matchedSignals.push(...collectMatches(text, keywords, `sub:${subTag}`));

    if (score > bestScore) {
      bestTag = subTag;
      bestScore = score;
    }
  }

  return {
    tag: bestScore > 0 ? bestTag : null,
    score: bestScore,
    matchedSignals,
  };
}

function resolveActionTag(text: string, config: PlatformRuleConfig): { tag: ActionTag; score: number; matchedSignals: string[] } {
  const matchedSignals: string[] = [];

  const scores: Record<ActionTag, number> = {
    APPLY: countHits(text, [...ACTION_KEYWORDS.APPLY, ...(config.actionKeywordBoosts?.APPLY || [])]),
    EVAL: countHits(text, [...ACTION_KEYWORDS.EVAL, ...(config.actionKeywordBoosts?.EVAL || [])]),
    WATCH: countHits(text, [...ACTION_KEYWORDS.WATCH, ...(config.actionKeywordBoosts?.WATCH || [])]),
    INFO: 0,
  };

  matchedSignals.push(
    ...collectMatches(text, [...ACTION_KEYWORDS.APPLY, ...(config.actionKeywordBoosts?.APPLY || [])], "action:APPLY"),
  );
  matchedSignals.push(
    ...collectMatches(text, [...ACTION_KEYWORDS.EVAL, ...(config.actionKeywordBoosts?.EVAL || [])], "action:EVAL"),
  );
  matchedSignals.push(
    ...collectMatches(text, [...ACTION_KEYWORDS.WATCH, ...(config.actionKeywordBoosts?.WATCH || [])], "action:WATCH"),
  );

  let bestTag: ActionTag = "INFO";
  let bestScore = 0;

  for (const tag of ACTION_TIE_BREAK_ORDER) {
    const score = scores[tag];
    if (score > bestScore) {
      bestTag = tag;
      bestScore = score;
    }
  }

  if (bestScore === 0) {
    return {
      tag: "INFO",
      score: 1,
      matchedSignals,
    };
  }

  return {
    tag: bestTag,
    score: bestScore,
    matchedSignals,
  };
}

function inferNoise(
  item: PipelineItem,
  text: string,
  aiSignalScore: number,
  config: PlatformRuleConfig,
): { noise: boolean; reason: string | null; auxTags: string[] } {
  const auxTags: string[] = [];

  if (!text) {
    return { noise: true, reason: "EMPTY_CONTENT", auxTags };
  }

  const forceNoisePatterns = config.forceNoisePatterns || [];
  for (const pattern of forceNoisePatterns) {
    if (pattern.test(text)) {
      return { noise: true, reason: "PLATFORM_NOISE_PATTERN", auxTags };
    }
  }

  const contentLength = text.length;
  const lowInfoMinChars = config.lowInfoMinChars ?? 36;

  if (contentLength < lowInfoMinChars && aiSignalScore < 2) {
    return { noise: true, reason: "LOW_INFORMATION_DENSITY", auxTags };
  }

  const publishedAt = item.publishedAt || item.ingestedAt;
  if (publishedAt) {
    const ageMs = Date.now() - publishedAt.getTime();
    const staleThresholdMs = STALE_DAYS * 24 * 60 * 60 * 1000;
    if (ageMs > staleThresholdMs) {
      return { noise: true, reason: "STALE_INFORMATION", auxTags };
    }
  }

  if (aiSignalScore === 0) {
    return { noise: true, reason: "OUT_OF_SCOPE", auxTags };
  }

  if (contentLength < 120) {
    auxTags.push("LOW_INFO");
  }

  return {
    noise: false,
    reason: null,
    auxTags,
  };
}

function buildInputHash(item: PipelineItem): string {
  const hashTarget = JSON.stringify({
    // Includes the rules version so bumping RULE_PROMPT_VERSION invalidates
    // the unchanged-input skip and stale rule classifications get redone.
    ruleVersion: RULE_PROMPT_VERSION,
    id: item.id,
    platform: item.platform,
    title: item.title || null,
    body: item.body || null,
    url: item.url,
    canonicalUrl: item.canonicalUrl || null,
    publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
    updatedAt: item.updatedAt ? item.updatedAt.toISOString() : null,
  });

  return createHash("sha256").update(hashTarget).digest("hex");
}

function getPlatformConfig(platform: string): PlatformRuleConfig {
  return PLATFORM_RULES[platform] || {};
}

export function classifyItemByRules(item: PipelineItem): RuleClassification {
  const config = getPlatformConfig(item.platform);

  const text = normalizeText(item.title, item.body, item.sourceRef, item.url);
  const aiSignalScore = countHits(text, [...AI_DOMAIN_KEYWORDS]);
  const aiSignals = collectMatches(text, [...AI_DOMAIN_KEYWORDS], "domain:ai");

  const noise = inferNoise(item, text, aiSignalScore, config);

  if (noise.noise) {
    const confidence = noise.reason === "LOW_INFORMATION_DENSITY" ? 0.72 : 0.92;
    return {
      noise: true,
      noiseReason: noise.reason,
      primaryTag: null,
      subTag: null,
      actionTag: null,
      auxTags: noise.auxTags,
      confidence,
      model: RULE_BASED_MODEL,
      promptVersion: RULE_PROMPT_VERSION,
      matchedSignals: aiSignals,
    };
  }

  const primary = resolvePrimaryTag(text, config);
  const sub = resolveSubTag(primary.tag, text);
  const action = resolveActionTag(text, config);

  let confidence = 0.5;
  confidence += Math.min(primary.score, 4) * 0.08;
  confidence += sub.tag ? 0.08 : 0;
  confidence += action.tag !== "INFO" ? 0.06 : 0;
  confidence += aiSignalScore > 2 ? 0.08 : 0;
  confidence -= noise.auxTags.includes("LOW_INFO") ? 0.12 : 0;

  return {
    noise: false,
    noiseReason: null,
    primaryTag: primary.tag,
    subTag: sub.tag,
    actionTag: action.tag,
    auxTags: noise.auxTags,
    confidence: clamp(confidence, 0.4, 0.99),
    model: RULE_BASED_MODEL,
    promptVersion: RULE_PROMPT_VERSION,
    matchedSignals: [...aiSignals, ...primary.matchedSignals, ...sub.matchedSignals, ...action.matchedSignals].slice(0, 20),
  };
}

function buildRationale(result: RuleClassification): string {
  return JSON.stringify({
    promptVersion: result.promptVersion,
    auxTags: result.auxTags,
    matchedSignals: result.matchedSignals,
  });
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }
  return String(error).slice(0, 1000);
}

async function persistClassification(
  prisma: PrismaClient,
  item: PipelineItemWithLatestRun,
  inputHash: string,
  result: RuleClassification,
  logger: Pick<Console, "warn">,
): Promise<void> {
  const latestRun = item.runs[0];
  const attempt = (latestRun?.attempt || 0) + 1;

  const run = await prisma.pipelineRun.create({
    data: {
      pipelineItemId: item.id,
      step: CLASSIFY_STEP,
      status: "running",
      attempt,
      model: result.model,
      inputHash,
    },
  });

  try {
    const sanitizedNoiseReason =
      result.noiseReason === null ? null : sanitizeToWellFormed(result.noiseReason);
    if ((sanitizedNoiseReason?.replacedCount || 0) > 0) {
      logger.warn(
        `[classify] item=${item.id} sanitized ill-formed code units before classification write: noiseReason=${sanitizedNoiseReason?.replacedCount || 0}`,
      );
    }

    await prisma.$transaction([
      prisma.pipelineClassification.create({
        data: {
          pipelineItemId: item.id,
          runId: run.id,
          noise: result.noise,
          noiseReason: sanitizedNoiseReason?.result ?? null,
          primaryTag: result.primaryTag,
          subTag: result.subTag,
          actionTag: result.actionTag,
          score: result.confidence,
          classifierModel: result.model,
          rationale: buildRationale(result),
        },
      }),
      prisma.pipelineRun.update({
        where: { id: run.id },
        data: {
          status: "completed",
          finishedAt: new Date(),
          output: {
            pipelineItemId: item.id,
            platform: item.platform,
            url: item.url,
            result: {
              noise: result.noise,
              noiseReason: sanitizedNoiseReason?.result ?? null,
              primaryTag: result.primaryTag,
              subTag: result.subTag,
              actionTag: result.actionTag,
              auxTags: result.auxTags,
              confidence: result.confidence,
              model: result.model,
              promptVersion: result.promptVersion,
            },
          },
        },
      }),
    ]);
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: message,
      },
    });
    throw error;
  }
}

export async function classifyPipelineItems(
  prisma: PrismaClient,
  options: ClassifyOptions = {},
): Promise<ClassifyMetrics> {
  const logger = options.logger || console;
  const startedAt = new Date();
  const dryRun = Boolean(options.dryRun);
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : DEFAULT_LIMIT;
  const platforms = options.platforms?.map((value) => value.trim().toLowerCase()).filter(Boolean);

  const where: {
    normalizedAt: { not: null };
    platform?: { in: string[] };
  } = {
    normalizedAt: { not: null },
  };

  if (platforms && platforms.length > 0) {
    where.platform = { in: [...new Set(platforms)] };
  }

  const items = await prisma.pipelineItem.findMany({
    where,
    include: {
      runs: {
        where: { step: CLASSIFY_STEP },
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
    take: limit,
  });

  const counter = createCounter();
  const previews: ClassifyPreview[] = [];

  for (const item of items) {
    counter.scanned += 1;
    const inputHash = buildInputHash(item);
    const latestRun = item.runs[0];

    if (latestRun?.status === "completed" && latestRun.inputHash === inputHash) {
      counter.skippedUnchanged += 1;
      continue;
    }

    counter.candidates += 1;

    try {
      const result = classifyItemByRules(item);

      if (previews.length < 20) {
        previews.push({
          pipelineItemId: item.id,
          platform: item.platform,
          url: item.url,
          result,
        });
      }

      if (!dryRun) {
        await persistClassification(prisma, item, inputHash, result, logger);
      }

      counter.classified += 1;
      logger.log(
        `[classify] item=${item.id} platform=${item.platform} noise=${result.noise} primary=${result.primaryTag || "-"} sub=${result.subTag || "-"} action=${result.actionTag || "-"}`,
      );
    } catch (error) {
      counter.failed += 1;
      logger.warn(`[classify] item=${item.id} failed: ${sanitizeErrorMessage(error)}`);
    }
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    dryRun,
    limit,
    platforms: platforms && platforms.length > 0 ? platforms : undefined,
    counter,
    previews,
  };
}
