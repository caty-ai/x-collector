import { buildNewsletterLatestPublicUpstreamUrl } from "@/lib/bff/upstream";

const NON_EMPTY_TTL_MS = 10 * 60 * 1000;
const EMPTY_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 256;

type CacheEntry = { urls: Set<string>; expiresAt: number };
type LoadedEditionUrls = { urls: Set<string>; cacheable: boolean };
type EditionUrlSetDeps = {
  baseUrl: URL;
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Set<string>>>();

export class EditionUrlLoadError extends Error {
  constructor(
    readonly status: 500 | 502,
    message: string,
  ) {
    super(message);
    this.name = "EditionUrlLoadError";
  }
}

export function normalizeUrlForMatch(raw: string): string | null {
  const stripped = raw
    .trim()
    .replace(/^[<>"']+|[<>"']+$/g, "")
    .replace(/[)\].,;:!?\>"'）」』】、。]+$/g, "");

  try {
    const url = new URL(stripped);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    return url.toString().replace(/\/(?=\?|$)/, "");
  } catch {
    return null;
  }
}

export function extractEditionUrls(markdown: string): Set<string> {
  const urls = new Set<string>();

  for (const match of markdown.matchAll(/\]\((https?:\/\/[^\s)]+)\)/gi)) {
    const normalized = normalizeUrlForMatch(match[1]);
    if (normalized) urls.add(normalized);
  }

  for (const match of markdown.matchAll(/https?:\/\/[^\s)<）]+/gi)) {
    const normalized = normalizeUrlForMatch(match[0]);
    if (normalized) urls.add(normalized);
  }
  return urls;
}

export function isUrlInEdition(target: string, urls: Set<string>): boolean {
  const normalized = normalizeUrlForMatch(target);
  return normalized !== null && urls.has(normalized);
}

function setCached(key: string, urls: Set<string>, nowMs: number): void {
  cache.set(key, {
    urls,
    expiresAt: nowMs + (urls.size === 0 ? EMPTY_TTL_MS : NON_EMPTY_TTL_MS),
  });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function fetchEditionUrlSet(
  date: string | null,
  deps: EditionUrlSetDeps,
): Promise<LoadedEditionUrls> {
  const upstreamUrl = buildNewsletterLatestPublicUpstreamUrl(deps.baseUrl, {
    date: date ?? undefined,
    format: "markdown",
  });
  let response: Response;

  try {
    response = await (deps.fetchImpl ?? fetch)(upstreamUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
        Accept: "text/markdown",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new EditionUrlLoadError(502, "Failed to load edition for og-image guard");
  }

  if (response.status === 404) return { urls: new Set(), cacheable: true };
  if (response.status === 401 || response.status === 403) {
    throw new EditionUrlLoadError(
      500,
      "BFF misconfigured: upstream rejected the newsletter API key",
    );
  }
  if (!response.ok) {
    throw new EditionUrlLoadError(502, "Failed to load edition for og-image guard");
  }
  if (response.headers.get("x-edition-status") !== "published") {
    return { urls: new Set(), cacheable: true };
  }

  return { urls: extractEditionUrls(await response.text()), cacheable: false };
}

export function loadEditionUrlSet(
  date: string | null,
  deps: EditionUrlSetDeps,
): Promise<Set<string>> {
  const key = date ?? "latest";
  const nowMs = (deps.now ?? Date.now)();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > nowMs) return Promise.resolve(cached.urls);
  if (cached) cache.delete(key);

  const existing = inFlight.get(key);
  if (existing) return existing;

  const pending = fetchEditionUrlSet(date, deps)
    .then((loaded) => {
      if (loaded.cacheable || loaded.urls.size > 0) {
        setCached(key, loaded.urls, (deps.now ?? Date.now)());
      }
      return loaded.urls;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, pending);
  return pending;
}

export function __resetEditionUrlCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
