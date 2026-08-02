import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth/options";
import { SHARED_COOKIE_NAME, verifySharedCookie } from "@/lib/auth/shared-newspaper";
import {
  buildNewsletterLatestUpstreamUrl,
  resolveNewsletterApiKey,
  resolveRailwayApiBaseUrl,
} from "@/lib/bff/upstream";

// Browser -> /api/bff/newsletter-editions/latest (session) -> Railway /api/newsletter-editions/latest (Bearer)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const hasSharedAccess = await verifySharedCookie(req.cookies.get(SHARED_COOKIE_NAME)?.value);
  if (!session && !hasSharedAccess) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const railwayBaseUrl = resolveRailwayApiBaseUrl();
  if (!railwayBaseUrl) {
    return NextResponse.json(
      { error: "BFF misconfigured: set RAILWAY_API_BASE_URL" },
      { status: 500 },
    );
  }

  const newsletterApiKey = resolveNewsletterApiKey();
  if (!newsletterApiKey) {
    return NextResponse.json(
      { error: "BFF misconfigured: set NEWSLETTER_API_KEY (or DIGEST_API_KEY / FEED_API_KEY)" },
      { status: 500 },
    );
  }

  const upstreamUrl = buildNewsletterLatestUpstreamUrl(railwayBaseUrl, req.nextUrl);
  const format = req.nextUrl.searchParams.get("format");

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${newsletterApiKey}`,
        Accept: format === "markdown" ? "text/markdown" : "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    const payload = await upstreamResponse.text();
    return new NextResponse(payload, {
      status: upstreamResponse.status,
      headers: {
        "content-type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8",
        "x-bff-upstream": "/api/newsletter-editions/latest",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to reach Railway API from BFF route",
        detail: error instanceof Error ? error.message : "unknown",
      },
      { status: 502 },
    );
  }
}
