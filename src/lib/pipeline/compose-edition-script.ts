import { Prisma, PrismaClient } from "@prisma/client";
import { COMPOSE_STEP } from "./compose-edition";
import { sanitizeBodyFallback } from "./body-sanitize";
import { clipSummary, EMPTY_SUMMARY, splitSummaryLines } from "./compose-script-text";
import { sanitizeToWellFormed } from "./text-sanitize";

export { clipSummary, splitSummaryLines, truncateWithEllipsis } from "./compose-script-text";

export const COMPOSE_SCRIPT_CREATED_BY = "step5_compose:script:v1";
export const COMPOSE_SCRIPT_MODEL = COMPOSE_SCRIPT_CREATED_BY;
export const COMPOSE_SCRIPT_MAX_PER_SECTION = parseNonNegativeInt(
  process.env.STEP5_SCRIPT_MAX_PER_SECTION,
  0,
);
export const COMPOSE_SCRIPT_SUMMARY_MAX_CHARS = resolveScriptSummaryMaxChars(
  process.env.STEP5_SCRIPT_SUMMARY_MAX_CHARS,
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
  "11_market_voice",
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

export interface ComposeScriptRow {
  bindingId: number;
  pipelineItemId: string;
  section: string;
  position: number;
  blurb: string | null;
  title: string | null;
  titleJa: string | null;
  summaryJa: string | null;
  body: string | null;
  url: string;
  platform: string;
  publishedAt: Date | null;
  primaryTag: string | null;
  subTag: string | null;
  actionTag: string | null;
  finalHeadlineScore: number;
  topicClusterKey: string | null;
  distinctSources: number;
  topicClusterBadge: string | null;
}

export interface ComposeScriptEditionOptions {
  editionId?: string;
  editionDate?: Date;
  dryRun?: boolean;
  maxPerSection?: number;
  summaryMaxChars?: number;
  captureContent?: boolean;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface ComposeScriptEditionMetrics {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  editionId: string;
  editionDate: string;
  model: string;
  bindingCount: number;
  outputItemCount: number;
  contentChars: number;
  summary: string;
  contentMd?: string;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

export function resolveScriptSummaryMaxChars(raw: string | undefined): number {
  return parsePositiveInt(raw, 320);
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return fallback;
}

function parseClusterFloat(raw: string | undefined, fallback: number, requirePositive: boolean): number {
  const parsed = Number.parseFloat(raw || "");
  if (Number.isFinite(parsed) && (!requirePositive || parsed > 0)) return parsed;
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

// B2b headline booster (mirrors compose-edition.ts so script + llm modes agree).
function computeClusterBoost(distinctSources: number, platformSpread: number, gamma: number): number {
  if (distinctSources < 2) return 0;
  return Math.log2(1 + distinctSources) * (1 + gamma * (Math.max(1, platformSpread) - 1));
}

function buildTopicClusterBadge(distinctSources: number): string | null {
  if (distinctSources < 2) return null;
  return `[${distinctSources}媒体が言及]`;
}

function prependTopicClusterBadge(value: string | null, badge: string | null): string | null {
  if (!badge) return value;
  const normalized = normalizeText(value);
  if (!normalized) return badge;
  const withoutBadge = normalizeText(normalized.replace(badge, ""));
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
  const normalized = normalizeText(value);
  if (!normalized) return badge;
  const withoutBadge = normalizeText(normalized.replace(badge, ""));
  return withoutBadge ? `${badge} ${withoutBadge}` : badge;
}

function resolveTopicClusterBadge(row: ComposeScriptRow): string | null {
  if (row.topicClusterBadge) return row.topicClusterBadge;
  const title = normalizeText(row.title);
  return title.match(/^\[(\d+)媒体が言及\]/)?.[0] || null;
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

function normalizeText(input: string | null | undefined): string {
  return (input || "").replace(/\s+/g, " ").trim();
}

function buildSummaryLines(
  row: ComposeScriptRow,
  summaryMaxChars: number,
  localizeJa: boolean,
): string[] {
  const bodyFallback = normalizeText(sanitizeBodyFallback(row.body));
  const blurbFallback = normalizeText(sanitizeBodyFallback(row.blurb));
  const baseSource = localizeJa
    ? normalizeText(row.summaryJa) ||
      bodyFallback ||
      blurbFallback ||
      normalizeText(row.title) ||
      EMPTY_SUMMARY
    : bodyFallback || blurbFallback || normalizeText(row.title) || EMPTY_SUMMARY;

  const clipped = clipSummary(baseSource, summaryMaxChars);
  return splitSummaryLines(clipped);
}

function toSectionHeading(sectionKey: string): string {
  const sectionIndex = SECTION_ORDER.indexOf(sectionKey as (typeof SECTION_ORDER)[number]);
  const sectionNumber =
    sectionIndex >= 0 ? sectionIndex + 1 : Number.parseInt(sectionKey.split("_", 1)[0], 10);
  const title = SECTION_TITLES[sectionKey] || sectionKey;
  if (Number.isFinite(sectionNumber)) {
    return `## ${sectionNumber}. ${title}`;
  }
  return `## ${title}`;
}

export function renderArticleBlock(
  row: ComposeScriptRow,
  summaryMaxChars: number,
  localizeJa: boolean,
): string {
  const baseTitle = localizeJa
    ? normalizeText(row.titleJa) || normalizeText(row.title) || "Untitled"
    : normalizeText(row.title) || "Untitled";
  const title = localizeJa
    ? prependTopicClusterBadge(baseTitle, resolveTopicClusterBadge(row)) || baseTitle
    : row.topicClusterBadge
      ? `${baseTitle} ${row.topicClusterBadge}`
      : baseTitle;
  const guardedSummaryLines = buildSummaryLines(row, summaryMaxChars, localizeJa)
    .map((line) => line.replace(/^(?:\s*(?:#{1,6}(?=\s)|[>|]))+\s*/, "").trim())
    .filter(Boolean);
  const summaryLines = guardedSummaryLines.length > 0 ? guardedSummaryLines : [EMPTY_SUMMARY];
  const platform = normalizeText(row.platform) || "source";
  const sourceUrl = normalizeText(row.url) || "about:blank";

  return [
    `### ${title}`,
    ...summaryLines,
    `引用元: [${platform}](${sourceUrl})`,
    "",
  ].join("\n");
}

function compareRows(a: ComposeScriptRow, b: ComposeScriptRow): number {
  if (a.position !== b.position) return a.position - b.position;

  const aPublished = a.publishedAt?.getTime() || 0;
  const bPublished = b.publishedAt?.getTime() || 0;
  if (bPublished !== aPublished) return bPublished - aPublished;

  if (a.bindingId !== b.bindingId) return a.bindingId - b.bindingId;
  return a.pipelineItemId.localeCompare(b.pipelineItemId);
}

function compareTopicClusterRows(
  sectionKey: (typeof SECTION_ORDER)[number],
  a: ComposeScriptRow,
  b: ComposeScriptRow,
): number {
  const aDistinctSources = Number.isFinite(a.distinctSources) ? a.distinctSources : 0;
  const bDistinctSources = Number.isFinite(b.distinctSources) ? b.distinctSources : 0;
  if (bDistinctSources !== aDistinctSources) {
    return bDistinctSources - aDistinctSources;
  }

  if (sectionKey === "1_latest_ai_news" && b.finalHeadlineScore !== a.finalHeadlineScore) {
    return b.finalHeadlineScore - a.finalHeadlineScore;
  }

  return compareRows(a, b);
}

function pickClusterRepresentative(rows: ComposeScriptRow[]): ComposeScriptRow {
  return rows.reduce((representative, row) => {
    if (row.finalHeadlineScore > representative.finalHeadlineScore) return row;
    if (row.finalHeadlineScore < representative.finalHeadlineScore) return representative;
    return compareRows(row, representative) < 0 ? row : representative;
  }, rows[0]);
}

function collapseMultiSourceTopicClusters(rows: ComposeScriptRow[]): ComposeScriptRow[] {
  const groups = new Map<string, ComposeScriptRow[]>();

  for (const row of rows) {
    if (!row.topicClusterKey) continue;
    const group = groups.get(row.topicClusterKey) || [];
    group.push(row);
    groups.set(row.topicClusterKey, group);
  }

  const replacements = new Map<number, ComposeScriptRow>();
  const suppressed = new Set<number>();

  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    const distinctSources = group.reduce(
      (max, row) => Math.max(max, Number.isFinite(row.distinctSources) ? row.distinctSources : 0),
      0,
    );
    if (distinctSources < 2) continue;

    const representative = pickClusterRepresentative(group);
    const badge = buildTopicClusterBadge(distinctSources);
    replacements.set(representative.bindingId, {
      ...representative,
      section: "1_latest_ai_news",
      title: prependTopicClusterBadge(representative.title, badge),
      distinctSources,
      topicClusterBadge: null,
    });

    for (const row of group) {
      if (row.bindingId !== representative.bindingId) {
        suppressed.add(row.bindingId);
      }
    }
  }

  return rows.flatMap((row) => {
    if (suppressed.has(row.bindingId)) return [];
    return [replacements.get(row.bindingId) || row];
  });
}

function collapseGithubRepoArticles(rows: ComposeScriptRow[]): ComposeScriptRow[] {
  const groups = new Map<string, ComposeScriptRow[]>();

  for (const row of rows) {
    if (row.platform !== "github") continue;
    const repoKey = extractGithubRepoKey(row.url);
    if (!repoKey) continue;
    const group = groups.get(repoKey) || [];
    group.push(row);
    groups.set(repoKey, group);
  }

  const replacements = new Map<number, ComposeScriptRow>();
  const suppressed = new Set<number>();

  for (const [repoKey, group] of groups.entries()) {
    if (group.length <= 1) continue;

    const representative = pickClusterRepresentative(group);
    const badge = buildGithubRepoBadge(repoKey, group.length);
    replacements.set(representative.bindingId, {
      ...representative,
      title: prependGithubRepoBadge(representative.title, badge),
      // localized render uses titleJa; badge it too so the badge survives localization
      titleJa: representative.titleJa
        ? prependGithubRepoBadge(representative.titleJa, badge)
        : representative.titleJa,
    });

    for (const row of group) {
      if (row.bindingId !== representative.bindingId) {
        suppressed.add(row.bindingId);
      }
    }
  }

  return rows.flatMap((row) => {
    if (suppressed.has(row.bindingId)) return [];
    return [replacements.get(row.bindingId) || row];
  });
}

export function buildMarkdown(params: {
  rows: ComposeScriptRow[];
  editionDate: Date;
  maxPerSection: number;
  summaryMaxChars: number;
  topicClusterEnabled: boolean;
  localizeJa: boolean;
}): { contentMd: string; outputItemCount: number } {
  const { rows, maxPerSection, summaryMaxChars, topicClusterEnabled, localizeJa } = params;

  const lines: string[] = [];
  let outputItemCount = 0;

  for (const sectionKey of SECTION_ORDER) {
    lines.push(toSectionHeading(sectionKey));
    lines.push("");

    const filtered = rows.filter((row) => row.section === sectionKey);
    const sortedRows =
      topicClusterEnabled
        ? filtered.sort((a, b) => compareTopicClusterRows(sectionKey, a, b))
        : filtered.sort(compareRows);

    const sectionRows =
      maxPerSection > 0 ? sortedRows.slice(0, maxPerSection) : sortedRows;

    for (const row of sectionRows) {
      lines.push(renderArticleBlock(row, summaryMaxChars, localizeJa));
      outputItemCount += 1;
    }
  }

  return {
    contentMd: lines.join("\n").trim(),
    outputItemCount,
  };
}

export async function composeNewsletterEditionScript(
  prisma: PrismaClient,
  options: ComposeScriptEditionOptions,
): Promise<ComposeScriptEditionMetrics> {
  const logger = options.logger || console;
  const startedAt = new Date();
  const dryRun = Boolean(options.dryRun);
  const maxPerSection = Math.max(
    0,
    typeof options.maxPerSection === "number"
      ? options.maxPerSection
      : COMPOSE_SCRIPT_MAX_PER_SECTION,
  );
  const summaryMaxChars = Math.max(
    60,
    options.summaryMaxChars || COMPOSE_SCRIPT_SUMMARY_MAX_CHARS,
  );

  const edition = options.editionId
    ? await prisma.newsletterEdition.findUnique({ where: { id: options.editionId } })
    : await prisma.newsletterEdition.findUnique({
        where: {
          editionDate: options.editionDate || new Date(),
        },
      });

  if (!edition) {
    throw new Error("Edition not found for compose step (script mode)");
  }

  const bindings = await prisma.newsletterBinding.findMany({
    where: { editionId: edition.id },
    include: {
      pipelineItem: {
        select: {
          id: true,
          title: true,
          body: true,
          url: true,
          canonicalUrl: true,
          platform: true,
          publishedAt: true,
        },
      },
      classification: {
        select: {
          primaryTag: true,
          subTag: true,
          actionTag: true,
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
      model: COMPOSE_SCRIPT_MODEL,
      bindingCount,
      outputItemCount: 0,
      contentChars: 0,
      summary: "compose skipped: no bindings",
      ...(options.captureContent ? { contentMd: "" } : {}),
    };
  }

  const topicClusterEnabled = isTopicClusterEnabled();
  const githubRepoDedupEnabled = isGithubRepoDedupEnabled();
  const localizeJa = isLocalizeJaEnabled();
  const headlineClusterBeta = parseClusterFloat(process.env.STEP_HEADLINE_CLUSTER_BETA, 8, true);
  const headlineClusterGamma = parseClusterFloat(process.env.STEP_HEADLINE_CLUSTER_GAMMA, 0.5, false);

  const itemIds = bindings.map((binding) => binding.pipelineItemId);
  const decisionRows =
    itemIds.length > 0
      ? await prisma.pipelineCrosslinkLlmDecision.findMany({
          where: { pipelineItemId: { in: itemIds } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            pipelineItemId: true,
            headlineScore: true,
            topicClusterKey: true,
            distinctSources: true,
            platformSpread: true,
          },
        })
      : [];
  const decisionByItem = new Map<
    string,
    { headlineScore: number; topicClusterKey: string | null; distinctSources: number; platformSpread: number }
  >();
  for (const decision of decisionRows) {
    if (!decisionByItem.has(decision.pipelineItemId)) {
      decisionByItem.set(decision.pipelineItemId, {
        headlineScore: decision.headlineScore ?? 0,
        topicClusterKey: decision.topicClusterKey ?? null,
        distinctSources: decision.distinctSources ?? 0,
        platformSpread: decision.platformSpread ?? 0,
      });
    }
  }

  const rows: ComposeScriptRow[] = bindings.map((binding) => {
    const item = binding.pipelineItem;
    if (!item) {
      throw new Error(`Binding missing pipelineItem: ${binding.id}`);
    }

    const decision = decisionByItem.get(binding.pipelineItemId);
    const headlineScore = decision?.headlineScore ?? 0;
    const distinctSources = topicClusterEnabled ? decision?.distinctSources ?? 0 : 0;
    const platformSpread = topicClusterEnabled ? decision?.platformSpread ?? 0 : 0;
    const clusterBoost = topicClusterEnabled
      ? computeClusterBoost(distinctSources, platformSpread, headlineClusterGamma)
      : 0;

    return {
      bindingId: binding.id,
      pipelineItemId: binding.pipelineItemId,
      section: binding.section,
      position: binding.position,
      blurb: binding.blurb,
      title: item.title,
      titleJa: binding.classification?.titleJa || null,
      summaryJa: binding.classification?.summaryJa || null,
      body: item.body,
      url: item.url || item.canonicalUrl || "",
      platform: item.platform,
      publishedAt: item.publishedAt,
      primaryTag: binding.classification?.primaryTag || null,
      subTag: binding.classification?.subTag || null,
      actionTag: binding.classification?.actionTag || null,
      finalHeadlineScore: headlineScore + headlineClusterBeta * clusterBoost,
      topicClusterKey: topicClusterEnabled ? decision?.topicClusterKey ?? null : null,
      distinctSources,
      topicClusterBadge: topicClusterEnabled ? buildTopicClusterBadge(distinctSources) : null,
    };
  });
  const topicCollapsedRows = topicClusterEnabled ? collapseMultiSourceTopicClusters(rows) : rows;
  const outputRows = githubRepoDedupEnabled
    ? collapseGithubRepoArticles(topicCollapsedRows)
    : topicCollapsedRows;

  const anchorPipelineItemId = bindings[0].pipelineItemId;
  let run: { id: number } | null = null;
  if (!dryRun) {
    const latestRun = await prisma.pipelineRun.findFirst({
      where: {
        pipelineItemId: anchorPipelineItemId,
        step: COMPOSE_STEP,
      },
      orderBy: { attempt: "desc" },
      select: { attempt: true },
    });

    run = await prisma.pipelineRun.create({
      data: {
        pipelineItemId: anchorPipelineItemId,
        step: COMPOSE_STEP,
        status: "running",
        attempt: (latestRun?.attempt || 0) + 1,
        model: COMPOSE_SCRIPT_MODEL,
        inputHash: null,
      },
      select: { id: true },
    });
  }

  try {
    const { contentMd, outputItemCount } = buildMarkdown({
      rows: outputRows,
      editionDate: edition.editionDate,
      maxPerSection,
      summaryMaxChars,
      topicClusterEnabled,
      localizeJa,
    });

    const sanitizedContentMd = sanitizeToWellFormed(contentMd);
    if (!dryRun) {
      const summary = `SCRIPT最終組版完了: bindings=${bindingCount}, outputItems=${outputItemCount}, contentChars=${contentMd.length}`;
      const sanitizedSummary = sanitizeToWellFormed(summary);
      const totalReplaced = sanitizedContentMd.replacedCount + sanitizedSummary.replacedCount;
      if (totalReplaced > 0) {
        logger.warn(
          `[compose-script] sanitized ill-formed code units before update: contentMd=${sanitizedContentMd.replacedCount} summary=${sanitizedSummary.replacedCount}`,
        );
      }
      await prisma.newsletterEdition.update({
        where: { id: edition.id },
        data: {
          contentMd: sanitizedContentMd.result,
          summary: sanitizedSummary.result,
          model: COMPOSE_SCRIPT_MODEL,
          generatedAt: new Date(),
          status: "published",
          publishedAt: edition.publishedAt ?? new Date(),
        },
      });
    }

    if (run) await prisma.pipelineRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        output: {
          editionId: edition.id,
          editionDate: edition.editionDate.toISOString(),
          dryRun,
          model: COMPOSE_SCRIPT_MODEL,
          bindingCount,
          outputItemCount,
          contentChars: contentMd.length,
          maxPerSection,
          summaryMaxChars,
        } as Prisma.InputJsonObject,
      },
    });

    logger.log(
      `[compose-script] edition=${edition.id} dryRun=${dryRun} bindingCount=${bindingCount} outputItemCount=${outputItemCount} contentChars=${contentMd.length} maxPerSection=${maxPerSection} summaryMaxChars=${summaryMaxChars}`,
    );

    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      dryRun,
      editionId: edition.id,
      editionDate: edition.editionDate.toISOString().slice(0, 10),
      model: COMPOSE_SCRIPT_MODEL,
      bindingCount,
      outputItemCount,
      contentChars: contentMd.length,
      summary: `compose completed(script): dryRun=${dryRun}, bindingCount=${bindingCount}, outputItemCount=${outputItemCount}, contentChars=${contentMd.length}`,
      ...(options.captureContent ? { contentMd: sanitizedContentMd.result } : {}),
    };
  } catch (error) {
    if (run) await prisma.pipelineRun.update({
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
