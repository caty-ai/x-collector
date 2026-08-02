import { Prisma, PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireStudioSession } from "@/lib/auth/require-session";
import { restoreSource } from "@/collector/lifecycle";

const prisma = new PrismaClient();
const DEFAULT_CANDIDATE_TAKE = 200;
const MAX_CANDIDATE_TAKE = 200;
const WEEKLY_REVIEW_SOURCE_EVENT_TAKE = 25;

const candidateListSelect = {
  id: true,
  handle: true,
  mentionCount: true,
  mentionedBy: true,
  profileFetched: true,
  displayName: true,
  description: true,
  followersCount: true,
  tweetCount: true,
  aiScore: true,
  aiReason: true,
  aiEvaluatedAt: true,
  status: true,
  createdAt: true,
} satisfies Prisma.CandidateAccountSelect;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatEventReason(event: { reason: string; metricsSnapshot: unknown }): string {
  const snapshot = getObject(event.metricsSnapshot);
  const lifecycle = getObject(snapshot?.lifecycle);
  const keys = Array.isArray(lifecycle?.conditionKeys)
    ? lifecycle.conditionKeys.filter((key): key is string => typeof key === "string")
    : [];
  const noiseRate = typeof lifecycle?.noiseRate === "number" ? lifecycle.noiseRate : null;
  const priorityScore = typeof lifecycle?.priorityScore === "number" ? lifecycle.priorityScore : null;
  const trustScore = typeof snapshot?.trustScore === "number" ? snapshot.trustScore : null;

  const details = [
    keys.length > 0 ? keys.join(", ") : event.reason,
    noiseRate !== null ? `noise ${(noiseRate * 100).toFixed(0)}%` : null,
    priorityScore !== null ? `priority ${priorityScore.toFixed(2)}` : null,
    trustScore !== null ? `trust ${trustScore}` : null,
  ].filter((value): value is string => Boolean(value));

  return details.join(" · ");
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parseTake(value: string | null): number {
  const parsed = parsePositiveInt(value);
  if (parsed === null || parsed === 0) return DEFAULT_CANDIDATE_TAKE;
  return Math.min(parsed, MAX_CANDIDATE_TAKE);
}

async function weeklyReview() {
  const candidates = await prisma.candidateAccount.findMany({
    where: { status: "needs_review" },
    orderBy: [{ aiScore: "desc" }, { mentionCount: "desc" }],
    select: candidateListSelect,
    take: 10,
  });

  const demoteCutoff = daysAgo(14);
  const deactivateCutoff = daysAgo(30);
  const recentDeactivateIds = Array.from(
    new Set(
      (
        await prisma.sourceDemotionEvent.findMany({
          where: { action: "deactivate", at: { gte: deactivateCutoff } },
          orderBy: [{ at: "desc" }, { id: "desc" }],
          select: { sourceId: true },
          take: WEEKLY_REVIEW_SOURCE_EVENT_TAKE,
        })
      ).map((event) => event.sourceId),
    ),
  );
  const deactivatedSources = await prisma.source.findMany({
    where: {
      id: { in: recentDeactivateIds.length > 0 ? recentDeactivateIds : [-1] },
      type: "discovered",
      active: false,
      deactivatedAt: { gte: deactivateCutoff },
    },
    include: {
      demotionEvents: {
        where: { action: "deactivate" },
        orderBy: { at: "desc" },
        take: 1,
      },
    },
    orderBy: { deactivatedAt: "desc" },
    take: WEEKLY_REVIEW_SOURCE_EVENT_TAKE,
  });

  const recentDemoteIds = Array.from(
    new Set(
      (
        await prisma.sourceDemotionEvent.findMany({
          where: { action: "demote", at: { gte: demoteCutoff } },
          orderBy: [{ at: "desc" }, { id: "desc" }],
          select: { sourceId: true },
          take: WEEKLY_REVIEW_SOURCE_EVENT_TAKE,
        })
      ).map((event) => event.sourceId),
    ),
  );
  const activeSourcesWithRecentEvents = await prisma.source.findMany({
    where: {
      id: { in: recentDemoteIds.length > 0 ? recentDemoteIds : [-1] },
      type: "discovered",
      active: true,
      demotionEvents: { some: { at: { gte: demoteCutoff } } },
    },
    include: {
      demotionEvents: {
        orderBy: { at: "desc" },
        take: 1,
      },
    },
    orderBy: { id: "asc" },
    take: WEEKLY_REVIEW_SOURCE_EVENT_TAKE,
  });

  const unhealthySources = [
    ...deactivatedSources.map((source) => {
      const event = source.demotionEvents[0];
      return {
        source,
        event,
        sortAt: source.deactivatedAt || event?.at || new Date(0),
      };
    }),
    ...activeSourcesWithRecentEvents
      .filter((source) => {
        const event = source.demotionEvents[0];
        return event?.action === "demote" && event.at >= demoteCutoff;
      })
      .map((source) => {
        const event = source.demotionEvents[0];
        return {
          source,
          event,
          sortAt: event?.at || new Date(0),
        };
      }),
  ]
    .sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime())
    .slice(0, 5)
    .map(({ source, event }) => ({
      id: source.id,
      handle: source.handle,
      active: source.active,
      trustScore: source.trustScore,
      trustLabel: source.trustLabel,
      deactivatedAt: source.deactivatedAt,
      deactivationReason: source.deactivationReason,
      cooldownUntil: source.cooldownUntil,
      reason: event ? formatEventReason(event) : source.deactivationReason || "lifecycle:deactivate",
      latestEvent: {
        action: event?.action || "deactivate",
        reason: event?.reason || source.deactivationReason || "lifecycle:deactivate",
        at: event?.at || source.deactivatedAt || new Date(0),
      },
    }));

  return { candidates, unhealthySources };
}

export async function GET(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const view = req.nextUrl.searchParams.get("view") || undefined;
  const status = req.nextUrl.searchParams.get("status") || undefined;

  if (view === "weekly") {
    const weekly = await weeklyReview();
    return NextResponse.json({ ...weekly, stats: await getStats() });
  }

  const where: Prisma.CandidateAccountWhereInput = {};
  if (status) where.status = status;
  const take = parseTake(req.nextUrl.searchParams.get("take"));
  const cursor = parsePositiveInt(req.nextUrl.searchParams.get("cursor"));
  const offset = parsePositiveInt(req.nextUrl.searchParams.get("offset")) ?? 0;
  // Score-first ordering needs an offset token rather than a Prisma PK cursor.
  const pageOffset = cursor ?? offset;

  const candidates = await prisma.candidateAccount.findMany({
    where,
    orderBy: [{ aiScore: "desc" }, { mentionCount: "desc" }, { id: "asc" }],
    select: candidateListSelect,
    skip: pageOffset,
    take: take + 1,
  });

  const hasMore = candidates.length > take;
  const pageCandidates = hasMore ? candidates.slice(0, take) : candidates;
  const nextOffset = hasMore ? pageOffset + pageCandidates.length : null;

  return NextResponse.json({
    candidates: pageCandidates,
    stats: await getStats(),
    meta: {
      take,
      offset: pageOffset,
      cursor: cursor !== null ? String(cursor) : null,
      nextOffset,
      nextCursor: nextOffset !== null ? String(nextOffset) : null,
      truncated: hasMore,
    },
  });
}

async function getStats() {
  return {
    total: await prisma.candidateAccount.count(),
    pending: await prisma.candidateAccount.count({ where: { status: "pending" } }),
    watch: await prisma.candidateAccount.count({ where: { status: "watch" } }),
    needs_review: await prisma.candidateAccount.count({ where: { status: "needs_review" } }),
    approved: await prisma.candidateAccount.count({ where: { status: "approved" } }),
    rejected: await prisma.candidateAccount.count({ where: { status: "rejected" } }),
    promoted: await prisma.candidateAccount.count({ where: { status: "promoted" } }),
  };
}

export async function PATCH(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const body = await req.json();
  const { id, status, sourceId, action } = body;

  if (action === "restore") {
    if (typeof sourceId !== "number") {
      return NextResponse.json({ error: "sourceId required" }, { status: 400 });
    }

    try {
      const source = await restoreSource(prisma, {
        sourceId,
        reason: "human:restore",
        actor: "weekly-review",
        logger: console,
      });
      return NextResponse.json({ source });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: message }, { status: statusCode });
    }
  }

  if (typeof id !== "number" || !["approved", "rejected", "pending"].includes(status)) {
    return NextResponse.json({ error: "id and valid status required" }, { status: 400 });
  }

  const candidate = await prisma.candidateAccount.update({
    where: { id },
    data: { status },
  });
  return NextResponse.json({ candidate });
}
