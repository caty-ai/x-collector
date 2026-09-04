const FEED_UPSTREAM_PATH = "/api/feed";
const NEWSLETTER_LATEST_UPSTREAM_PATH = "/api/newsletter-editions/latest";

export function resolveRailwayApiBaseUrl(): URL | null {
  const raw = process.env.RAILWAY_API_BASE_URL;
  if (!raw) return null;

  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function resolveFeedApiKey(): string | null {
  return process.env.FEED_API_KEY || null;
}

export function resolveNewsletterApiKey(): string | null {
  // Fallback order per docs/api-contract-ui-v1.md section 4 note 3.
  return process.env.NEWSLETTER_API_KEY || process.env.DIGEST_API_KEY || process.env.FEED_API_KEY || null;
}

function appendSearchParams(targetUrl: URL, sourceUrl: URL) {
  sourceUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });
}

export function buildFeedUpstreamUrl(baseUrl: URL, sourceUrl: URL): URL {
  const upstreamUrl = new URL(FEED_UPSTREAM_PATH, baseUrl);
  appendSearchParams(upstreamUrl, sourceUrl);

  if (!upstreamUrl.searchParams.has("limit")) {
    upstreamUrl.searchParams.set("limit", "200");
  }

  return upstreamUrl;
}

export function buildNewsletterLatestUpstreamUrl(baseUrl: URL, sourceUrl: URL): URL {
  const upstreamUrl = new URL(NEWSLETTER_LATEST_UPSTREAM_PATH, baseUrl);
  appendSearchParams(upstreamUrl, sourceUrl);
  return upstreamUrl;
}

export type NewsletterLatestPublicParams = {
  date?: string;
  format?: "markdown" | "json";
  includeContent?: "0" | "1";
  includeItems?: "0" | "1";
};

export function buildNewsletterLatestPublicUpstreamUrl(
  baseUrl: URL,
  params: NewsletterLatestPublicParams,
): URL {
  const upstreamUrl = new URL(NEWSLETTER_LATEST_UPSTREAM_PATH, baseUrl);
  if (params.date) upstreamUrl.searchParams.set("date", params.date);
  if (params.format === "markdown") upstreamUrl.searchParams.set("format", "markdown");
  if (params.includeContent) upstreamUrl.searchParams.set("includeContent", params.includeContent);
  if (params.includeItems) upstreamUrl.searchParams.set("includeItems", params.includeItems);
  return upstreamUrl;
}
