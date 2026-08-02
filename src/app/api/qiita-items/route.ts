import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireStudioSession } from "@/lib/auth/require-session";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const sourceId = searchParams.get("sourceId");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);
  const skip = (page - 1) * limit;

  const where: any = {};
  if (sourceId) {
    where.sourceId = parseInt(sourceId, 10);
  }

  const [items, total] = await Promise.all([
    prisma.qiitaItem.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      skip,
      take: limit,
      include: {
        source: { select: { name: true, tag: true } },
      },
    }),
    prisma.qiitaItem.count({ where }),
  ]);

  return NextResponse.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}