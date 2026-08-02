import { NextResponse } from "next/server";
import { collectOpenRouterModels } from "../../../collector/openrouter";
import { requireStudioSession } from "@/lib/auth/require-session";

export async function POST() {
  const denied = await requireStudioSession();
  if (denied) return denied;
  try {
    const result = await collectOpenRouterModels();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
