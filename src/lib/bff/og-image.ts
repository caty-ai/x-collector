import { UA_CONTACT, userAgent } from "../branding";
import { isSafePublicHttpUrl, safeFetchText } from "../net/safe-fetch";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 256 * 1024;
const TOTAL_TIMEOUT_MS = 5000;

type CacheEntry = {
  expiresAt: number;
  imageUrl: string | null;
};

const cache = new Map<string, CacheEntry>();

function getCached(targetUrl: string): string | null | undefined {
  const entry = cache.get(targetUrl);
  if (!entry) return undefined;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(targetUrl);
    return undefined;
  }

  cache.delete(targetUrl);
  cache.set(targetUrl, entry);
  return entry.imageUrl;
}

function setCached(targetUrl: string, imageUrl: string | null) {
  cache.set(targetUrl, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    imageUrl,
  });

  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function sanitizeUserAgentContact(value: string | undefined): string {
  const normalized = (value || UA_CONTACT)
    .replace(/[\r\n()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || UA_CONTACT;
}

function buildUserAgent(): string {
  const contact = sanitizeUserAgentContact(process.env.OG_FETCH_UA_CONTACT);
  return userAgent("newsletter", { contact, compatible: true });
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function parseMetaAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([^\s"'=<>`]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(tag))) {
    attributes[match[1].toLowerCase()] = decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? "");
  }

  return attributes;
}

function extractMetaImage(html: string): string | null {
  const matches: Record<string, string | undefined> = {};
  const metaPattern = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaPattern.exec(html))) {
    const attributes = parseMetaAttributes(match[0]);
    const key = (attributes.property ?? attributes.name ?? "").toLowerCase();
    const content = attributes.content?.trim();

    if (content && (key === "og:image" || key === "og:image:url" || key === "twitter:image")) {
      matches[key] ??= content;
    }
  }

  return matches["og:image"] ?? matches["og:image:url"] ?? matches["twitter:image"] ?? null;
}

async function fetchOgImage(targetUrl: string): Promise<string | null> {
  const response = await safeFetchText(targetUrl, {
    method: "GET",
    timeoutMs: TOTAL_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    maxBodyBytes: MAX_BODY_BYTES,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en",
      "User-Agent": buildUserAgent(),
    },
  });

  if (response.status < 200 || response.status >= 300) {
    return null;
  }

  const contentType = (response.headers["content-type"] || "").toString().toLowerCase();
  if (!contentType.includes("text/html")) {
    return null;
  }

  const image = extractMetaImage(response.body);
  if (!image) {
    return null;
  }

  const imageUrl = new URL(image, response.url);
  if (!isSafePublicHttpUrl(imageUrl)) {
    return null;
  }

  return imageUrl.toString();
}

export async function resolveOgImage(targetUrl: string): Promise<string | null> {
  const cached = getCached(targetUrl);
  if (cached !== undefined) {
    return cached;
  }

  let imageUrl: string | null = null;
  try {
    imageUrl = await fetchOgImage(targetUrl);
  } catch {
    imageUrl = null;
  }

  setCached(targetUrl, imageUrl);
  return imageUrl;
}
