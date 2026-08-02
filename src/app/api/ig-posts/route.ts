import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireStudioSession } from "@/lib/auth/require-session";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const sourceId = searchParams.get("sourceId");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 500);

  const where: any = {};
  if (sourceId) where.sourceId = parseInt(sourceId, 10);

  const posts = await prisma.igPost.findMany({
    where,
    orderBy: { publishedAt: "desc" },
    take: limit,
    include: { source: { select: { name: true, handle: true } } },
  });

  return NextResponse.json({ posts, count: posts.length });
}
