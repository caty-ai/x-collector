import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { extractCandidates, fetchCandidateProfiles, promoteCandidates } from "../../../collector/discover";
import { evaluatePendingCandidates } from "../../../collector/evaluate-candidates";
import { requireStudioSession } from "@/lib/auth/require-session";

const prisma = new PrismaClient();

function cappedEvaluateLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(Math.floor(parsed), 20);
}

export async function POST(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { phase, limit, dryRun } = await req.json().catch(() => ({ phase: "extract", limit: 20 }));

  try {
    let result: any;
    switch (phase) {
      case "extract":
        result = await extractCandidates();
        return NextResponse.json({ ok: true, phase: "extract", candidatesFound: result });
      case "fetch":
        result = await fetchCandidateProfiles(limit || 20);
        return NextResponse.json({ ok: true, phase: "fetch", profilesFetched: result });
      case "evaluate":
        result = await evaluatePendingCandidates(prisma, {
          limit: cappedEvaluateLimit(limit),
          dryRun: Boolean(dryRun),
        });
        return NextResponse.json({ ok: true, phase: "evaluate", evaluation: result });
      case "promote":
        result = await promoteCandidates();
        return NextResponse.json({ ok: true, phase: "promote", promoted: result });
      default:
        return NextResponse.json({ error: "Invalid phase. Use: extract, fetch, evaluate, promote" }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
