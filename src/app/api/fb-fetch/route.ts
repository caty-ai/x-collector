import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { fetchSourcePosts } from "../../../collector/facebook";
import { requireStudioSession } from "@/lib/auth/require-session";

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { sourceId, maxPages } = await req.json();

  const where: any = { active: true };
  if (typeof sourceId === "number") {
    where.id = sourceId;
  }

  const sources = await prisma.fbSource.findMany({ where });
  if (sources.length === 0) {
    return NextResponse.json({ error: "No matching active sources" }, { status: 404 });
  }

  if (!process.env.SCRAPECREATORS_API_KEY) {
    return NextResponse.json({ error: "SCRAPECREATORS_API_KEY not set" }, { status: 500 });
  }

  const results: any[] = [];

  for (const source of sources) {
    try {
      const result = await fetchSourcePosts(
        source,
        typeof maxPages === "number" ? maxPages : undefined
      );
      results.push({
        name: source.name,
        upserted: result.upserted,
        pages: result.pages,
        error: result.error || undefined,
      });
    } catch (err: any) {
      results.push({ name: source.name, error: err.message, upserted: 0, pages: 0 });
    }
  }

  return NextResponse.json({ results });
}
