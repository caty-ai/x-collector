import { Prisma, PrismaClient } from "@prisma/client";
import { getMasthead } from "../masthead";
import {
  loadSourceTrustByHandle,
  normalizeTwitterSourceHandle,
  TrustLabel,
  trustMultiplierFor,
} from "./source-trust";
import { sanitizeToWellFormed } from "./text-sanitize";

export const COMPOSE_STEP = "step5_compose_content";
export const COMPOSE_CREATED_BY = "step5_compose:llm:v1";
export const COMPOSE_DEFAULT_MODEL =
  process.env.STEP5_COMPOSE_MODEL || "google/gemini-3.1-flash-lite-preview";
export const COMPOSE_MIN_ITEMS_PER_DENSE_SECTION = parsePositiveInt(
  process.env.STEP5_COMPOSE_MIN_ITEMS_PER_DENSE_SECTION,
  3,
);
export const COMPOSE_DENSE_SECTION_MIN_CANDIDATES = parsePositiveInt(
  process.env.STEP5_COMPOSE_DENSE_SECTION_MIN_CANDIDATES,
  COMPOSE_MIN_ITEMS_PER_DENSE_SECTION,
);
export const COMPOSE_DENSITY_RETRY_MAX = parseNonNegativeInt(
  process.env.STEP5_COMPOSE_DENSITY_RETRY_MAX,
  1,
);

const SECTION_ORDER = [
  "1_latest_ai_news",
  "2_update",
  "2b_agent",
  "3_mcp_api",
  "4_tech",
  "4b_research",
  "5_device",
  "6_security",
  "7_regulation",
  "8_business",
  "9_other",
  "10_column",
] as const;

const SECTION_TITLES: Record<string, string> = {
  "1_latest_ai_news": "最新AIニュース",
  "2_update": "アップデート情報",
  "2b_agent": "エージェント動向",
  "3_mcp_api": "MCPサーバー・API情報",
  "4_tech": "技術速報",
  "4b_research": "リサーチ・論文",
  "5_device": "AIデバイス情報",
  "6_security": "セキュリティリスク",
  "7_regulation": "規制・政策・ガバナンス",
  "8_business": "ビジネス・資金調達",
  "9_other": "その他注目の内容",
  "10_column": "AIおもしろコラム",
  "11_market_voice": "市場の声・実ユーザー評価",
};

const SECTION_LIMITS: Record<string, number> = {
  "1_latest_ai_news": 8,
  "2_update": 10,
  "3_mcp_api": 8,
  "4_tech": 12,
  "5_device": 6,
  "6_security": 8,
  "7_regulation": 6,
  "8_business": 8,
  "9_other": 5,
  "10_column": 6,
};

const SECTION_NUMBER_TO_KEY: Record<number, string> = {
  1: "1_latest_ai_news",
  2: "2_update",
  3: "2b_agent",
  4: "3_mcp_api",
  5: "4_tech",
  6: "4b_research",
  7: "5_device",
  8: "6_security",
  9: "7_regulation",
  10: "8_business",
  11: "9_other",
  12: "10_column",
  13: "11_market_voice",
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return fallback;
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(raw || "");
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function parseFiniteNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(raw || "");
  if (Number.isFinite(parsed)) return parsed;
  return fallback;
}

function isTopicClusterEnabled(): boolean {
  return process.env.STEP_TOPIC_CLUSTER_ENABLED === "true";
}

function isGithubRepoDedupEnabled(): boolean {
  return process.env.STEP_GITHUB_REPO_DEDUP_ENABLED === "true";
}

function isLocalizeJaEnabled(): boolean {
  return process.env.STEP_LOCALIZE_JA === "true";
}

function computeClusterBoost(distinctSources: number, platformSpread: number, gamma: number): number {
  if (distinctSources < 2) return 0;
  return Math.log2(1 + distinctSources) * (1 + gamma * (Math.max(1, platformSpread) - 1));
}

function buildTopicClusterBadge(distinctSources: number): string | null {
  if (distinctSources < 2) return null;
  return `[${distinctSources}媒体が言及]`;
}

function appendTopicClusterBadge(value: string | null, badge: string | null): string | null {
  if (!badge) return value;
  if (!value) return badge;
  if (value.includes(badge)) return value;
  return `${value} ${badge}`;
}

function normalizeBadgeText(value: string | null): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function prependTopicClusterBadge(value: string | null, badge: string | null): string | null {
  if (!badge) return value;
  const normalized = normalizeBadgeText(value);
  if (!normalized) return badge;
  const withoutBadge = normalizeBadgeText(normalized.replace(badge, ""));
  return withoutBadge ? `${badge} ${withoutBadge}` : badge;
}

function extractGithubRepoKey(url: string): string | null {
  const match = url.match(/github\.com\/([^\/#?\s]+\/[^\/#?\s]+)/i);
  if (!match) return null;
  return match[1].toLowerCase().replace(/\.git$/, "");
}

function buildGithubRepoBadge(repoKey: string, count: number): string {
  return `[${repoKey} 更新${count}件]`;
}

function prependGithubRepoBadge(value: string | null, badge: string | null): string | null {
  if (!badge) return value;
  const normalized = normalizeBadgeText(value);
  if (!normalized) return badge;
  const withoutBadge = normalizeBadgeText(normalized.replace(badge, ""));
  return withoutBadge ? `${badge} ${withoutBadge}` : badge;
}

interface DecisionLite {
  pipelineItemId: string;
  priorityScore: number;
  headlineScore: number;
  priorityReason: string;
  topicClusterKey: string | null;
  clusterSize: number;
  distinctSources: number;
  platformSpread: number;
}

interface ComposeRow {
  pipelineItemId: string;
  section: string;
  subsection: string | null;
  position: number;
  blurb: string | null;
  title: string | null;
  url: string;
  platform: string;
  sourceRef: string | null;
  primaryTag: string | null;
  subTag: string | null;
  actionTag: string | null;
  score: number | null;
  isHeadlineCandidate: boolean;
  priorityScore: number;
  headlineScore: number;
  finalHeadlineScore: number;
  trustLabel: TrustLabel | null;
  trustMultiplier: number;
  priorityReason: string;
  topicClusterKey: string | null;
  clusterSize: number;
  distinctSources: number;
  platformSpread: number;
  topicClusterBadge: string | null;
}

interface ComposeSection {
  sectionKey: string;
  sectionTitle: string;
  candidateCount: number;
  selectedCount: number;
  requiredMinItems: number;
  items: ComposeRow[];
}

interface ComposeDensityConfig {
  minItemsPerDenseSection: number;
  denseSectionMinCandidates: number;
  retryMax: number;
}

interface DensityShortage {
  sectionKey: string;
  required: number;
  actual: number;
  selectedCount: number;
  candidateCount: number;
}

interface DensityValidationResult {
  tooThin: boolean;
  actualCounts: Record<string, number>;
  requiredCounts: Record<string, number>;
  shortages: DensityShortage[];
}

export interface ComposeEditionOptions {
  editionId?: string;
  editionDate?: Date;
  dryRun?: boolean;
  model?: string;
  minItemsPerDenseSection?: number;
  denseSectionMinCandidates?: number;
  densityRetryMax?: number;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface ComposeEditionMetrics {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  editionId: string;
  editionDate: string;
  model: string;
  bindingCount: number;
  selectedCount: number;
  voiceSignalCount: number;
  contentChars: number;
  composeAttempts: number;
  densityRetryTriggered: boolean;
  densityStillThin: boolean;
  summary: string;
}

function pickClusterRepresentative(rows: ComposeRow[]): ComposeRow {
  return rows.reduce((representative, row) => {
    const rowFinalHeadlineScore = row.finalHeadlineScore * row.trustMultiplier;
    const representativeFinalHeadlineScore =
      representative.finalHeadlineScore * representative.trustMultiplier;
    if (rowFinalHeadlineScore > representativeFinalHeadlineScore) return row;
    if (rowFinalHeadlineScore < representativeFinalHeadlineScore) return representative;

    const rowPriorityScore = row.priorityScore * row.trustMultiplier;
    const representativePriorityScore = representative.priorityScore * representative.trustMultiplier;
    if (rowPriorityScore > representativePriorityScore) return row;
    if (rowPriorityScore < representativePriorityScore) return representative;

    const rowScore = (row.score || 0) * row.trustMultiplier;
    const representativeScore = (representative.score || 0) * representative.trustMultiplier;
    if (rowScore > representativeScore) return row;
    if (rowScore < representativeScore) return representative;
    return row.position < representative.position ? row : representative;
  }, rows[0]);
}

function collapseMultiSourceTopicClusters(rows: ComposeRow[]): ComposeRow[] {
  const groups = new Map<string, ComposeRow[]>();

  for (const row of rows) {
    if (!row.topicClusterKey) continue;
    const group = groups.get(row.topicClusterKey) || [];
    group.push(row);
    groups.set(row.topicClusterKey, group);
  }

  const replacements = new Map<string, ComposeRow>();
  const suppressed = new Set<string>();

  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    const distinctSources = group.reduce(
      (max, row) => Math.max(max, Number.isFinite(row.distinctSources) ? row.distinctSources : 0),
      0,
    );
    if (distinctSources < 2) continue;

    const representative = pickClusterRepresentative(group);
    const badge = buildTopicClusterBadge(distinctSources);
    replacements.set(representative.pipelineItemId, {
      ...representative,
      section: "1_latest_ai_news",
      title: prependTopicClusterBadge(representative.title, badge),
      distinctSources,
      topicClusterBadge: null,
    });

    for (const row of group) {
      if (row.pipelineItemId !== representative.pipelineItemId) {
        suppressed.add(row.pipelineItemId);
      }
    }
  }

  return rows.flatMap((row) => {
    if (suppressed.has(row.pipelineItemId)) return [];
    return [replacements.get(row.pipelineItemId) || row];
  });
}

function collapseGithubRepoArticles(rows: ComposeRow[]): ComposeRow[] {
  const groups = new Map<string, ComposeRow[]>();

  for (const row of rows) {
    if (row.platform !== "github") continue;
    const repoKey = extractGithubRepoKey(row.url);
    if (!repoKey) continue;
    const group = groups.get(repoKey) || [];
    group.push(row);
    groups.set(repoKey, group);
  }

  const replacements = new Map<string, ComposeRow>();
  const suppressed = new Set<string>();

  for (const [repoKey, group] of groups.entries()) {
    if (group.length <= 1) continue;

    const representative = pickClusterRepresentative(group);
    const badge = buildGithubRepoBadge(repoKey, group.length);
    replacements.set(representative.pipelineItemId, {
      ...representative,
      title: prependGithubRepoBadge(representative.title, badge),
    });

    for (const row of group) {
      if (row.pipelineItemId !== representative.pipelineItemId) {
        suppressed.add(row.pipelineItemId);
      }
    }
  }

  return rows.flatMap((row) => {
    if (suppressed.has(row.pipelineItemId)) return [];
    return [replacements.get(row.pipelineItemId) || row];
  });
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

function stripCodeFence(input: string): string {
  const text = (input || "").trim();
  const block = text.match(/^```(?:markdown|md|text)?\n([\s\S]*?)\n```$/i);
  return (block ? block[1] : text).trim();
}

function summarizeVoiceSignals(rows: Array<{ topic: string; sentiment: string; usageContext: string | null; summary: string | null }>) {
  const byTopic = new Map<
    string,
    { topic: string; positive: number; neutral: number; negative: number; contexts: Map<string, number>; samples: string[] }
  >();

  for (const row of rows) {
    const topic = (row.topic || "AI General").slice(0, 80);
    const bucket = byTopic.get(topic) || {
      topic,
      positive: 0,
      neutral: 0,
      negative: 0,
      contexts: new Map<string, number>(),
      samples: [],
    };

    if (row.sentiment === "positive") bucket.positive += 1;
    else if (row.sentiment === "negative") bucket.negative += 1;
    else bucket.neutral += 1;

    const context = (row.usageContext || "general").slice(0, 40);
    bucket.contexts.set(context, (bucket.contexts.get(context) || 0) + 1);

    if (row.summary && bucket.samples.length < 2) {
      bucket.samples.push(row.summary.slice(0, 140));
    }

    byTopic.set(topic, bucket);
  }

  return [...byTopic.values()]
    .sort(
      (a, b) =>
        b.positive + b.neutral + b.negative - (a.positive + a.neutral + a.negative),
    )
    .slice(0, 12)
    .map((bucket) => ({
      topic: bucket.topic,
      positive: bucket.positive,
      neutral: bucket.neutral,
      negative: bucket.negative,
      keyContext:
        [...bucket.contexts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "general",
      sample: bucket.samples[0] || null,
    }));
}

function resolveDensityConfig(options: ComposeEditionOptions): ComposeDensityConfig {
  return {
    minItemsPerDenseSection: Math.max(
      1,
      options.minItemsPerDenseSection || COMPOSE_MIN_ITEMS_PER_DENSE_SECTION,
    ),
    denseSectionMinCandidates: Math.max(
      1,
      options.denseSectionMinCandidates || COMPOSE_DENSE_SECTION_MIN_CANDIDATES,
    ),
    retryMax: Math.min(3, Math.max(0, options.densityRetryMax ?? COMPOSE_DENSITY_RETRY_MAX)),
  };
}

function buildSectionTargetLog(sections: ComposeSection[]): string {
  return sections
    .map((section) => {
      const densityLabel = section.requiredMinItems > 0 ? `min=${section.requiredMinItems}` : "min=-";
      return `${section.sectionKey}:{selected=${section.selectedCount},cand=${section.candidateCount},${densityLabel}}`;
    })
    .join(" ");
}

function countMarkdownItemsBySection(markdown: string): Record<string, number> {
  const counts: Record<string, number> = {};
  let currentSection: string | null = null;

  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    const sectionHeading = trimmed.match(/^#{1,6}\s*(\d{1,2})(?:[\.．:\)）\s-].*)?$/);

    if (sectionHeading) {
      const sectionNumber = Number.parseInt(sectionHeading[1], 10);
      currentSection = SECTION_NUMBER_TO_KEY[sectionNumber] || null;
      continue;
    }

    if (!currentSection) continue;

    if (/^#{3,6}\s+\S+/.test(trimmed) || /^[-*]\s+\*\*[^*].+\*\*/.test(trimmed)) {
      counts[currentSection] = (counts[currentSection] || 0) + 1;
    }
  }

  return counts;
}

function validateComposeDensity(
  markdown: string,
  sections: ComposeSection[],
): DensityValidationResult {
  const actualCounts = countMarkdownItemsBySection(markdown);
  const requiredCounts: Record<string, number> = {};
  const shortages: DensityShortage[] = [];

  for (const section of sections) {
    requiredCounts[section.sectionKey] = section.requiredMinItems;

    if (section.requiredMinItems <= 0) continue;

    const actual = actualCounts[section.sectionKey] || 0;
    if (actual < section.requiredMinItems) {
      shortages.push({
        sectionKey: section.sectionKey,
        required: section.requiredMinItems,
        actual,
        selectedCount: section.selectedCount,
        candidateCount: section.candidateCount,
      });
    }
  }

  return {
    tooThin: shortages.length > 0,
    actualCounts,
    requiredCounts,
    shortages,
  };
}

function formatCountsForLog(counts: Record<string, number>, sections: ComposeSection[]): string {
  return sections.map((section) => `${section.sectionKey}:${counts[section.sectionKey] || 0}`).join(",");
}

function formatShortagesForLog(shortages: DensityShortage[]): string {
  if (shortages.length === 0) return "none";
  return shortages
    .map((shortage) => `${shortage.sectionKey}:${shortage.actual}/${shortage.required}`)
    .join(",");
}

async function callOpenRouterMarkdown(params: {
  apiKey: string;
  model: string;
  payload: unknown;
  minItemsPerDenseSection: number;
  denseSectionMinCandidates: number;
  retryFeedback?: string[];
}): Promise<string> {
  const OPENROUTER_CHAT_TIMEOUT_MS = 120_000;
  const {
    apiKey,
    model,
    payload,
    minItemsPerDenseSection,
    denseSectionMinCandidates,
    retryFeedback,
  } = params;

  const systemPrompt = [
    `あなたは${getMasthead()}の編集長です。`,
    "入力データ（bindings + voice signals）から、最終版ニュースレターMarkdownを生成してください。",
    "出力はMarkdown本文のみ。JSON、前置き、注釈は禁止。",
    "見出し順は固定: 1最新AIニュース, 2アップデート, 3エージェント動向, 4MCP/API, 5技術速報, 6リサーチ・論文, 7デバイス, 8セキュリティ, 9規制, 10ビジネス, 11その他, 12コラム, 13市場の声。",
    "フォーマット厳守: 各セクションは `## <番号>. <セクション名>`、各記事は必ず `### <記事タイトル>` で開始。",
    "各記事は: `### 見出し` / 2-3文要約 / `Why it matters: ...` / `引用元: ...` の順。",
    `候補数が${denseSectionMinCandidates}件以上あるセクションは高密度セクション。高密度セクションは最低${minItemsPerDenseSection}件の記事を個別に掲載。複数記事を1見出しに統合しない。`,
    "候補数が少ないセクションは無理に埋めない。入力データにない記事を創作しない。",
    "事実改変・誇張は禁止。入力外の情報を創作しない。",
    "日本語で簡潔に。",
    retryFeedback && retryFeedback.length > 0
      ? `再生成指示: 前回不足したセクション=${retryFeedback.join(", ")}。不足分を埋めつつ、入力データの範囲で再構成してください。`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    model,
    temperature: 0.2,
    max_tokens: 9000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(payload) },
    ],
  };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://localhost",
      "X-Title": "xcollector-step5-compose-content",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(OPENROUTER_CHAT_TIMEOUT_MS),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }

  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenRouter response missing markdown content");
  }

  return stripCodeFence(content);
}

export async function composeNewsletterEdition(
  prisma: PrismaClient,
  options: ComposeEditionOptions,
): Promise<ComposeEditionMetrics> {
  const logger = options.logger || console;
  const startedAt = new Date();
  const dryRun = Boolean(options.dryRun);
  const model = options.model || COMPOSE_DEFAULT_MODEL;
  const densityConfig = resolveDensityConfig(options);
  const topicClusterEnabled = isTopicClusterEnabled();
  const githubRepoDedupEnabled = isGithubRepoDedupEnabled();
  const localizeJa = isLocalizeJaEnabled();
  const headlineClusterBeta = parsePositiveNumber(process.env.STEP_HEADLINE_CLUSTER_BETA, 8);
  const headlineClusterGamma = parseFiniteNumber(process.env.STEP_HEADLINE_CLUSTER_GAMMA, 0.5);

  const edition = options.editionId
    ? await prisma.newsletterEdition.findUnique({ where: { id: options.editionId } })
    : await prisma.newsletterEdition.findUnique({
        where: {
          editionDate: options.editionDate || new Date(),
        },
      });

  if (!edition) {
    throw new Error("Edition not found for compose step");
  }

  const bindings = await prisma.newsletterBinding.findMany({
    where: { editionId: edition.id },
    include: {
      pipelineItem: {
        select: {
          id: true,
          title: true,
          url: true,
          canonicalUrl: true,
          platform: true,
          sourceRef: true,
        },
      },
      classification: {
        select: {
          primaryTag: true,
          subTag: true,
          actionTag: true,
          score: true,
          isHeadlineCandidate: true,
          titleJa: true,
          summaryJa: true,
        },
      },
    },
  });

  const bindingCount = bindings.length;
  if (bindingCount === 0) {
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      dryRun,
      editionId: edition.id,
      editionDate: edition.editionDate.toISOString().slice(0, 10),
      model,
      bindingCount: 0,
      selectedCount: 0,
      voiceSignalCount: 0,
      contentChars: 0,
      composeAttempts: 0,
      densityRetryTriggered: false,
      densityStillThin: false,
      summary: "compose skipped: no bindings",
    };
  }

  const itemIds = bindings.map((binding) => binding.pipelineItemId);
  const topicClusterSelect = topicClusterEnabled
    ? {
        topicClusterKey: true,
        clusterSize: true,
        distinctSources: true,
        platformSpread: true,
      }
    : {};
  const decisionRows =
    itemIds.length > 0
      ? await prisma.pipelineCrosslinkLlmDecision.findMany({
          where: {
            pipelineItemId: { in: itemIds },
          },
          orderBy: [{ createdAt: "desc" }],
          select: {
            pipelineItemId: true,
            priorityScore: true,
            priorityReason: true,
            headlineScore: true,
            ...topicClusterSelect,
          },
        })
      : [];

  const latestDecisionByItem = new Map<string, DecisionLite>();
  for (const row of decisionRows) {
    if (!latestDecisionByItem.has(row.pipelineItemId)) {
      const topicRow = row as typeof row & {
        topicClusterKey?: string | null;
        clusterSize?: number | null;
        distinctSources?: number | null;
        platformSpread?: number | null;
      };

      latestDecisionByItem.set(row.pipelineItemId, {
        pipelineItemId: row.pipelineItemId,
        priorityScore: row.priorityScore ?? 0,
        headlineScore: row.headlineScore ?? 0,
        priorityReason: row.priorityReason || "",
        topicClusterKey: topicRow.topicClusterKey ?? null,
        clusterSize: topicRow.clusterSize ?? 0,
        distinctSources: topicRow.distinctSources ?? 0,
        platformSpread: topicRow.platformSpread ?? 0,
      });
    }
  }

  const sourceTrustByHandle = await loadSourceTrustByHandle(
    prisma,
    bindings
      .map((binding) =>
        normalizeTwitterSourceHandle(
          binding.pipelineItem?.platform || "",
          binding.pipelineItem?.sourceRef || null,
        ),
      )
      .filter((handle): handle is string => Boolean(handle)),
    logger,
  );

  const composeRows: ComposeRow[] = bindings.flatMap((binding) => {
    const item = binding.pipelineItem;
    if (!item) {
      throw new Error(`Binding missing pipelineItem: ${binding.id}`);
    }

    const trackedHandle = normalizeTwitterSourceHandle(item.platform, item.sourceRef);
    const trustLabel =
      sourceTrustByHandle && trackedHandle ? sourceTrustByHandle.get(trackedHandle) ?? null : null;
    if (trustLabel === "blocked") {
      return [];
    }
    const trustMultiplier = trustMultiplierFor(trustLabel);
    const decision = latestDecisionByItem.get(binding.pipelineItemId);
    const headlineScore = decision?.headlineScore ?? 0;
    const distinctSources = topicClusterEnabled ? decision?.distinctSources ?? 0 : 0;
    const platformSpread = topicClusterEnabled ? decision?.platformSpread ?? 0 : 0;
    const clusterBoost = topicClusterEnabled
      ? computeClusterBoost(distinctSources, platformSpread, headlineClusterGamma)
      : 0;
    const finalHeadlineScore = headlineScore + headlineClusterBeta * clusterBoost;
    const topicClusterBadge = topicClusterEnabled ? buildTopicClusterBadge(distinctSources) : null;
    const localizedTitle =
      normalizeBadgeText(binding.classification?.titleJa || "") ||
      normalizeBadgeText(item.title) ||
      null;
    const localizedBlurb =
      normalizeBadgeText(binding.classification?.summaryJa || "") ||
      normalizeBadgeText(binding.blurb) ||
      null;

    return [{
      pipelineItemId: binding.pipelineItemId,
      section: binding.section,
      subsection: binding.subsection,
      position: binding.position,
      blurb: localizeJa
        ? localizedBlurb
        : item.title
          ? binding.blurb
          : appendTopicClusterBadge(binding.blurb, topicClusterBadge),
      title: localizeJa
        ? prependTopicClusterBadge(localizedTitle, topicClusterBadge)
        : appendTopicClusterBadge(item.title, topicClusterBadge),
      url: item.url || item.canonicalUrl || "",
      platform: item.platform,
      sourceRef: item.sourceRef,
      primaryTag: binding.classification?.primaryTag || null,
      subTag: binding.classification?.subTag || null,
      actionTag: binding.classification?.actionTag || null,
      score: binding.classification?.score ?? null,
      isHeadlineCandidate: Boolean(binding.classification?.isHeadlineCandidate),
      priorityScore: decision?.priorityScore ?? 0,
      headlineScore,
      finalHeadlineScore,
      trustLabel,
      trustMultiplier,
      priorityReason: decision?.priorityReason || "",
      topicClusterKey: topicClusterEnabled ? decision?.topicClusterKey ?? null : null,
      clusterSize: topicClusterEnabled ? decision?.clusterSize ?? 0 : 0,
      distinctSources,
      platformSpread,
      topicClusterBadge,
    }];
  });
  const topicCollapsedRows = topicClusterEnabled
    ? collapseMultiSourceTopicClusters(composeRows)
    : composeRows;
  const outputRows = githubRepoDedupEnabled
    ? collapseGithubRepoArticles(topicCollapsedRows)
    : topicCollapsedRows;

  const sections: ComposeSection[] = SECTION_ORDER.map((sectionKey) => {
    const candidates = outputRows
      .filter((row) => row.section === sectionKey)
      .sort((a, b) => {
        const aPriorityScore = a.priorityScore * a.trustMultiplier;
        const bPriorityScore = b.priorityScore * b.trustMultiplier;
        const aHeadlineScore = a.headlineScore * a.trustMultiplier;
        const bHeadlineScore = b.headlineScore * b.trustMultiplier;
        const aFinalHeadlineScore = a.finalHeadlineScore * a.trustMultiplier;
        const bFinalHeadlineScore = b.finalHeadlineScore * b.trustMultiplier;
        const aScore = (a.score || 0) * a.trustMultiplier;
        const bScore = (b.score || 0) * b.trustMultiplier;

        if (topicClusterEnabled && sectionKey === "1_latest_ai_news") {
          if (bFinalHeadlineScore !== aFinalHeadlineScore) {
            return bFinalHeadlineScore - aFinalHeadlineScore;
          }
          if (bPriorityScore !== aPriorityScore) return bPriorityScore - aPriorityScore;
          if (bScore !== aScore) return bScore - aScore;
          return a.position - b.position;
        }

        if (bPriorityScore !== aPriorityScore) return bPriorityScore - aPriorityScore;
        if (bHeadlineScore !== aHeadlineScore) return bHeadlineScore - aHeadlineScore;
        if (bScore !== aScore) return bScore - aScore;
        return a.position - b.position;
      });

    const limit = SECTION_LIMITS[sectionKey] || 8;
    const selected = candidates.slice(0, limit);
    const candidateCount = candidates.length;
    const selectedCount = selected.length;
    const requiredMinItems =
      candidateCount >= densityConfig.denseSectionMinCandidates &&
      selectedCount >= densityConfig.minItemsPerDenseSection
        ? Math.min(densityConfig.minItemsPerDenseSection, selectedCount)
        : 0;

    return {
      sectionKey,
      sectionTitle: SECTION_TITLES[sectionKey] || sectionKey,
      candidateCount,
      selectedCount,
      requiredMinItems,
      items: selected,
    };
  });

  const selectedCount = sections.reduce((sum, section) => sum + section.selectedCount, 0);

  logger.log(
    `[compose-density] edition=${edition.id} targets=${buildSectionTargetLog(sections)} minItems=${densityConfig.minItemsPerDenseSection} denseMinCandidates=${densityConfig.denseSectionMinCandidates} retryMax=${densityConfig.retryMax}`,
  );

  const voiceRows = await prisma.voiceSignal.findMany({
    where: { editionId: edition.id },
    select: {
      topic: true,
      sentiment: true,
      usageContext: true,
      summary: true,
    },
    orderBy: [{ signaledAt: "desc" }],
  });

  const voiceSignalCount = voiceRows.length;
  const voiceSignalSummary = summarizeVoiceSignals(voiceRows);

  const payload = {
    edition: {
      id: edition.id,
      date: edition.editionDate.toISOString().slice(0, 10),
      title: edition.title,
      slug: edition.slug,
      status: edition.status,
    },
    sections,
    voiceSignalSummary,
    sectionOrder: [...SECTION_ORDER, "11_market_voice"],
    composeDirectives: {
      minItemsPerDenseSection: densityConfig.minItemsPerDenseSection,
      denseSectionMinCandidates: densityConfig.denseSectionMinCandidates,
      requiredMinItemsBySection: sections.map((section) => ({
        sectionKey: section.sectionKey,
        requiredMinItems: section.requiredMinItems,
        selectedCount: section.selectedCount,
        candidateCount: section.candidateCount,
      })),
    },
  };

  const anchorPipelineItemId = bindings[0].pipelineItemId;
  const latestRun = await prisma.pipelineRun.findFirst({
    where: {
      pipelineItemId: anchorPipelineItemId,
      step: COMPOSE_STEP,
    },
    orderBy: { attempt: "desc" },
    select: { attempt: true },
  });

  const run = await prisma.pipelineRun.create({
    data: {
      pipelineItemId: anchorPipelineItemId,
      step: COMPOSE_STEP,
      status: "running",
      attempt: (latestRun?.attempt || 0) + 1,
      model,
      inputHash: null,
    },
  });

  const requiredCountsBySection = sections.reduce<Record<string, number>>((acc, section) => {
    acc[section.sectionKey] = section.requiredMinItems;
    return acc;
  }, {});

  try {
    let contentMd = "";
    let composeAttempts = 0;
    let densityRetryTriggered = false;
    let densityValidation: DensityValidationResult = {
      tooThin: false,
      actualCounts: {},
      requiredCounts: requiredCountsBySection,
      shortages: [],
    };

    if (!dryRun) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY is required for compose step");
      }

      const maxAttempts = Math.max(1, densityConfig.retryMax + 1);
      let retryFeedback: string[] | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        composeAttempts = attempt;
        contentMd = await callOpenRouterMarkdown({
          apiKey,
          model,
          payload,
          minItemsPerDenseSection: densityConfig.minItemsPerDenseSection,
          denseSectionMinCandidates: densityConfig.denseSectionMinCandidates,
          retryFeedback,
        });

        densityValidation = validateComposeDensity(contentMd, sections);
        logger.log(
          `[compose-density] edition=${edition.id} attempt=${attempt}/${maxAttempts} actual=${formatCountsForLog(densityValidation.actualCounts, sections)} required=${formatCountsForLog(densityValidation.requiredCounts, sections)} thin=${densityValidation.tooThin}`,
        );

        if (!densityValidation.tooThin) {
          break;
        }

        if (attempt >= maxAttempts) {
          logger.warn(
            `[compose-density] edition=${edition.id} retry=exhausted shortages=${formatShortagesForLog(densityValidation.shortages)}`,
          );
          break;
        }

        densityRetryTriggered = true;
        retryFeedback = densityValidation.shortages.map(
          (shortage) => `${shortage.sectionKey}(${shortage.actual}/${shortage.required})`,
        );

        logger.warn(
          `[compose-density] edition=${edition.id} retry=triggered shortages=${formatShortagesForLog(densityValidation.shortages)}`,
        );
      }

      const summary = `LLM最終組版完了: bindings=${bindingCount}, selected=${selectedCount}, voiceSignals=${voiceSignalCount}, model=${model}, attempts=${composeAttempts}, retry=${densityRetryTriggered}, thin=${densityValidation.tooThin}`;
      const sanitizedContentMd = sanitizeToWellFormed(contentMd);
      const sanitizedSummary = sanitizeToWellFormed(summary);
      const totalReplaced = sanitizedContentMd.replacedCount + sanitizedSummary.replacedCount;
      if (totalReplaced > 0) {
        logger.warn(
          `[compose] sanitized ill-formed code units before update: contentMd=${sanitizedContentMd.replacedCount} summary=${sanitizedSummary.replacedCount}`,
        );
      }
      await prisma.newsletterEdition.update({
        where: { id: edition.id },
        data: {
          contentMd: sanitizedContentMd.result,
          summary: sanitizedSummary.result,
          model,
          generatedAt: new Date(),
          status: "published",
          publishedAt: new Date(),
        },
      });
    }

    const output = {
      editionId: edition.id,
      editionDate: edition.editionDate.toISOString(),
      dryRun,
      model,
      bindingCount,
      selectedCount,
      voiceSignalCount,
      contentChars: contentMd.length,
      composeAttempts,
      densityRetryTriggered,
      densityStillThin: densityValidation.tooThin,
      densityActualCounts: densityValidation.actualCounts,
      densityRequiredCounts: densityValidation.requiredCounts,
      densityShortages: densityValidation.shortages.map((shortage) => ({
        sectionKey: shortage.sectionKey,
        required: shortage.required,
        actual: shortage.actual,
        selectedCount: shortage.selectedCount,
        candidateCount: shortage.candidateCount,
      })) as Prisma.InputJsonArray,
    };

    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        output: output as Prisma.InputJsonObject,
      },
    });

    logger.log(
      `[compose] edition=${edition.id} dryRun=${dryRun} model=${model} bindings=${bindingCount} selected=${selectedCount} voiceSignals=${voiceSignalCount} attempts=${composeAttempts} retry=${densityRetryTriggered} thin=${densityValidation.tooThin}`,
    );

    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      dryRun,
      editionId: edition.id,
      editionDate: edition.editionDate.toISOString().slice(0, 10),
      model,
      bindingCount,
      selectedCount,
      voiceSignalCount,
      contentChars: contentMd.length,
      composeAttempts,
      densityRetryTriggered,
      densityStillThin: densityValidation.tooThin,
      summary: `compose completed: dryRun=${dryRun}, bindings=${bindingCount}, selected=${selectedCount}, voiceSignals=${voiceSignalCount}, attempts=${composeAttempts}, retry=${densityRetryTriggered}, thin=${densityValidation.tooThin}`,
    };
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
