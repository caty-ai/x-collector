import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth/options";
import { SHARED_COOKIE_NAME, verifySharedCookie } from "@/lib/auth/shared-newspaper";
import { resolveOgImage } from "@/lib/bff/og-image";

export const runtime = "nodejs";

function parseTargetUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = parseTargetUrl(req.nextUrl.searchParams.get("url"));
  if (!url) {
    return NextResponse.json({ error: "Missing or invalid url" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const hasSharedAccess = await verifySharedCookie(req.cookies.get(SHARED_COOKIE_NAME)?.value);
  if (!session && !hasSharedAccess) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await resolveOgImage(url);
  return NextResponse.json(
    { imageUrl: result },
    {
      status: 200,
      headers: {
        "Cache-Control": "private, max-age=3600",
      },
    },
  );
}
