import { createHash } from "crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { buildEmbeddingContentHash, buildEmbeddingText, embedTexts } from "./embedding-client";

export interface TopicClusterOptions {
  dryRun?: boolean;
  lookbackHours?: number;
  cosineThreshold?: number;
  beta?: number;
  gamma?: number;
  enabled?: boolean;
  platforms?: string[];
  includeCompleted?: boolean;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface TopicClusterResult {
  counter: {
    eligible: number;
    embedded: number;
    embedCached: number;
    embedFailed: number;
    clustered: number;
    clusterCount: number;
    canonicalized: number;
    boosted: number;
    skipped: number;
  };
}

type TopicLogger = Pick<Console, "log" | "warn" | "error">;

interface EligibleTopicRow {
  id: string;
  platform: string;
  sourceRef: string | null;
  title: string | null;
  body: string | null;
  createdAt: Date;
  embeddingHash: string | null;
  embedding: unknown;
  decisionId: number | null;
  headlineScore: number | null;
  priorityScore: number | null;
  dupCluster: string | null;
  canonicalItemId: string | null;
}

interface TopicItem {
  id: string;
  platform: string;
  sourceRef: string | null;
  title: string | null;
  body: string | null;
  createdAt: Date;
  contentHash: string;
  decisionId: number | null;
  headlineScore: number;
  priorityScore: number;
  embedding: number[] | null;
}

interface TopicClusterCounter {
  eligible: number;
  embedded: number;
  embedCached: number;
  embedFailed: number;
  clustered: number;
  clusterCount: number;
  canonicalized: number;
  boosted: number;
  skipped: number;
}

const DEFAULT_LOOKBACK_HOURS = 48;
const DEFAULT_COSINE_THRESHOLD = 0.84;
const DEFAULT_BETA = 8;
const DEFAULT_GAMMA = 0.5;
const DEFAULT_MAX_ITEMS = 2000;
const EMBEDDING_DIMENSIONS = 1536;

class UnionFind {
  private readonly parent: number[];
  private readonly rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
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

function createCounter(): TopicClusterCounter {
  return {
    eligible: 0,
    embedded: 0,
    embedCached: 0,
    embedFailed: 0,
    clustered: 0,
    clusterCount: 0,
    canonicalized: 0,
    boosted: 0,
    skipped: 0,
  };
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

function parsePositiveNumber(raw: number | string | undefined, fallback: number): number {
  const parsed = typeof raw === "number" ? raw : Number.parseFloat(raw || "");
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function parseLookbackHours(value: number | undefined): number {
  return parsePositiveNumber(value, parsePositiveNumber(process.env.STEP4_LOOKBACK_HOURS, DEFAULT_LOOKBACK_HOURS));
}

function parseCosineThreshold(value: number | undefined): number {
  return Math.min(
    1,
    Math.max(
      -1,
      parsePositiveNumber(
        value,
        parsePositiveNumber(process.env.STEP_TOPIC_CLUSTER_COSINE_THRESHOLD, DEFAULT_COSINE_THRESHOLD),
      ),
    ),
  );
}

function parseBeta(value: number | undefined): number {
  return parsePositiveNumber(value, parsePositiveNumber(process.env.STEP_HEADLINE_CLUSTER_BETA, DEFAULT_BETA));
}

function parseGamma(value: number | undefined): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(process.env.STEP_HEADLINE_CLUSTER_GAMMA || "");
  return Number.isFinite(parsed) ? parsed : DEFAULT_GAMMA;
}

function parseMaxItems(): number {
  return Math.floor(
    parsePositiveNumber(process.env.STEP_TOPIC_CLUSTER_MAX_ITEMS, DEFAULT_MAX_ITEMS),
  );
}

function normalizePlatforms(platforms: string[] | undefined): string[] {
  return [
    ...new Set(
      (platforms || [])
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
    ),
  ];
}

function isEnabled(options: TopicClusterOptions): boolean {
  if (typeof options.enabled === "boolean") return options.enabled;
  return process.env.STEP_TOPIC_CLUSTER_ENABLED === "true";
}

function buildTopicClusterKey(items: TopicItem[]): string {
  const ids = items.map((item) => item.id).sort().join("|");
  return `tc_${createHash("sha256").update(ids).digest("hex").slice(0, 16)}`;
}

function normalizedHandle(item: TopicItem): string {
  return (item.sourceRef ?? "").toLowerCase();
}

function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const parsed = value.map((entry) => Number(entry));
    if (parsed.length === EMBEDDING_DIMENSIONS && parsed.every(Number.isFinite)) return parsed;
    return null;
  }

  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const body =
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
      ? trimmed.slice(1, -1)
      : trimmed;
  const parsed = body
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));

  return parsed.length === EMBEDDING_DIMENSIONS ? parsed : null;
}

function toVectorLiteral(embedding: number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS || !embedding.every(Number.isFinite)) {
    throw new Error(`Invalid embedding dimension: expected ${EMBEDDING_DIMENSIONS}, got ${embedding.length}`);
  }

  return `[${embedding.join(",")}]`;
}

function normalizeVector(embedding: number[] | null): number[] | null {
  if (!embedding) return null;
  const norm = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= 0) return null;
  return embedding.map((value) => value / norm);
}

function dotProduct(a: number[], b: number[]): number {
  let score = 0;
  for (let index = 0; index < a.length; index += 1) {
    score += a[index] * b[index];
  }
  return score;
}

function pickCanonical(items: TopicItem[]): TopicItem {
  return [...items].sort((a, b) => {
    if (b.headlineScore !== a.headlineScore) return b.headlineScore - a.headlineScore;
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  })[0];
}

function buildEligibilitySql(params: {
  startUtc: Date;
  endUtcExclusive: Date;
  platforms: string[];
  includeCompleted: boolean;
}): {
  publishedFilter: Prisma.Sql;
  platformFilter: Prisma.Sql;
} {
  const publishedFilter = params.includeCompleted
    ? Prisma.empty
    : Prisma.sql`AND lc."isPublished" = false`;
  const platformFilter =
    params.platforms.length > 0
      ? Prisma.sql`AND lower(pi.platform) IN (${Prisma.join(params.platforms)})`
      : Prisma.empty;

  return { publishedFilter, platformFilter };
}

async function fetchEligibleRowsWithCast(
  prisma: PrismaClient,
  params: {
    startUtc: Date;
    endUtcExclusive: Date;
    platforms: string[];
    includeCompleted: boolean;
    embeddingAsText: boolean;
    limit: number;
  },
): Promise<EligibleTopicRow[]> {
  const { publishedFilter, platformFilter } = buildEligibilitySql(params);
  const embeddingExpression = params.embeddingAsText
    ? Prisma.sql`pi.embedding::text`
    : Prisma.sql`pi.embedding`;
  const limitPlusOne = params.limit + 1;

  return prisma.$queryRaw<EligibleTopicRow[]>(Prisma.sql`
    WITH windowed_items AS (
      SELECT
        pi.id,
        pi.platform,
        pi."sourceRef",
        pi.title,
        pi.body,
        pi."createdAt",
        pi."embeddingHash",
        ${embeddingExpression} AS embedding
      FROM pipeline_items pi
      WHERE pi."createdAt" >= ${params.startUtc}
        AND pi."createdAt" < ${params.endUtcExclusive}
        ${platformFilter}
    ),
    latest_classification AS (
      SELECT DISTINCT ON (pc."pipelineItemId")
        pc."pipelineItemId",
        pc.noise,
        pc."isPublished"
      FROM pipeline_classifications pc
      JOIN windowed_items wi ON wi.id = pc."pipelineItemId"
      ORDER BY pc."pipelineItemId", pc."classifiedAt" DESC, pc.id DESC
    ),
    latest_decision AS (
      SELECT DISTINCT ON (pd."pipelineItemId")
        pd.id,
        pd."pipelineItemId",
        pd."headlineScore",
        pd."priorityScore",
        pd."dupCluster",
        pd."canonicalItemId"
      FROM pipeline_crosslink_llm_decisions pd
      JOIN windowed_items wi ON wi.id = pd."pipelineItemId"
      ORDER BY pd."pipelineItemId", pd."createdAt" DESC, pd.id DESC
    )
    SELECT
      pi.id,
      pi.platform,
      pi."sourceRef",
      pi.title,
      pi.body,
      pi."createdAt",
      pi."embeddingHash",
      pi.embedding,
      ld.id AS "decisionId",
      ld."headlineScore",
      ld."priorityScore",
      ld."dupCluster",
      ld."canonicalItemId"
    FROM windowed_items pi
    JOIN latest_classification lc ON lc."pipelineItemId" = pi.id
    LEFT JOIN latest_decision ld ON ld."pipelineItemId" = pi.id
    WHERE lc.noise = false
      ${publishedFilter}
    ORDER BY pi."createdAt" DESC, pi.id ASC
    LIMIT ${limitPlusOne}
  `);
}

async function fetchEligibleRows(
  prisma: PrismaClient,
  params: {
    startUtc: Date;
    endUtcExclusive: Date;
    platforms: string[];
    includeCompleted: boolean;
    logger: TopicLogger;
    limit: number;
  },
): Promise<{ rows: EligibleTopicRow[]; wasClamped: boolean }> {
  let rows: EligibleTopicRow[];
  try {
    rows = await fetchEligibleRowsWithCast(prisma, {
      ...params,
      embeddingAsText: false,
    });
  } catch (error) {
    params.logger.warn(
      `[topic-cluster] embedding::float[] fetch failed, retrying with text cast: ${sanitizeErrorMessage(error)}`,
    );
    rows = await fetchEligibleRowsWithCast(prisma, {
      ...params,
      embeddingAsText: true,
    });
  }

  return {
    rows: rows.slice(0, params.limit),
    wasClamped: rows.length > params.limit,
  };
}

async function persistEmbedding(
  prisma: PrismaClient,
  item: TopicItem,
  embedding: number[],
  embeddedAt: Date,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE pipeline_items
    SET embedding = ${toVectorLiteral(embedding)}::jsonb,
        "embeddingHash" = ${item.contentHash},
        "embeddedAt" = ${embeddedAt}
    WHERE id = ${item.id}
  `;
}

async function persistClusterMetadata(params: {
  prisma: PrismaClient;
  item: TopicItem;
  topicClusterKey: string;
  clusterSize: number;
  distinctSources: number;
  platformSpread: number;
  isCanonical: boolean;
  dryRun: boolean;
  logger: TopicLogger;
}): Promise<void> {
  const {
    prisma,
    item,
    topicClusterKey,
    clusterSize,
    distinctSources,
    platformSpread,
    isCanonical,
    dryRun,
    logger,
  } = params;

  if (!item.decisionId) {
    logger.warn(`[topic-cluster] item=${item.id} has no crosslink LLM decision; topic metadata not persisted`);
    return;
  }

  const data = {
    topicClusterKey,
    clusterSize,
    distinctSources,
    platformSpread,
  };

  if (dryRun) {
    logger.log(
      `[topic-cluster] dry-run decision=${item.decisionId} item=${item.id} canonical=${isCanonical} cluster=${topicClusterKey} size=${clusterSize} distinctSources=${data.distinctSources} platformSpread=${data.platformSpread}`,
    );
    return;
  }

  try {
    await prisma.pipelineCrosslinkLlmDecision.update({
      where: { id: item.decisionId },
      data,
    });
  } catch (error) {
    logger.error(
      `[topic-cluster] failed to persist decision=${item.decisionId} item=${item.id}: ${sanitizeErrorMessage(error)}`,
    );
  }
}

export async function runTopicCluster(
  prisma: PrismaClient,
  options: TopicClusterOptions = {},
): Promise<TopicClusterResult> {
  const logger = options.logger || console;
  const counter = createCounter();
  const dryRun = Boolean(options.dryRun);
  const lookbackHours = parseLookbackHours(options.lookbackHours);
  const cosineThreshold = parseCosineThreshold(options.cosineThreshold);
  const beta = parseBeta(options.beta);
  const gamma = parseGamma(options.gamma);
  const maxItems = parseMaxItems();
  const platforms = normalizePlatforms(options.platforms);
  const includeCompleted = Boolean(options.includeCompleted);
  const endUtcExclusive = new Date();
  const startUtc = new Date(endUtcExclusive.getTime() - lookbackHours * 60 * 60 * 1000);

  if (!isEnabled(options)) {
    logger.log("[topic-cluster] STEP_TOPIC_CLUSTER_ENABLED not set, skipping (no-op)");
    return { counter };
  }

  logger.log(
    `[topic-cluster] start window=[${startUtc.toISOString()}..${endUtcExclusive.toISOString()}) threshold=${cosineThreshold} beta=${beta} gamma=${gamma} maxItems=${maxItems} dryRun=${dryRun}`,
  );

  const { rows, wasClamped } = await fetchEligibleRows(prisma, {
    startUtc,
    endUtcExclusive,
    platforms,
    includeCompleted,
    logger,
    limit: maxItems,
  });

  counter.eligible = rows.length;
  if (wasClamped) {
    logger.warn(`[topic-cluster] eligible rows exceeded maxItems=${maxItems}; clamped current run`);
  }

  const items: TopicItem[] = rows.map((row) => {
    const contentHash = buildEmbeddingContentHash(row.title, row.body);
    const cachedEmbedding = row.embeddingHash === contentHash ? parseEmbedding(row.embedding) : null;
    if (cachedEmbedding) counter.embedCached += 1;

    return {
      id: row.id,
      platform: row.platform,
      sourceRef: row.sourceRef,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt,
      contentHash,
      decisionId: row.decisionId,
      headlineScore: row.headlineScore ?? 0,
      priorityScore: row.priorityScore ?? 0,
      embedding: cachedEmbedding,
    };
  });

  const needsEmbedding = items
    .map((item, index) => ({ item, index, text: buildEmbeddingText(item.title, item.body) }))
    .filter((entry) => !entry.item.embedding);

  const blankEmbeddingInputs = needsEmbedding.filter((entry) => entry.text.length === 0);
  for (const entry of blankEmbeddingInputs) {
    counter.embedFailed += 1;
    logger.warn(`[topic-cluster] item=${entry.item.id} has empty title/body; treating as singleton`);
  }

  const embedTargets = needsEmbedding.filter((entry) => entry.text.length > 0);

  if (embedTargets.length > 0) {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      counter.embedFailed += embedTargets.length;
      logger.error(
        `[topic-cluster] OPENROUTER_API_KEY is not set; treating ${embedTargets.length} items as singleton clusters`,
      );
    } else {
      const embeddedAt = new Date();
      const embedResult = await embedTexts(
        embedTargets.map((entry) => entry.text),
        apiKey,
        logger,
      );
      const resultByTargetIndex = new Map(embedResult.results.map((result) => [result.index, result.embedding]));
      const successTargetIndexes = new Set(resultByTargetIndex.keys());

      for (const [targetIndex, embedding] of resultByTargetIndex.entries()) {
        const target = embedTargets[targetIndex];
        if (!target) continue;
        target.item.embedding = embedding;
        counter.embedded += 1;

        if (dryRun) continue;

        try {
          await persistEmbedding(prisma, target.item, embedding, embeddedAt);
        } catch (error) {
          logger.error(
            `[topic-cluster] failed to persist embedding item=${target.item.id}: ${sanitizeErrorMessage(error)}`,
          );
        }
      }

      for (const error of embedResult.errors) {
        if (successTargetIndexes.has(error.index)) continue;
        const target = embedTargets[error.index];
        if (!target) continue;
        counter.embedFailed += 1;
      }

      logger.log(
        `[topic-cluster] embeddings tokens=${embedResult.totalTokens} embedded=${counter.embedded} failed=${counter.embedFailed}`,
      );
    }
  }

  const normalizedVectors = items.map((item) => normalizeVector(item.embedding));
  const unionFind = new UnionFind(items.length);

  for (let left = 0; left < items.length; left += 1) {
    const leftVector = normalizedVectors[left];
    if (!leftVector) continue;

    for (let right = left + 1; right < items.length; right += 1) {
      const rightVector = normalizedVectors[right];
      if (!rightVector) continue;

      if (dotProduct(leftVector, rightVector) >= cosineThreshold) {
        unionFind.union(left, right);
      }
    }
  }

  const clustersByRoot = new Map<number, TopicItem[]>();
  for (let index = 0; index < items.length; index += 1) {
    const root = unionFind.find(index);
    const cluster = clustersByRoot.get(root) || [];
    cluster.push(items[index]);
    clustersByRoot.set(root, cluster);
  }

  const clusters = [...clustersByRoot.values()];
  counter.clusterCount = clusters.length;
  counter.clustered = clusters.reduce((sum, cluster) => sum + (cluster.length > 1 ? cluster.length : 0), 0);

  for (const cluster of clusters) {
    const canonical = pickCanonical(cluster);
    const topicClusterKey = buildTopicClusterKey(cluster);
    const sourceCount = new Set(
      cluster.map((item) => `${item.platform}:${normalizedHandle(item)}`),
    ).size;
    const platformSpread = new Set(cluster.map((item) => item.platform)).size;
    const clusterBoost =
      sourceCount >= 2
        ? Math.log2(1 + sourceCount) * (1 + gamma * (platformSpread - 1))
        : 0;

    counter.canonicalized += 1;
    if (clusterBoost > 0 && beta * clusterBoost > 0) {
      counter.boosted += 1;
    }

    for (const item of cluster) {
      await persistClusterMetadata({
        prisma,
        item,
        topicClusterKey,
        clusterSize: cluster.length,
        distinctSources: sourceCount,
        platformSpread,
        isCanonical: item.id === canonical.id,
        dryRun,
        logger,
      });
    }
  }

  logger.log(
    `[topic-cluster] done eligible=${counter.eligible} cached=${counter.embedCached} embedded=${counter.embedded} failed=${counter.embedFailed} clusters=${counter.clusterCount} clustered=${counter.clustered} boosted=${counter.boosted}`,
  );

  return { counter };
}
