import { Prisma, PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeBearerCheck } from "@/lib/auth/bearer";

const prisma = new PrismaClient();
let warnedMissingFamilyFeedApiKey = false;

// Rows committed concurrently in the same ms as a page boundary would otherwise be skipped
// forever by the strict gt cursor.
const FRESHNESS_LAG_MS = 2000;
const ISO_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

type DateBasis = "jst-date" | "explicit-range" | "rolling-48h" | "since";

type RawItem = {
  id: string;
  platform: string;
  author: null;
  sourceRef: string | null;
  url: string;
  title: string;
  titleJa: string | null;
  summaryJa: string | null;
  tags: string[];
  publishedAt: string | null;
  classifiedAt: string;
  topicClusterKey: string | null;
  distinctSources: number | null;
  clusterSize: number | null;
  mentionedBy: number | null;
  _headlineScore: number;
  _priorityScore: number;
};

type FamilyFeedItem = Omit<RawItem, "_headlineScore" | "_priorityScore">;
type BodyPreviewRow = { id: string; bodyPreview: string | null };

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function parseStrictDateTime(value: string): Date | null {
  const match = ISO_DATE_TIME_RE.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    !isValidCalendarDate(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))
  ) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isStrictDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  return match !== null && isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function parseDateRange(
  req: NextRequest,
  since: Date | null,
): { from: Date; to: Date; basis: DateBasis } {
  const sp = req.nextUrl.searchParams;
  const dateParam = sp.get("date");
  const fromParam = sp.get("from");
  const toParam = sp.get("to");

  if (dateParam) {
    const from = new Date(`${dateParam}T00:00:00.000+09:00`);
    const to = new Date(from.getTime() + 24 * 3600_000 - 1);
    return { from, to, basis: "jst-date" };
  }

  if (fromParam || toParam) {
    return {
      // A since cursor with only a to bound must not drop older-than-48h items
      // just because from was not explicit.
      from: fromParam ? new Date(fromParam) : since ? since : new Date(Date.now() - 48 * 3600_000),
      to: toParam ? new Date(toParam) : new Date(Date.now() - FRESHNESS_LAG_MS),
      basis: "explicit-range",
    };
  }

  const to = new Date(Date.now() - FRESHNESS_LAG_MS);
  if (since) {
    return { from: since, to, basis: "since" };
  }
  return { from: new Date(to.getTime() - 48 * 3600_000), to, basis: "rolling-48h" };
}

function parseLimit(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : 100;
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(parsed, 500);
}

function parseCommaList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function pickCanonical(group: RawItem[]): RawItem {
  return group.reduce((best, item) => {
    if (item._headlineScore > best._headlineScore) return item;
    if (item._headlineScore < best._headlineScore) return best;
    if (item._priorityScore > best._priorityScore) return item;
    if (item._priorityScore < best._priorityScore) return best;
    return item.classifiedAt < best.classifiedAt ? item : best;
  }, group[0]);
}

function stripScores(item: RawItem): FamilyFeedItem {
  const { _headlineScore: _h, _priorityScore: _p, ...rest } = item;
  return rest;
}

function sortByRecency(a: RawItem, b: RawItem): number {
  // Newest-first by publish time (fallback to classification time). ISO strings sort lexically.
  const ad = a.publishedAt ?? a.classifiedAt;
  const bd = b.publishedAt ?? b.classifiedAt;
  return bd.localeCompare(ad);
}

function deduplicateItems(
  items: RawItem[],
  dedup: boolean,
): RawItem[] {
  if (!dedup) {
    return items;
  }

  const grouped = new Map<string, RawItem[]>();
  const solo: RawItem[] = [];
  for (const item of items) {
    if (item.topicClusterKey && (item.distinctSources ?? 0) >= 2) {
      const group = grouped.get(item.topicClusterKey) ?? [];
      group.push(item);
      grouped.set(item.topicClusterKey, group);
    } else {
      solo.push(item);
    }
  }

  const canonicals = Array.from(grouped.values()).map(pickCanonical);
  return [...canonicals, ...solo];
}

function selectOldestPrefix(items: RawItem[], limit: number): RawItem[] {
  const sorted = [...items].sort((a, b) => a.classifiedAt.localeCompare(b.classifiedAt));
  if (sorted.length <= limit) return sorted;

  const boundary = sorted[limit - 1].classifiedAt;
  const end = sorted.findIndex((item) => item.classifiedAt > boundary);
  return sorted.slice(0, end === -1 ? sorted.length : end);
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.FAMILY_FEED_API_KEY?.trim();
  let denied: Response | null = null;
  if (!apiKey) {
    if (isProductionRuntime()) {
      denied = NextResponse.json({ error: "api key not configured" }, { status: 401 });
    } else {
      if (!warnedMissingFamilyFeedApiKey) {
        warnedMissingFamilyFeedApiKey = true;
        console.warn(
          "[family-feed-api] API auth disabled outside production; missing env: FAMILY_FEED_API_KEY",
        );
      }
    }
  } else {
    const auth = req.headers.get("authorization");
    if (!auth || !timingSafeBearerCheck(auth, apiKey)) {
      denied = NextResponse.json(
        { error: "Unauthorized. Provide header: Authorization: Bearer <FAMILY_FEED_API_KEY>" },
        { status: 401 },
      );
    }
  }
  if (denied) {
    return denied;
  }

  const sp = req.nextUrl.searchParams;
  const sinceParam = sp.get("since");
  const since = sinceParam === null ? null : parseStrictDateTime(sinceParam);

  if (sinceParam !== null && !since) {
    return NextResponse.json({ error: "Invalid since parameter" }, { status: 400 });
  }

  const fromParam = sp.get("from");
  const toParam = sp.get("to");
  const dateParam = sp.get("date");
  if (fromParam !== null && !parseStrictDateTime(fromParam)) {
    return NextResponse.json({ error: "Invalid from parameter" }, { status: 400 });
  }
  if (toParam !== null && !parseStrictDateTime(toParam)) {
    return NextResponse.json({ error: "Invalid to parameter" }, { status: 400 });
  }
  if (dateParam !== null && !isStrictDate(dateParam)) {
    return NextResponse.json({ error: "Invalid date parameter" }, { status: 400 });
  }

  const { from, to, basis } = parseDateRange(req, since);

  const effectiveFrom = since && since.getTime() > from.getTime() ? since : from;
  if (effectiveFrom.getTime() > to.getTime()) {
    return NextResponse.json(
      { error: "Empty/inverted range: since/from is after to" },
      { status: 400 },
    );
  }

  const categories = parseCommaList(sp.get("category"));
  const tags = parseCommaList(sp.get("tags"));
  const keywords = parseCommaList(sp.get("keywords"));
  const action = sp.get("action") || null;
  const platform = sp.get("platform") || null;
  const limit = parseLimit(sp.get("limit"));
  const dedup = sp.get("dedup") !== "false";
  const classifiedAt =
    since && since.getTime() >= from.getTime()
      ? { gt: since, lte: to }
      : { gte: from, lte: to };
  const takeCap = Math.min(limit * 10, 5000);
  const filterGroups = [
    ...(tags.length > 0
      ? [
          {
            OR: [
              { primaryTag: { in: tags } },
              { subTag: { in: tags } },
              { actionTag: { in: tags } },
            ],
          },
        ]
      : []),
    ...(keywords.length > 0
      ? [
          {
            OR: keywords.flatMap((keyword) => [
              { titleJa: { contains: keyword, mode: "insensitive" as const } },
              { summaryJa: { contains: keyword, mode: "insensitive" as const } },
              { pipelineItem: { title: { contains: keyword, mode: "insensitive" as const } } },
            ]),
          },
        ]
      : []),
  ];
  const primaryTagCondition =
    categories.length > 0 ? { in: categories } : tags.length > 0 ? undefined : { not: null };

  const rawClassifications = await prisma.pipelineClassification.findMany({
    where: {
      noise: false,
      ...(primaryTagCondition ? { primaryTag: primaryTagCondition } : {}),
      classifiedAt,
      ...(action ? { actionTag: action } : {}),
      ...(platform ? { pipelineItem: { platform } } : {}),
      ...(filterGroups.length > 0 ? { AND: filterGroups } : {}),
    },
    orderBy: [{ classifiedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      pipelineItemId: true,
      primaryTag: true,
      subTag: true,
      actionTag: true,
      titleJa: true,
      summaryJa: true,
      classifiedAt: true,
      pipelineItem: {
        select: {
          id: true,
          platform: true,
          title: true,
          url: true,
          canonicalUrl: true,
          sourceRef: true,
          publishedAt: true,
        },
      },
    },
    take: takeCap,
  });

  let classifications = rawClassifications;
  if (rawClassifications.length >= takeCap) {
    const dbMax = rawClassifications[rawClassifications.length - 1].classifiedAt;
    const beforeDbMax = rawClassifications.filter(
      (classification) => classification.classifiedAt.getTime() < dbMax.getTime(),
    );
    // Retain a pathological all-tied window so pagination does not return an empty page.
    // Its plain datetime cursor cannot safely represent rows sharing this timestamp.
    if (beforeDbMax.length > 0) {
      classifications = beforeDbMax;
    }
  }

  const latestByItem = new Map<string, (typeof rawClassifications)[number]>();
  for (const classification of classifications) {
    // Classifications are ascending, so the last value is the newest for each item.
    latestByItem.set(classification.pipelineItemId, classification);
  }

  const eligible = Array.from(latestByItem.values());

  const itemIds = eligible.map((classification) => classification.pipelineItemId);
  const decisions =
    itemIds.length > 0
      ? await prisma.pipelineCrosslinkLlmDecision.findMany({
          where: { pipelineItemId: { in: itemIds } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            pipelineItemId: true,
            headlineScore: true,
            priorityScore: true,
            topicClusterKey: true,
            distinctSources: true,
            clusterSize: true,
          },
        })
      : [];

  const decisionMap = new Map<string, (typeof decisions)[number]>();
  for (const decision of decisions) {
    if (!decisionMap.has(decision.pipelineItemId)) {
      decisionMap.set(decision.pipelineItemId, decision);
    }
  }

  const bodyPreviewIds = eligible
    .filter((classification) => classification.summaryJa === null)
    .map((classification) => classification.pipelineItemId);
  const bodyPreviewRows =
    bodyPreviewIds.length > 0
      ? await prisma.$queryRaw<BodyPreviewRow[]>(Prisma.sql`
          SELECT id, LEFT(body, 200) AS "bodyPreview"
          FROM "pipeline_items"
          WHERE id IN (${Prisma.join(bodyPreviewIds)})
        `)
      : [];
  const bodyPreviewById = new Map(bodyPreviewRows.map((row) => [row.id, row.bodyPreview] as const));

  const items: RawItem[] = eligible.map((classification) => {
    const item = classification.pipelineItem;
    const decision = decisionMap.get(classification.pipelineItemId);
    return {
      id: classification.pipelineItemId,
      platform: item?.platform ?? "unknown",
      author: null,
      sourceRef: item?.sourceRef ?? null,
      url: item?.canonicalUrl || item?.url || "",
      title: item?.title ?? "",
      titleJa: classification.titleJa ?? item?.title ?? null,
      summaryJa: classification.summaryJa ?? bodyPreviewById.get(classification.pipelineItemId) ?? null,
      tags: [classification.primaryTag, classification.subTag, classification.actionTag].filter(
        (tag): tag is string => tag != null,
      ),
      publishedAt: item?.publishedAt?.toISOString() ?? null,
      classifiedAt: classification.classifiedAt.toISOString(),
      topicClusterKey: decision?.topicClusterKey ?? null,
      distinctSources: decision?.distinctSources ?? null,
      clusterSize: decision?.clusterSize ?? null,
      mentionedBy: decision?.distinctSources ?? null,
      _headlineScore: decision?.headlineScore ?? 0,
      _priorityScore: decision?.priorityScore ?? 0,
    };
  });

  const mergedItems = deduplicateItems(items, dedup);
  const prelimitCount = mergedItems.length;
  const truncated = rawClassifications.length >= takeCap || prelimitCount > limit;
  const finalItems = truncated
    ? selectOldestPrefix(mergedItems, limit).sort(sortByRecency).map(stripScores)
    : mergedItems.sort(sortByRecency).slice(0, limit).map(stripScores);
  let nextSince: string | null = null;
  let newestTime = Number.NEGATIVE_INFINITY;
  for (const item of finalItems) {
    const classifiedTime = Date.parse(item.classifiedAt);
    if (classifiedTime > newestTime) {
      newestTime = classifiedTime;
      nextSince = item.classifiedAt;
    }
  }
  const counts: Record<string, number> = {};
  for (const item of finalItems) {
    const tag = item.tags[0] ?? "unknown";
    counts[tag] = (counts[tag] ?? 0) + 1;
  }

  return NextResponse.json({
    meta: {
      window: { from: from.toISOString(), to: to.toISOString(), basis },
      totalItems: finalItems.length,
      counts,
      nextSince,
      truncated,
      filters: {
        tags: tags.length > 0 ? tags : null,
        keywords: keywords.length > 0 ? keywords : null,
        since: since ? since.toISOString() : null,
      },
    },
    items: finalItems,
  });
}
