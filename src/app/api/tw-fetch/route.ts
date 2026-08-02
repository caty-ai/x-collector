import { NextResponse } from "next/server";
import { collect } from "../../../collector";
import { requireStudioSession } from "@/lib/auth/require-session";

export async function POST() {
  const denied = await requireStudioSession();
  if (denied) return denied;
  try {
    await collect();
    return NextResponse.json({ ok: true, platform: "twitter" });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
