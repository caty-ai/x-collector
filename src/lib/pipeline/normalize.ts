import { createHash } from "crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { sanitizeText } from "./text-sanitize";

export const NORMALIZE_PLATFORMS = [
  "twitter",
  "facebook",
  "reddit",
  "qiita",
  "github",
  "instagram",
  "alerts",
] as const;

export type NormalizePlatform = (typeof NORMALIZE_PLATFORMS)[number];

export interface NormalizeOptions {
  dryRun?: boolean;
  platforms?: NormalizePlatform[];
  lookbackDays?: number;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export interface NormalizeCounter {
  scanned: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface NormalizeMetrics {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  platforms: NormalizePlatform[];
  perPlatform: Record<NormalizePlatform, NormalizeCounter>;
  totals: NormalizeCounter;
}

interface NormalizeCandidate {
  platform: NormalizePlatform;
  sourceItemId: string;
  sourceType: string;
  sourceRef?: string | null;
  title?: string | null;
  body?: string | null;
  url: string;
  canonicalUrl?: string | null;
  publishedAt?: Date | null;
  ingestedAt?: Date | null;
  language?: string | null;
  raw: Prisma.InputJsonObject;
}

interface BuildCandidateInput {
  platform: NormalizePlatform;
  sourceItemId: string;
  sourceType: string;
  sourceRef?: string | null;
  title?: string | null;
  body?: string | null;
  url: string;
  publishedAt?: Date | null;
  ingestedAt?: Date | null;
  language?: string | null;
  raw?: Record<string, Prisma.InputJsonValue | null | undefined>;
}

// This host is intentionally brand-independent to preserve already-stored row identity.
const FALLBACK_URL_HOST = "x-collector.local";
const TRACKING_PARAM_RE = /^(utm_|fbclid$|gclid$|igshid$|mc_cid$|mc_eid$|ref$|source$|s$)/i;
const BATCH_SIZE = 500;
const DEFAULT_LOOKBACK_DAYS = 14;

const PIPELINE_ITEM_SELECT = {
  id: true,
  externalId: true,
  sourceType: true,
  sourceRef: true,
  title: true,
  body: true,
  url: true,
  canonicalUrl: true,
  publishedAt: true,
  language: true,
  raw: true,
} satisfies Prisma.PipelineItemSelect;

type ExistingPipelineItem = Prisma.PipelineItemGetPayload<{
  select: typeof PIPELINE_ITEM_SELECT;
}>;
type NormalizeBatchGenerator = AsyncGenerator<NormalizeCandidate[]>;

const TWITTER_SELECT = {
  tweetId: true,
  provider: true,
  handle: true,
  createdAt: true,
  fetchedAt: true,
  text: true,
  textShort: true,
  isNote: true,
  url: true,
  metrics: true,
  entities: true,
  media: true,
  rawEventId: true,
} satisfies Prisma.TweetSelect;

const FACEBOOK_INCLUDE = {
  source: {
    select: {
      id: true,
      name: true,
      type: true,
      slug: true,
      url: true,
      tags: true,
    },
  },
} satisfies Prisma.FbPostInclude;

const REDDIT_INCLUDE = {
  source: {
    select: {
      id: true,
      subreddit: true,
      tags: true,
    },
  },
} satisfies Prisma.RedditPostInclude;

const QIITA_INCLUDE = {
  source: {
    select: {
      id: true,
      tag: true,
      tags: true,
    },
  },
} satisfies Prisma.QiitaItemInclude;

const GITHUB_INCLUDE = {
  source: {
    select: {
      id: true,
      name: true,
      type: true,
      repo: true,
      query: true,
      tags: true,
    },
  },
} satisfies Prisma.GhItemInclude;

const INSTAGRAM_INCLUDE = {
  source: {
    select: {
      id: true,
      name: true,
      handle: true,
      tags: true,
    },
  },
} satisfies Prisma.IgPostInclude;

const ALERTS_INCLUDE = {
  source: {
    select: {
      id: true,
      name: true,
      feedUrl: true,
      tags: true,
    },
  },
} satisfies Prisma.AlertEntryInclude;

type TwitterRow = Prisma.TweetGetPayload<{ select: typeof TWITTER_SELECT }>;
type FacebookRow = Prisma.FbPostGetPayload<{ include: typeof FACEBOOK_INCLUDE }>;
type RedditRow = Prisma.RedditPostGetPayload<{ include: typeof REDDIT_INCLUDE }>;
type QiitaRow = Prisma.QiitaItemGetPayload<{ include: typeof QIITA_INCLUDE }>;
type GithubRow = Prisma.GhItemGetPayload<{ include: typeof GITHUB_INCLUDE }>;
type InstagramRow = Prisma.IgPostGetPayload<{ include: typeof INSTAGRAM_INCLUDE }>;
type AlertRow = Prisma.AlertEntryGetPayload<{ include: typeof ALERTS_INCLUDE }>;

function createEmptyCounter(): NormalizeCounter {
  return {
    scanned: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
}

function truncate(input: string | null | undefined, max = 160): string | null {
  if (!input) return null;
  const value = input.replace(/\s+/g, " ").trim();
  if (!value) return null;

  const codePoints = Array.from(value);
  if (codePoints.length <= max) return value;

  return `${codePoints.slice(0, Math.max(0, max - 1)).join("")}…`;
}

function cleanText(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = sanitizeText(input).trim();
  return value.length > 0 ? value : null;
}

function ensureUrl(input: string | null | undefined, platform: NormalizePlatform, sourceItemId: string): string {
  const value = (input || "").trim();
  if (value) return value;
  return `https://${FALLBACK_URL_HOST}/${platform}/${encodeURIComponent(sourceItemId)}`;
}

/**
 * Canonical URL normalization for Step0 dedupe and stable hashing.
 */
export function normalizeCanonicalUrl(rawUrl: string): string {
  const original = rawUrl.trim();
  if (!original) return original;

  try {
    let resolved = original;
    const outer = new URL(original);

    // Resolve Google redirect wrapper URLs.
    if (outer.hostname.endsWith("google.com") && outer.pathname === "/url") {
      const wrapped = outer.searchParams.get("url") || outer.searchParams.get("q");
      if (wrapped) {
        resolved = wrapped;
      }
    }

    const url = new URL(resolved);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }

    const params = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAM_RE.test(key))
      .sort(([a], [b]) => a.localeCompare(b));

    url.search = "";
    for (const [key, value] of params) {
      url.searchParams.append(key, value);
    }

    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return original;
  }
}

export function generateContentHash(payload: {
  platform: NormalizePlatform;
  sourceItemId: string;
  canonicalUrl: string;
  title?: string | null;
  body?: string | null;
  publishedAt?: Date | null;
}): string {
  const serialized = JSON.stringify({
    platform: payload.platform,
    sourceItemId: payload.sourceItemId,
    canonicalUrl: payload.canonicalUrl,
    title: cleanText(payload.title),
    body: cleanText(payload.body),
    publishedAt: payload.publishedAt ? payload.publishedAt.toISOString() : null,
  });

  return createHash("sha256").update(serialized).digest("hex");
}

export function clampPublishedAt(
  publishedAt: Date | null | undefined,
  reference: Date | null | undefined,
): Date | null {
  if (!publishedAt) return null;
  if (!reference) return publishedAt;
  return publishedAt.getTime() > reference.getTime() ? reference : publishedAt;
}

function buildCandidate(input: BuildCandidateInput): NormalizeCandidate {
  const publishedAt = clampPublishedAt(input.publishedAt, input.ingestedAt ?? null);
  const title = cleanText(input.title);
  const body = cleanText(input.body);
  const url = ensureUrl(input.url, input.platform, input.sourceItemId);
  const canonicalUrl = normalizeCanonicalUrl(url);
  const contentHash = generateContentHash({
    platform: input.platform,
    sourceItemId: input.sourceItemId,
    canonicalUrl,
    title,
    body,
    publishedAt,
  });

  const rawSource = input.raw || {};

  return {
    platform: input.platform,
    sourceItemId: input.sourceItemId,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef || null,
    title,
    body,
    url,
    canonicalUrl,
    publishedAt,
    ingestedAt: input.ingestedAt || null,
    language: input.language || null,
    raw: {
      source: {
        type: input.sourceType,
        ref: input.sourceRef || null,
        itemId: input.sourceItemId,
      },
      normalization: {
        version: 1,
        canonicalUrl,
        contentHash,
      },
      data: rawSource,
    },
  };
}

function sameNullableString(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a || null) === (b || null);
}

function resolveLookbackDays(value: number | undefined): number {
  const rawEnv = process.env.NORMALIZE_LOOKBACK_DAYS;
  const envValue = rawEnv && rawEnv.trim() ? Number(rawEnv) : Number.NaN;
  const resolved = value ?? envValue;
  return Number.isFinite(resolved) && resolved >= 0 ? resolved : DEFAULT_LOOKBACK_DAYS;
}

function createCutoff(now: Date, lookbackDays: number): Date | null {
  if (lookbackDays === 0) {
    return null;
  }

  return new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
}

export function stableStringify(value: Prisma.JsonValue | Prisma.InputJsonValue | null): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const objectValue = value as Prisma.JsonObject | Prisma.InputJsonObject;
    // Candidate raw values must never be `undefined` (Prisma drops undefined keys on
    // write, so an undefined-valued key here would compare unequal forever). All
    // builders read Prisma columns, which yield null — keep it that way.
    const entries = Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key] ?? null)}`);

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function stripEnrichment(
  value: Prisma.JsonValue | Prisma.InputJsonValue | null,
): Prisma.JsonValue | Prisma.InputJsonValue | null {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return value;
  }

  const { enrichment: _enrichment, ...rest } = value as Prisma.JsonObject;
  return rest;
}

function getExistingEnrichment(raw: Prisma.JsonValue | null): Prisma.JsonValue | undefined {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") {
    return undefined;
  }

  return (raw as Prisma.JsonObject).enrichment;
}

function mergeCandidateRaw(
  candidateRaw: Prisma.InputJsonObject,
  existingRaw: Prisma.JsonValue | null,
): Prisma.InputJsonObject {
  const existingEnrichment = getExistingEnrichment(existingRaw);

  return {
    ...candidateRaw,
    ...(existingEnrichment !== undefined ? { enrichment: existingEnrichment } : {}),
  };
}

function isUnchanged(existing: ExistingPipelineItem, candidate: NormalizeCandidate): boolean {
  return (
    sameNullableString(existing.externalId, candidate.sourceItemId) &&
    sameNullableString(existing.sourceType, candidate.sourceType) &&
    sameNullableString(existing.sourceRef, candidate.sourceRef) &&
    sameNullableString(existing.title, candidate.title) &&
    sameNullableString(existing.body, candidate.body) &&
    existing.url === candidate.url &&
    sameNullableString(existing.canonicalUrl, candidate.canonicalUrl) &&
    (existing.publishedAt?.getTime() || null) === (candidate.publishedAt?.getTime() || null) &&
    sameNullableString(existing.language, candidate.language) &&
    stableStringify(stripEnrichment(existing.raw ?? null)) === stableStringify(candidate.raw)
  );
}

function toCreateData(candidate: NormalizeCandidate, normalizedAt: Date): Prisma.PipelineItemCreateInput {
  return {
    platform: candidate.platform,
    externalId: candidate.sourceItemId,
    sourceType: candidate.sourceType,
    sourceRef: candidate.sourceRef || null,
    title: candidate.title || null,
    body: candidate.body || null,
    url: candidate.url,
    canonicalUrl: candidate.canonicalUrl || null,
    publishedAt: candidate.publishedAt || null,
    ingestedAt: candidate.ingestedAt || undefined,
    normalizedAt,
    language: candidate.language || null,
    raw: candidate.raw,
  };
}

function toUpdateData(
  candidate: NormalizeCandidate,
  normalizedAt: Date,
  existingRaw: Prisma.JsonValue | null,
): Prisma.PipelineItemUpdateInput {
  return {
    externalId: candidate.sourceItemId,
    sourceType: candidate.sourceType,
    sourceRef: candidate.sourceRef || null,
    title: candidate.title || null,
    body: candidate.body || null,
    url: candidate.url,
    canonicalUrl: candidate.canonicalUrl || null,
    publishedAt: candidate.publishedAt || null,
    ingestedAt: candidate.ingestedAt || undefined,
    normalizedAt,
    language: candidate.language || null,
    raw: mergeCandidateRaw(candidate.raw, existingRaw),
  };
}

async function upsertCandidate(
  prisma: PrismaClient,
  candidate: NormalizeCandidate,
  counter: NormalizeCounter,
  dryRun: boolean,
): Promise<void> {
  counter.scanned += 1;

  const byExternalId = await prisma.pipelineItem.findUnique({
    where: {
      platform_externalId: {
        platform: candidate.platform,
        externalId: candidate.sourceItemId,
      },
    },
    select: PIPELINE_ITEM_SELECT,
  });

  const existing =
    byExternalId ||
    // Alerts still need this by-URL fallback while legacy numeric externalIds
    // are migrated. It becomes redundant after every alert row has externalId=url.
    (await prisma.pipelineItem.findUnique({
      where: {
        platform_url: {
          platform: candidate.platform,
          url: candidate.url,
        },
      },
      select: PIPELINE_ITEM_SELECT,
    }));

  if (!existing) {
    counter.inserted += 1;
    if (!dryRun) {
      await prisma.pipelineItem.create({
        data: toCreateData(candidate, new Date()),
      });
    }
    return;
  }

  if (isUnchanged(existing, candidate)) {
    counter.skipped += 1;
    return;
  }

  counter.updated += 1;
  if (!dryRun) {
    await prisma.pipelineItem.update({
      where: { id: existing.id },
      data: toUpdateData(candidate, new Date(), existing.raw),
    });
  }
}

async function* normalizeTwitter(prisma: PrismaClient, cutoff: Date | null): NormalizeBatchGenerator {
  let cursor: string | null = null;

  for (;;) {
    const tweets: TwitterRow[] = await prisma.tweet.findMany({
      select: TWITTER_SELECT,
      where: cutoff ? { fetchedAt: { gte: cutoff } } : undefined,
      orderBy: { tweetId: "asc" },
      ...(cursor === null ? {} : { cursor: { tweetId: cursor }, skip: 1 }),
      take: BATCH_SIZE,
    });

    if (tweets.length === 0) {
      return;
    }

    yield tweets.map((t) =>
      buildCandidate({
        platform: "twitter",
        sourceItemId: t.tweetId,
        sourceType: "tweet",
        sourceRef: t.handle ? `@${t.handle}` : null,
        title: truncate(t.textShort || t.text, 140),
        body: t.text,
        url: t.url,
        publishedAt: t.createdAt,
        ingestedAt: t.fetchedAt,
        raw: {
          provider: t.provider,
          handle: t.handle,
          isNote: t.isNote,
          metrics: t.metrics as Prisma.InputJsonValue,
          entities: t.entities as Prisma.InputJsonValue,
          media: t.media as Prisma.InputJsonValue,
          rawEventId: t.rawEventId,
        },
      }),
    );
    cursor = tweets[tweets.length - 1].tweetId;
  }
}

async function* normalizeFacebook(prisma: PrismaClient, cutoff: Date | null): NormalizeBatchGenerator {
  let cursor: string | null = null;

  for (;;) {
    const posts: FacebookRow[] = await prisma.fbPost.findMany({
      include: FACEBOOK_INCLUDE,
      where: cutoff ? { fetchedAt: { gte: cutoff } } : undefined,
      orderBy: { postId: "asc" },
      ...(cursor === null ? {} : { cursor: { postId: cursor }, skip: 1 }),
      take: BATCH_SIZE,
    });

    if (posts.length === 0) {
      return;
    }

    yield posts.map((p) =>
      buildCandidate({
        platform: "facebook",
        sourceItemId: p.postId,
        sourceType: "fb_post",
        sourceRef: p.source.slug || p.source.url,
        title: truncate(p.text, 140),
        body: p.text,
        url: p.url,
        publishedAt: p.publishedAt || p.fetchedAt,
        ingestedAt: p.fetchedAt,
        raw: {
          sourceId: p.sourceId,
          sourceName: p.source.name,
          sourceType: p.source.type,
          sourceTags: p.source.tags,
          author: p.author,
          authorId: p.authorId,
          authorUrl: p.authorUrl,
          reactionCount: p.reactionCount,
          commentCount: p.commentCount,
          image: p.image,
          topComments: p.topComments as Prisma.InputJsonValue,
        },
      }),
    );
    cursor = posts[posts.length - 1].postId;
  }
}

async function* normalizeReddit(prisma: PrismaClient, cutoff: Date | null): NormalizeBatchGenerator {
  let cursor: string | null = null;

  for (;;) {
    const posts: RedditRow[] = await prisma.redditPost.findMany({
      include: REDDIT_INCLUDE,
      where: cutoff ? { fetchedAt: { gte: cutoff } } : undefined,
      orderBy: { id: "asc" },
      ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
      take: BATCH_SIZE,
    });

    if (posts.length === 0) {
      return;
    }

    yield posts.map((p) =>
      buildCandidate({
        platform: "reddit",
        sourceItemId: p.id,
        sourceType: "reddit_post",
        sourceRef: `r/${p.source.subreddit}`,
        title: p.title,
        body: p.text,
        url: p.url,
        publishedAt: p.publishedAt || p.fetchedAt,
        ingestedAt: p.fetchedAt,
        raw: {
          sourceId: p.sourceId,
          subreddit: p.source.subreddit,
          sourceTags: p.source.tags,
          author: p.author,
          score: p.score,
          upvoteRatio: p.upvoteRatio,
          commentCount: p.commentCount,
        },
      }),
    );
    cursor = posts[posts.length - 1].id;
  }
}

async function* normalizeQiita(prisma: PrismaClient, cutoff: Date | null): NormalizeBatchGenerator {
  let cursor: string | null = null;

  for (;;) {
    const items: QiitaRow[] = await prisma.qiitaItem.findMany({
      include: QIITA_INCLUDE,
      where: cutoff ? { fetchedAt: { gte: cutoff } } : undefined,
      orderBy: { id: "asc" },
      ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
      take: BATCH_SIZE,
    });

    if (items.length === 0) {
      return;
    }

    yield items.map((q) =>
      buildCandidate({
        platform: "qiita",
        sourceItemId: q.id,
        sourceType: "qiita_item",
        sourceRef: q.source.tag,
        title: q.title,
        body: q.body,
        url: q.url,
        publishedAt: q.publishedAt || q.fetchedAt,
        ingestedAt: q.fetchedAt,
        raw: {
          sourceId: q.sourceId,
          sourceTag: q.source.tag,
          sourceTags: q.source.tags,
          userId: q.userId,
          userName: q.userName,
          likesCount: q.likesCount,
          stocksCount: q.stocksCount,
          commentsCount: q.commentsCount,
          tags: q.tags,
        },
      }),
    );
    cursor = items[items.length - 1].id;
  }
}

async function* normalizeGithub(prisma: PrismaClient, cutoff: Date | null): NormalizeBatchGenerator {
  let cursor: string | null = null;

  for (;;) {
    const items: GithubRow[] = await prisma.ghItem.findMany({
      include: GITHUB_INCLUDE,
      where: cutoff ? { fetchedAt: { gte: cutoff } } : undefined,
      orderBy: { id: "asc" },
      ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
      take: BATCH_SIZE,
    });

    if (items.length === 0) {
      return;
    }

    yield items.map((g) =>
      buildCandidate({
        platform: "github",
        sourceItemId: g.id,
        sourceType: "gh_item",
        sourceRef: g.source.repo || g.source.query || g.source.name,
        title: g.title,
        body: g.body,
        url: g.url,
        publishedAt: g.publishedAt || g.fetchedAt,
        ingestedAt: g.fetchedAt,
        raw: {
          sourceId: g.sourceId,
          sourceName: g.source.name,
          sourceType: g.source.type,
          sourceRepo: g.source.repo,
          sourceQuery: g.source.query,
          sourceTags: g.source.tags,
          itemType: g.type,
          author: g.author,
          tagName: g.tagName,
          stars: g.stars,
          forks: g.forks,
          language: g.language,
          topics: g.topics,
        },
      }),
    );
    cursor = items[items.length - 1].id;
  }
}

async function* normalizeInstagram(prisma: PrismaClient, cutoff: Date | null): NormalizeBatchGenerator {
  let cursor: string | null = null;

  for (;;) {
    const posts: InstagramRow[] = await prisma.igPost.findMany({
      include: INSTAGRAM_INCLUDE,
      where: cutoff ? { fetchedAt: { gte: cutoff } } : undefined,
      orderBy: { id: "asc" },
      ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
      take: BATCH_SIZE,
    });

    if (posts.length === 0) {
      return;
    }

    yield posts.map((p) =>
      buildCandidate({
        platform: "instagram",
        sourceItemId: p.id,
        sourceType: "ig_post",
        sourceRef: p.source.handle,
        title: truncate(p.caption, 140),
        body: p.caption,
        url: p.url,
        publishedAt: p.publishedAt || p.fetchedAt,
        ingestedAt: p.fetchedAt,
        raw: {
          sourceId: p.sourceId,
          sourceName: p.source.name,
          sourceHandle: p.source.handle,
          sourceTags: p.source.tags,
          imageUrl: p.imageUrl,
          mediaType: p.mediaType,
          likeCount: p.likeCount,
          commentCount: p.commentCount,
        },
      }),
    );
    cursor = posts[posts.length - 1].id;
  }
}

async function* normalizeAlerts(prisma: PrismaClient, cutoff: Date | null): NormalizeBatchGenerator {
  let cursor: number | null = null;
  const candidateByExternalId = new Map<
    string,
    { alertEntryId: number; candidate: NormalizeCandidate }
  >();

  for (;;) {
    const entries: AlertRow[] = await prisma.alertEntry.findMany({
      include: ALERTS_INCLUDE,
      where: cutoff ? { fetchedAt: { gte: cutoff } } : undefined,
      orderBy: { id: "asc" },
      ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
      take: BATCH_SIZE,
    });

    if (entries.length === 0) {
      break;
    }

    for (const a of entries) {
      const candidate = buildCandidate({
        platform: "alerts",
        sourceItemId: a.articleUrl,
        sourceType: "alert_entry",
        sourceRef: a.source.feedUrl,
        title: a.title,
        body: a.snippet,
        url: a.articleUrl,
        publishedAt: a.publishedAt || a.fetchedAt,
        ingestedAt: a.fetchedAt,
        raw: {
          sourceId: a.sourceId,
          sourceName: a.source.name,
          sourceFeedUrl: a.source.feedUrl,
          sourceTags: a.source.tags,
          rawLink: a.rawLink,
          raw: a.raw as Prisma.InputJsonValue,
        },
      });
      const existing = candidateByExternalId.get(candidate.sourceItemId);
      if (!existing || a.id < existing.alertEntryId) {
        candidateByExternalId.set(candidate.sourceItemId, {
          alertEntryId: a.id,
          candidate,
        });
      }
    }
    cursor = entries[entries.length - 1].id;
  }

  const winners = [...candidateByExternalId.values()]
    .sort((a, b) => a.alertEntryId - b.alertEntryId)
    .map((entry) => entry.candidate);
  for (let index = 0; index < winners.length; index += BATCH_SIZE) {
    yield winners.slice(index, index + BATCH_SIZE);
  }
}

const PLATFORM_FETCHERS: Record<
  NormalizePlatform,
  (prisma: PrismaClient, cutoff: Date | null) => NormalizeBatchGenerator
> = {
  twitter: normalizeTwitter,
  facebook: normalizeFacebook,
  reddit: normalizeReddit,
  qiita: normalizeQiita,
  github: normalizeGithub,
  instagram: normalizeInstagram,
  alerts: normalizeAlerts,
};

function resolvePlatforms(platforms?: NormalizePlatform[]): NormalizePlatform[] {
  if (!platforms || platforms.length === 0) {
    return [...NORMALIZE_PLATFORMS];
  }

  const uniq = new Set<NormalizePlatform>();
  for (const platform of platforms) {
    if (!NORMALIZE_PLATFORMS.includes(platform)) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    uniq.add(platform);
  }

  return [...uniq];
}

function addCounter(target: NormalizeCounter, add: NormalizeCounter): void {
  target.scanned += add.scanned;
  target.inserted += add.inserted;
  target.updated += add.updated;
  target.skipped += add.skipped;
  target.failed += add.failed;
}

export async function normalizePipelineItems(
  prisma: PrismaClient,
  options: NormalizeOptions = {},
): Promise<NormalizeMetrics> {
  const logger = options.logger || console;
  const startedAt = new Date();
  const dryRun = Boolean(options.dryRun);
  const platforms = resolvePlatforms(options.platforms);
  const lookbackDays = resolveLookbackDays(options.lookbackDays);
  const cutoff = createCutoff(startedAt, lookbackDays);

  const perPlatform = Object.fromEntries(
    NORMALIZE_PLATFORMS.map((platform) => [platform, createEmptyCounter()]),
  ) as Record<NormalizePlatform, NormalizeCounter>;

  logger.log(
    `[normalize] lookbackDays=${lookbackDays} cutoff=${cutoff ? cutoff.toISOString() : "none"} batchSize=${BATCH_SIZE}`,
  );

  for (const platform of platforms) {
    const counter = perPlatform[platform];

    logger.log(`\n[normalize] platform=${platform} start`);

    for await (const candidates of PLATFORM_FETCHERS[platform](prisma, cutoff)) {
      for (const candidate of candidates) {
        try {
          await upsertCandidate(prisma, candidate, counter, dryRun);
        } catch (error: any) {
          counter.failed += 1;
          logger.warn(
            `[normalize] platform=${platform} item=${candidate.sourceItemId} failed: ${error?.message || "unknown error"}`,
          );
        }
      }
    }

    logger.log(
      `[normalize] platform=${platform} scanned=${counter.scanned} inserted=${counter.inserted} updated=${counter.updated} skipped=${counter.skipped} failed=${counter.failed}`,
    );
  }

  const totals = createEmptyCounter();
  for (const platform of NORMALIZE_PLATFORMS) {
    addCounter(totals, perPlatform[platform]);
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    dryRun,
    platforms,
    perPlatform,
    totals,
  };
}
