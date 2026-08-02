import { NextResponse } from "next/server";
import { collectInstagram } from "@/collector/instagram";
import { requireStudioSession } from "@/lib/auth/require-session";

export const maxDuration = 120;

export async function POST() {
  const denied = await requireStudioSession();
  if (denied) return denied;
  try {
    await collectInstagram();
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
