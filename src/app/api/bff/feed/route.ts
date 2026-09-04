import { NextRequest, NextResponse } from "next/server";

import { resolveAllowlistedSession } from "@/lib/bff/session-auth";
import { buildFeedUpstreamUrl, resolveFeedApiKey, resolveRailwayApiBaseUrl } from "@/lib/bff/upstream";

// BFF pattern stub for issue #11:
// Browser -> /api/bff/feed (session required) -> Railway /api/feed (Bearer injected server-side)
export async function GET(req: NextRequest) {
  const session = await resolveAllowlistedSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const railwayBaseUrl = resolveRailwayApiBaseUrl();
  if (!railwayBaseUrl) {
    return NextResponse.json(
      { error: "BFF misconfigured: set RAILWAY_API_BASE_URL" },
      { status: 500 },
    );
  }

  const feedApiKey = resolveFeedApiKey();
  if (!feedApiKey) {
    return NextResponse.json({ error: "BFF misconfigured: set FEED_API_KEY" }, { status: 500 });
  }

  const upstreamUrl = buildFeedUpstreamUrl(railwayBaseUrl, req.nextUrl);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${feedApiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    const payload = await upstreamResponse.text();
    return new NextResponse(payload, {
      status: upstreamResponse.status,
      headers: {
        "content-type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8",
        "x-bff-upstream": "/api/feed",
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
