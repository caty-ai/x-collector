import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { denyUnlessNewsletterBearer } from "@/lib/auth/newsletter-api-key";
import { parseEditionStatusParam, parseMonthParam } from "@/lib/pipeline/edition-public";

const prisma = new PrismaClient();

function jstIsoDate(date: Date): string {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const denied = denyUnlessNewsletterBearer(req, { logTag: "newsletter-month-api" });
  if (denied) return denied;

  const monthRange = parseMonthParam(req.nextUrl.searchParams.get("month"));
  if (!monthRange) {
    return NextResponse.json({ error: "Invalid month format. Use YYYY-MM" }, { status: 400 });
  }

  const statusResult = parseEditionStatusParam(req.nextUrl.searchParams.get("status"));
  if (!statusResult.ok) {
    return NextResponse.json(
      { error: "Invalid status. Use status=published" },
      { status: 400 },
    );
  }

  const rows = await prisma.newsletterEdition.findMany({
    where: {
      editionDate: { gte: monthRange.start, lte: monthRange.end },
      ...(statusResult.status === "published" ? { status: "published" } : {}),
    },
    select: {
      editionDate: true,
      status: true,
      updatedAt: true,
      _count: { select: { bindings: true } },
    },
    orderBy: [{ editionDate: "asc" }, { updatedAt: "desc" }],
  });

  const rowByDate = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const date = jstIsoDate(row.editionDate);
    const kept = rowByDate.get(date);
    // Mixed UTC-midnight and JST-midnight storage shapes can map to the same JST label.
    if (kept) {
      console.warn(`[newsletter-month-api] multiple editions map to JST date ${date}`);
    }
    if (!kept || row.updatedAt > kept.updatedAt) {
      rowByDate.set(date, row);
    }
  }

  const days = [...rowByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, row]) => ({
      date,
      status: row.status,
      bindingsCount: row._count.bindings,
    }));

  return NextResponse.json({
    meta: {
      month: monthRange.month,
      timeZoneForDateParam: "Asia/Tokyo",
      status: statusResult.status,
    },
    days,
  });
}
