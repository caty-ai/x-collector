import { NextRequest, NextResponse } from "next/server";

import { consumePublicThrottle } from "@/lib/bff/public-throttle";
import { resolveBffReaderAuth } from "@/lib/bff/reader-auth";
import {
  buildNewsletterLatestUpstreamUrl,
  buildNewsletterLatestPublicUpstreamUrl,
  type NewsletterLatestPublicParams,
  resolveNewsletterApiKey,
  resolveRailwayApiBaseUrl,
} from "@/lib/bff/upstream";
import { isAcceptablePublicDate } from "@/lib/reader/edition-nav";

const NEWSLETTER_LATEST_UPSTREAM = "/api/newsletter-editions/latest";

function publicNotFound(): Response {
  return new Response('{"error":"Edition not found"}', {
    status: 404,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-bff-upstream": NEWSLETTER_LATEST_UPSTREAM,
    },
  });
}

function publicParams(sourceUrl: URL): NewsletterLatestPublicParams | null {
  const params: NewsletterLatestPublicParams = {};
  const date = sourceUrl.searchParams.get("date");
  if (date !== null) {
    if (!isAcceptablePublicDate(date)) return null;
    params.date = date;
  }

  const format = sourceUrl.searchParams.get("format");
  if (format !== null) {
    if (format !== "markdown" && format !== "json") return null;
    params.format = format;
  }

  for (const name of ["includeContent", "includeItems"] as const) {
    const value = sourceUrl.searchParams.get(name);
    if (value !== null) {
      if (value !== "0" && value !== "1") return null;
      params[name] = value;
    }
  }
  return params;
}

// Browser -> /api/bff/newsletter-editions/latest (session) -> Railway /api/newsletter-editions/latest (Bearer)
export async function GET(req: NextRequest) {
  const auth = await resolveBffReaderAuth(req);
  if (auth.mode === "denied") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const anonymousParams = auth.mode === "public" ? publicParams(req.nextUrl) : null;
  if (auth.mode === "public" && !anonymousParams) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
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

  if (
    auth.mode === "public" &&
    !consumePublicThrottle(req, "newsletter", 240)
  ) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const upstreamUrl =
    auth.mode === "public"
      ? buildNewsletterLatestPublicUpstreamUrl(railwayBaseUrl, anonymousParams ?? {})
      : buildNewsletterLatestUpstreamUrl(railwayBaseUrl, req.nextUrl);
  const format = auth.mode === "public" ? anonymousParams?.format : req.nextUrl.searchParams.get("format");

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
    if (auth.mode === "public" && upstreamResponse.status === 404) {
      return publicNotFound();
    }
    if (auth.mode === "public" && upstreamResponse.ok) {
      const isPublished =
        format === "markdown"
          ? upstreamResponse.headers.get("x-edition-status") === "published"
          : (() => {
              try {
                const parsed = JSON.parse(payload) as { edition?: { status?: unknown } };
                return parsed.edition?.status === "published";
              } catch {
                return false;
              }
            })();
      if (!isPublished) {
        return publicNotFound();
      }
    }
    return new NextResponse(payload, {
      status: upstreamResponse.status,
      headers: {
        "content-type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8",
        "x-bff-upstream": NEWSLETTER_LATEST_UPSTREAM,
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
