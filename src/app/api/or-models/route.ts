import { Prisma, PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireStudioSession } from "@/lib/auth/require-session";

const prisma = new PrismaClient();
const MODEL_TAKE_CAP = 500;

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MODEL_TAKE_CAP);
}

export async function GET(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const free = req.nextUrl.searchParams.get("free");
  const q = req.nextUrl.searchParams.get("q");
  const includeRemoved = req.nextUrl.searchParams.get("includeRemoved") === "1";
  const take = parsePositiveInt(req.nextUrl.searchParams.get("take"), MODEL_TAKE_CAP);
  const eventLimit = parseInt(req.nextUrl.searchParams.get("events") || "20", 10);

  const where: Prisma.OrModelWhereInput = includeRemoved ? {} : { removedAt: null };
  if (free === "true") where.isFree = true;
  if (q) {
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  const models = await prisma.orModel.findMany({
    where,
    orderBy: [{ firstSeenAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      pricingPrompt: true,
      pricingCompletion: true,
      contextLength: true,
      isFree: true,
      firstSeenAt: true,
      lastSeenAt: true,
      removedAt: true,
      description: true,
    },
    take,
  });

  // Recent events
  const events = await prisma.orModelEvent.findMany({
    orderBy: { detectedAt: "desc" },
    take: Math.min(eventLimit, 100),
  });

  const stats = {
    total: await prisma.orModel.count({ where: { removedAt: null } }),
    free: await prisma.orModel.count({ where: { removedAt: null, isFree: true } }),
    removed: await prisma.orModel.count({ where: { NOT: { removedAt: null } } }),
    recentEvents: events.length,
  };

  return NextResponse.json({
    models,
    events,
    stats,
    meta: {
      take,
      includeRemoved,
    },
  });
}
