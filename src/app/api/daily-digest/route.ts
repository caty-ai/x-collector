import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeBearerCheck } from "@/lib/auth/bearer";
import { requireStudioSession } from "@/lib/auth/require-session";

const prisma = new PrismaClient();
const DIGEST_MAX_RANGE_DAYS = 7;
const DIGEST_QUERY_TAKE = 2000;
const DIGEST_ITEM_CAP = 2000;

type DigestDateBasis = "jst-date" | "explicit-range" | "rolling-24h";

type RangeResolution = {
  from: Date;
  to: Date;
  dateBasis: DigestDateBasis;
  rangeClamped: boolean;
  requestedFrom: string | null;
  requestedTo: string | null;
};

type DigestTweetRow = {
  tweetId: string;
  handle: string;
  createdAt: Date;
  text: string;
  isNote: boolean;
  url: string;
  metrics: unknown;
};

type DigestAlertRow = {
  id: number;
  title: string;
  snippet: string | null;
  articleUrl: string;
  publishedAt: Date | null;
  fetchedAt: Date;
  source: {
    name: string;
  };
};

type DigestItem = {
  id: string;
  sourceType: "tweet" | "alert";
  title: string;
  text: string;
  url: string;
  author: string | null;
  sourceName?: string;
  publishedAt: string;
  metrics: Record<string, number> | null;
  engagementScore: number | null;
  isNote?: boolean;
};

const DIGEST_MAX_RANGE_MS = DIGEST_MAX_RANGE_DAYS * 24 * 3600_000;

function getEngagementScore(metrics: any): number | null {
  if (!metrics || typeof metrics !== "object") return null;
  const m = metrics as Record<string, number>;
  return (m.bookmark ?? 0) * 5 + (m.like ?? 0) * 2 + (m.retweet ?? 0) * 3 + (m.view ?? 0) * 0.001;
}

function hasValidDigestBearer(req: NextRequest): boolean {
  const apiKey = process.env.DIGEST_API_KEY;
  if (!apiKey) return false;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  return timingSafeBearerCheck(auth, apiKey);
}

function resolveDigestRange(
  dateParam: string | null,
  fromParam: string | null,
  toParam: string | null,
  now = new Date(),
): RangeResolution {
  let from: Date;
  let to: Date;
  let dateBasis: DigestDateBasis = "rolling-24h";
  let rangeClamped = false;

  if (dateParam) {
    from = new Date(`${dateParam}T00:00:00.000+09:00`);
    to = new Date(from.getTime() + 24 * 3600_000 - 1);
    dateBasis = "jst-date";
  } else if (fromParam) {
    from = new Date(fromParam);
    to = toParam ? new Date(toParam) : now;
    dateBasis = "explicit-range";
  } else {
    to = now;
    from = new Date(to.getTime() - 24 * 3600_000);
  }

  if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to.getTime() - from.getTime() > DIGEST_MAX_RANGE_MS) {
    from = new Date(to.getTime() - DIGEST_MAX_RANGE_MS);
    rangeClamped = true;
  }

  return {
    from,
    to,
    dateBasis,
    rangeClamped,
    requestedFrom: fromParam,
    requestedTo: toParam,
  };
}

function toDigestItemFromTweet(t: DigestTweetRow): DigestItem {
  const score = getEngagementScore(t.metrics);
  return {
    id: t.tweetId,
    sourceType: "tweet",
    title: t.text.slice(0, 100) + (t.text.length > 100 ? "…" : ""),
    text: t.text.slice(0, 500),
    url: t.url,
    author: t.handle,
    publishedAt: t.createdAt.toISOString(),
    metrics: (t.metrics as Record<string, number> | null) ?? null,
    engagementScore: score,
    isNote: t.isNote,
  };
}

function toDigestItemFromAlert(a: DigestAlertRow): DigestItem {
  return {
    id: String(a.id),
    sourceType: "alert",
    title: a.title,
    text: a.snippet || "",
    url: a.articleUrl,
    author: null,
    sourceName: a.source.name,
    publishedAt: (a.publishedAt || a.fetchedAt).toISOString(),
    metrics: null,
    engagementScore: null,
  };
}

function buildDigestItems(tweets: DigestTweetRow[], alerts: DigestAlertRow[]): DigestItem[] {
  const items = [...tweets.map(toDigestItemFromTweet), ...alerts.map(toDigestItemFromAlert)];

  items.sort((a, b) => {
    if (a.engagementScore !== null && b.engagementScore !== null) {
      return b.engagementScore - a.engagementScore;
    }
    if (a.engagementScore !== null) return -1;
    if (b.engagementScore !== null) return 1;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  return items.slice(0, DIGEST_ITEM_CAP);
}

export async function GET(req: NextRequest) {
  if (!hasValidDigestBearer(req)) {
    const denied = await requireStudioSession();
    if (denied) return denied;
  }

  const dateParam = req.nextUrl.searchParams.get("date");
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const { from, to, dateBasis, rangeClamped, requestedFrom, requestedTo } = resolveDigestRange(
    dateParam,
    fromParam,
    toParam,
  );

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date parameters" }, { status: 400 });
  }

  if (from.getTime() > to.getTime()) {
    return NextResponse.json({ error: "Invalid date range: 'from' must be less than or equal to 'to'" }, { status: 400 });
  }

  const tweets = await prisma.tweet.findMany({
    where: {
      createdAt: { gte: from, lte: to },
    },
    orderBy: [{ createdAt: "desc" }, { tweetId: "desc" }],
    take: DIGEST_QUERY_TAKE,
    select: {
      tweetId: true,
      handle: true,
      createdAt: true,
      text: true,
      isNote: true,
      url: true,
      metrics: true,
    },
  });

  const alerts = await prisma.alertEntry.findMany({
    where: {
      OR: [
        { publishedAt: { gte: from, lte: to } },
        { publishedAt: null, fetchedAt: { gte: from, lte: to } },
      ],
    },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { fetchedAt: "desc" }, { id: "desc" }],
    take: DIGEST_QUERY_TAKE,
    select: {
      id: true,
      title: true,
      snippet: true,
      articleUrl: true,
      publishedAt: true,
      fetchedAt: true,
      source: {
        select: {
          name: true,
        },
      },
    },
  });

  const items = buildDigestItems(tweets, alerts);
  const tweetCount = items.filter((item) => item.sourceType === "tweet").length;
  const alertCount = items.length - tweetCount;

  return NextResponse.json({
    meta: {
      from: from.toISOString(),
      to: to.toISOString(),
      dateBasis,
      timeZoneForDateParam: "Asia/Tokyo",
      rangeClamped,
      requestedFrom,
      requestedTo,
      maxRangeDays: DIGEST_MAX_RANGE_DAYS,
      tweetCount,
      alertCount,
      totalItems: items.length,
    },
    items,
  });
}
