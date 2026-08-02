import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeBearerCheck } from "@/lib/auth/bearer";

const prisma = new PrismaClient();
let warnedMissingFeedApiKey = false;

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

function authenticate(req: NextRequest): Response | null {
  const apiKey = process.env.FEED_API_KEY?.trim();

  if (!apiKey) {
    if (isProductionRuntime()) {
      return NextResponse.json({ error: "api key not configured" }, { status: 401 });
    }

    if (!warnedMissingFeedApiKey) {
      warnedMissingFeedApiKey = true;
      console.warn("[feed-api] API auth disabled outside production; missing env: FEED_API_KEY");
    }
    return null;
  }

  const auth = req.headers.get("authorization");
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized. Provide header: Authorization: Bearer <FEED_API_KEY>" },
      { status: 401 },
    );
  }

  if (timingSafeBearerCheck(auth, apiKey)) {
    return null;
  }

  return NextResponse.json(
    { error: "Unauthorized. Provide header: Authorization: Bearer <FEED_API_KEY>" },
    { status: 401 },
  );
}

// ── Types ───────────────────────────────────────────────
interface FeedItem {
  id: string;
  platform: string;
  title: string;
  text: string;
  url: string;
  author: string | null;
  sourceName: string | null;
  tags: string[];
  publishedAt: string;
  metrics: Record<string, number> | null;
}

const PLATFORMS = ["twitter", "instagram", "facebook", "reddit", "qiita", "github", "alerts"] as const;
type Platform = (typeof PLATFORMS)[number];

// ── Helpers ─────────────────────────────────────────────
function parseDateRange(req: NextRequest): { from: Date; to: Date; basis: "jst-date" | "explicit-range" | "rolling-24h" } {
  const sp = req.nextUrl.searchParams;
  const dateParam = sp.get("date");
  const fromParam = sp.get("from");
  const toParam = sp.get("to");

  if (dateParam) {
    // date=YYYY-MM-DD is interpreted as JST calendar day.
    // Example: 2026-03-11 => [2026-03-10T15:00:00.000Z, 2026-03-11T14:59:59.999Z]
    const from = new Date(`${dateParam}T00:00:00.000+09:00`);
    const to = new Date(from.getTime() + 24 * 3600_000 - 1);
    return { from, to, basis: "jst-date" };
  }

  if (fromParam) {
    return {
      from: new Date(fromParam),
      to: toParam ? new Date(toParam) : new Date(),
      basis: "explicit-range",
    };
  }

  // Default: last 24h
  const to = new Date();
  return { from: new Date(to.getTime() - 24 * 3600_000), to, basis: "rolling-24h" };
}

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function matchKeyword(keyword: string, ...fields: (string | null | undefined)[]): boolean {
  const kw = keyword.toLowerCase();
  return fields.some((f) => f && f.toLowerCase().includes(kw));
}

// ── Collectors ──────────────────────────────────────────
async function fetchTwitter(from: Date, to: Date): Promise<FeedItem[]> {
  const tweets = await prisma.tweet.findMany({
    where: { createdAt: { gte: from, lte: to } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return tweets.map((t) => ({
    id: t.tweetId,
    platform: "twitter",
    title: truncate(t.text, 100),
    text: truncate(t.text, 500),
    url: t.url,
    author: t.handle,
    sourceName: null,
    tags: [],
    publishedAt: t.createdAt.toISOString(),
    metrics: t.metrics as Record<string, number> | null,
  }));
}

async function fetchInstagram(from: Date, to: Date): Promise<FeedItem[]> {
  const posts = await prisma.igPost.findMany({
    where: {
      OR: [
        { publishedAt: { gte: from, lte: to } },
        { publishedAt: null, fetchedAt: { gte: from, lte: to } },
      ],
    },
    include: { source: true },
    orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    take: 500,
  });
  return posts.map((p) => ({
    id: p.id,
    platform: "instagram",
    title: truncate(p.caption, 100),
    text: truncate(p.caption, 500),
    url: p.url,
    author: p.source.handle,
    sourceName: p.source.name,
    tags: p.source.tags || [],
    publishedAt: (p.publishedAt || p.fetchedAt).toISOString(),
    metrics: { likes: p.likeCount, comments: p.commentCount },
  }));
}

async function fetchFacebook(from: Date, to: Date): Promise<FeedItem[]> {
  const posts = await prisma.fbPost.findMany({
    where: {
      OR: [
        { publishedAt: { gte: from, lte: to } },
        { publishedAt: null, fetchedAt: { gte: from, lte: to } },
      ],
    },
    include: { source: true },
    orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    take: 500,
  });
  return posts.map((p) => ({
    id: p.postId,
    platform: "facebook",
    title: truncate(p.text, 100),
    text: truncate(p.text, 500),
    url: p.url || "",
    author: p.author || null,
    sourceName: p.source.name,
    tags: p.source.tags || [],
    publishedAt: (p.publishedAt || p.fetchedAt).toISOString(),
    metrics: { reactions: p.reactionCount || 0, comments: p.commentCount || 0 },
  }));
}

async function fetchReddit(from: Date, to: Date): Promise<FeedItem[]> {
  const posts = await prisma.redditPost.findMany({
    where: {
      OR: [
        { publishedAt: { gte: from, lte: to } },
        { publishedAt: null, fetchedAt: { gte: from, lte: to } },
      ],
    },
    include: { source: true },
    orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    take: 500,
  });
  return posts.map((p) => ({
    id: p.id,
    platform: "reddit",
    title: p.title,
    text: truncate(p.text, 500),
    url: p.url,
    author: p.author || null,
    sourceName: `r/${p.source.subreddit}`,
    tags: p.source.tags || [],
    publishedAt: (p.publishedAt || p.fetchedAt).toISOString(),
    metrics: { score: p.score || 0, comments: p.commentCount || 0 },
  }));
}

async function fetchQiita(from: Date, to: Date): Promise<FeedItem[]> {
  const items = await prisma.qiitaItem.findMany({
    where: {
      OR: [
        { publishedAt: { gte: from, lte: to } },
        { publishedAt: null, fetchedAt: { gte: from, lte: to } },
      ],
    },
    include: { source: true },
    orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    take: 500,
  });
  return items.map((q) => ({
    id: q.id,
    platform: "qiita",
    title: q.title,
    text: truncate(q.body, 500),
    url: q.url,
    author: q.userName || q.userId || null,
    sourceName: `#${q.source.tag}`,
    tags: q.source.tags || [],
    publishedAt: (q.publishedAt || q.fetchedAt).toISOString(),
    metrics: { likes: q.likesCount || 0, stocks: q.stocksCount || 0 },
  }));
}

async function fetchGithub(from: Date, to: Date): Promise<FeedItem[]> {
  const items = await prisma.ghItem.findMany({
    where: {
      OR: [
        { publishedAt: { gte: from, lte: to } },
        { publishedAt: null, fetchedAt: { gte: from, lte: to } },
      ],
    },
    include: { source: true },
    orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    take: 500,
  });
  return items.map((g) => ({
    id: g.id,
    platform: "github",
    title: g.title,
    text: truncate(g.body, 500),
    url: g.url,
    author: g.author || null,
    sourceName: g.source.name,
    tags: [...(g.source.tags || []), ...(g.topics || [])],
    publishedAt: (g.publishedAt || g.fetchedAt).toISOString(),
    metrics: g.stars != null ? { stars: g.stars, forks: g.forks || 0 } : null,
  }));
}

async function fetchAlerts(from: Date, to: Date): Promise<FeedItem[]> {
  const entries = await prisma.alertEntry.findMany({
    where: {
      OR: [
        { publishedAt: { gte: from, lte: to } },
        { publishedAt: null, fetchedAt: { gte: from, lte: to } },
      ],
    },
    include: { source: true },
    orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    take: 500,
  });
  return entries.map((a) => ({
    id: String(a.id),
    platform: "alerts",
    title: a.title,
    text: truncate(a.snippet, 500),
    url: a.articleUrl,
    author: null,
    sourceName: a.source.name,
    tags: a.source.tags || [],
    publishedAt: (a.publishedAt || a.fetchedAt).toISOString(),
    metrics: null,
  }));
}

const FETCHERS: Record<Platform, (from: Date, to: Date) => Promise<FeedItem[]>> = {
  twitter: fetchTwitter,
  instagram: fetchInstagram,
  facebook: fetchFacebook,
  reddit: fetchReddit,
  qiita: fetchQiita,
  github: fetchGithub,
  alerts: fetchAlerts,
};

// ── Main Handler ────────────────────────────────────────
export async function GET(req: NextRequest) {
  const denied = authenticate(req);
  if (denied) {
    return denied;
  }

  const sp = req.nextUrl.searchParams;
  const { from, to, basis } = parseDateRange(req);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date parameters" }, { status: 400 });
  }

  // Platform filter
  const platformParam = sp.get("platform");
  const platforms: Platform[] = platformParam
    ? platformParam.split(",").filter((p): p is Platform => PLATFORMS.includes(p as Platform))
    : [...PLATFORMS];

  if (platforms.length === 0) {
    return NextResponse.json({ error: `Invalid platform. Use: ${PLATFORMS.join(", ")}` }, { status: 400 });
  }

  // Keyword filter
  const keyword = sp.get("keyword") || sp.get("q") || null;

  // Source filter (sourceName / author)
  const source = sp.get("source") || null;

  // Limit
  const limit = Math.min(parseInt(sp.get("limit") || "500", 10), 2000);

  // Fetch all requested platforms in parallel
  const results = await Promise.all(platforms.map((p) => FETCHERS[p](from, to)));
  let items = results.flat();

  // Apply keyword filter
  if (keyword) {
    items = items.filter((item) => matchKeyword(keyword, item.title, item.text, item.author, item.sourceName));
  }

  // Apply source filter (case-insensitive partial match)
  if (source) {
    const s = source.toLowerCase();
    items = items.filter(
      (item) =>
        (item.sourceName || "").toLowerCase().includes(s) ||
        (item.author || "").toLowerCase().includes(s),
    );
  }

  // Sort by publishedAt descending
  items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  // Apply limit
  items = items.slice(0, limit);

  // Build per-platform counts
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.platform] = (counts[item.platform] || 0) + 1;
  }

  return NextResponse.json({
    meta: {
      from: from.toISOString(),
      to: to.toISOString(),
      dateBasis: basis,
      timeZoneForDateParam: "Asia/Tokyo",
      platforms,
      keyword: keyword || null,
      source: source || null,
      totalItems: items.length,
      counts,
    },
    items,
  });
}
