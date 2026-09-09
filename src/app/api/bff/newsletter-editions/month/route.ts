import { NextRequest, NextResponse } from "next/server";

import { consumePublicThrottle } from "@/lib/bff/public-throttle";
import { resolveBffReaderAuth } from "@/lib/bff/reader-auth";
import {
  buildNewsletterMonthUpstreamUrl,
  resolveNewsletterApiKey,
  resolveRailwayApiBaseUrl,
  type NewsletterMonthParams,
} from "@/lib/bff/upstream";
import { parseMonthParam, projectPublicMonthSummary } from "@/lib/pipeline/edition-public";
import { isAcceptablePublicMonth } from "@/lib/reader/edition-nav";

const NEWSLETTER_MONTH_UPSTREAM = "/api/newsletter-editions/month";

function monthEndpointMissing(): Response {
  return new Response(
    '{"error":"Month summary not found","code":"UPSTREAM_ROUTE_MISSING"}',
    {
      status: 404,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-bff-upstream": NEWSLETTER_MONTH_UPSTREAM,
        "x-bff-month-fallback": "upstream-route-missing",
      },
    },
  );
}

function publicJson(body: object, status: number, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-bff-upstream": NEWSLETTER_MONTH_UPSTREAM,
      ...extraHeaders,
    },
  });
}

function getMonthParams(req: NextRequest, isPublic: boolean): NewsletterMonthParams | null {
  const month = req.nextUrl.searchParams.get("month");
  if (!parseMonthParam(month)) return null;
  if (isPublic) {
    return isAcceptablePublicMonth(month!) ? { month: month!, status: "published" } : null;
  }
  return {
    month: month!,
    ...(req.nextUrl.searchParams.get("status") === "published"
      ? { status: "published" as const }
      : {}),
  };
}

export async function GET(req: NextRequest) {
  const auth = await resolveBffReaderAuth(req);
  if (auth.mode === "denied") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = getMonthParams(req, auth.mode === "public");
  if (!params) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const railwayBaseUrl = resolveRailwayApiBaseUrl();
  if (!railwayBaseUrl) {
    return NextResponse.json(
      { error: "BFF misconfigured: set RAILWAY_API_BASE_URL" },
      { status: 500 },
    );
  }

  const upstreamBearer = resolveNewsletterApiKey();
  if (!upstreamBearer) {
    return NextResponse.json(
      { error: "BFF misconfigured: set NEWSLETTER_API_KEY (or DIGEST_API_KEY / FEED_API_KEY)" },
      { status: 500 },
    );
  }

  if (
    auth.mode === "public" &&
    !consumePublicThrottle(req, "newsletter-month", 60)
  ) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const upstreamUrl = buildNewsletterMonthUpstreamUrl(railwayBaseUrl, params);
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${upstreamBearer}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await upstreamResponse.text();

    if (upstreamResponse.status === 404) {
      console.warn(
        "[bff-newsletter-month] upstream month route missing (404) — calendar falls back to per-day requests",
      );
      return monthEndpointMissing();
    }

    if (auth.mode === "public" && !upstreamResponse.ok) {
      console.warn(
        `[bff-newsletter-month] upstream ${upstreamResponse.status} normalised for anonymous reader`,
      );
      if (upstreamResponse.status === 429) {
        return publicJson({ error: "Too many requests" }, 429, { "Retry-After": "60" });
      }
      return publicJson({ error: "Upstream error" }, 502);
    }

    if (auth.mode === "public") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return publicJson({ error: "Bad upstream response" }, 502);
      }

      const rawDays =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? (parsed as { days?: unknown }).days
          : undefined;
      if (Array.isArray(rawDays) && rawDays.length > 31) {
        return publicJson({ error: "Bad upstream response" }, 502);
      }

      const projected = projectPublicMonthSummary(parsed, params.month);
      if (!projected) {
        return publicJson({ error: "Bad upstream response" }, 502);
      }
      return publicJson(projected, 200);
    }

    return new NextResponse(payload, {
      status: upstreamResponse.status,
      headers: {
        "content-type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8",
        "x-bff-upstream": NEWSLETTER_MONTH_UPSTREAM,
      },
    });
  } catch (error) {
    if (auth.mode === "public") {
      return publicJson({ error: "Upstream error" }, 502);
    }
    return NextResponse.json(
      {
        error: "Failed to reach Railway API from BFF route",
        detail: error instanceof Error ? error.message : "unknown",
      },
      { status: 502 },
    );
  }
}
