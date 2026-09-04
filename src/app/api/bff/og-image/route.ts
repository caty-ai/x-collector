import { NextRequest, NextResponse } from "next/server";

import { isNewspaperPublic } from "@/lib/auth/public-newspaper";
import {
  EditionUrlLoadError,
  isUrlInEdition,
  loadEditionUrlSet,
  normalizeUrlForMatch,
} from "@/lib/bff/og-image-guard";
import { resolveOgImage } from "@/lib/bff/og-image";
import { consumePublicThrottle } from "@/lib/bff/public-throttle";
import { resolveBffReaderAuth } from "@/lib/bff/reader-auth";
import { resolveNewsletterApiKey, resolveRailwayApiBaseUrl } from "@/lib/bff/upstream";
import { isAcceptablePublicDate } from "@/lib/reader/edition-nav";

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

function editionDates(req: NextRequest): Array<string | null> {
  const dates: string[] = [];
  const queryDate = req.nextUrl.searchParams.get("date");
  if (queryDate && isAcceptablePublicDate(queryDate)) dates.push(queryDate);

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererDate = refererUrl.searchParams.get("date");
      if (
        refererUrl.origin === req.nextUrl.origin &&
        refererDate &&
        isAcceptablePublicDate(refererDate) &&
        !dates.includes(refererDate)
      ) {
        dates.push(refererDate);
      }
    } catch {
      // An invalid or cross-origin Referer contributes no edition date.
    }
  }
  return [...dates, null];
}

export async function GET(req: NextRequest) {
  const url = parseTargetUrl(req.nextUrl.searchParams.get("url"));
  if (!url) {
    return NextResponse.json({ error: "Missing or invalid url" }, { status: 400 });
  }

  const auth = await resolveBffReaderAuth(req);
  if (auth.mode === "denied") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let resolverUrl = url;
  if (isNewspaperPublic()) {
    const canonicalUrl = normalizeUrlForMatch(url);
    if (!canonicalUrl) {
      return NextResponse.json({ error: "Missing or invalid url" }, { status: 400 });
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
    if (auth.mode === "public" && !consumePublicThrottle(req, "og-image", 120)) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    const dates = editionDates(req);
    try {
      const results = await Promise.allSettled(
        dates.map((date) =>
          loadEditionUrlSet(date, { baseUrl: railwayBaseUrl, apiKey: upstreamBearer }),
        ),
      );
      const sets = results
        .filter((result): result is PromiseFulfilledResult<Set<string>> => result.status === "fulfilled")
        .map((result) => result.value);
      if (!sets.some((set) => isUrlInEdition(canonicalUrl, set))) {
        const failed = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (failed) throw failed.reason;
        console.warn(
          `[og-image] deny reason=not_in_edition date=${dates.filter(Boolean).join(",") || "latest"} host=${new URL(canonicalUrl).hostname}`,
        );
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } catch (error) {
      if (error instanceof EditionUrlLoadError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      return NextResponse.json(
        { error: "Failed to load edition for og-image guard" },
        { status: 502 },
      );
    }
    resolverUrl = canonicalUrl;
  }

  const result = await resolveOgImage(resolverUrl);
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
