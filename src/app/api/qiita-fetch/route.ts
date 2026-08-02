import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { fetchSourceItems } from "../../../collector/qiita";
import { requireStudioSession } from "@/lib/auth/require-session";

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { sourceId, maxItems } = await req.json();

  const where: any = { active: true };
  if (typeof sourceId === "number") {
    where.id = sourceId;
  }

  const sources = await prisma.qiitaSource.findMany({ where });
  if (sources.length === 0) {
    return NextResponse.json({ error: "No matching active sources" }, { status: 404 });
  }

  const results: any[] = [];

  for (const source of sources) {
    try {
      const result = await fetchSourceItems(
        source,
        typeof maxItems === "number" ? maxItems : undefined
      );
      results.push({
        name: source.name,
        upserted: result.upserted,
        error: result.error || undefined,
      });
    } catch (err: any) {
      results.push({ name: source.name, error: err.message, upserted: 0 });
    }
  }

  return NextResponse.json({ results });
}