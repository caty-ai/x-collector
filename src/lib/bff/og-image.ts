import { createSemaphore } from "./semaphore";
import { UA_CONTACT, userAgent } from "../branding";
import { isSafePublicHttpUrl, safeFetchText } from "../net/safe-fetch";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2000;
const TRANSIENT_CACHE_TTL_MS = 60_000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 256 * 1024;
const TOTAL_TIMEOUT_MS = 5000;

type CacheEntry = {
  expiresAt: number;
  imageUrl: string | null;
};

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

export type OgImageResult =
  | { kind: "found"; url: string }
  | { kind: "none" }
  | { kind: "transient" };

type ResolveOptions = { signal?: AbortSignal };
type ArticleResolveOptions = ResolveOptions & { budgetMs?: number };

export async function fetchOgImage(targetUrl: string, options: ResolveOptions = {}): Promise<OgImageResult> {
  let response;
  try {
    response = await safeFetchText(targetUrl, {
      method: "GET",
      timeoutMs: TOTAL_TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      maxBodyBytes: MAX_BODY_BYTES,
      signal: options.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en",
        "User-Agent": buildUserAgent(),
      },
    });
  } catch {
    return { kind: "transient" };
  }
  if (response.status >= 500 || response.status === 408 || response.status === 429) {
    return { kind: "transient" };
  }
  if (response.status < 200 || response.status >= 300 ||
      !String(response.headers["content-type"] || "").toLowerCase().includes("text/html")) {
    return { kind: "none" };
  }
  try {
    const image = extractMetaImage(response.body);
    if (!image) return { kind: "none" };
    const url = new URL(image, response.url);
    return isSafePublicHttpUrl(url) ? { kind: "found", url: url.toString() } : { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}

export function createOgImageResolver(deps: {
  now?: () => number;
  fetchOgImage?: (url: string, options: ResolveOptions) => Promise<OgImageResult>;
} = {}) {
  const now = deps.now ?? Date.now;
  const fetchImage = deps.fetchOgImage ?? fetchOgImage;
  // This instance is independent of the public-edition loader admission control.
  const semaphore = createSemaphore(4, 16);
  const cache = new Map<string, CacheEntry>();
  type Flight = {
    controller: AbortController;
    callers: number;
    settled: boolean;
    fetching: boolean;
    promise: Promise<string | null>;
  };
  const inFlight = new Map<string, Flight>();

  function start(targetUrl: string, article: boolean, flightKey: string): Flight {
    const entry: Flight = {
      controller: new AbortController(), callers: 0, settled: false, fetching: false,
      promise: Promise.resolve(null),
    };
    entry.promise = (async () => {
      let release: (() => void) | undefined;
      try {
        if (article) release = await semaphore.acquire(entry.controller.signal);
        if (entry.controller.signal.aborted) return null;
        entry.fetching = true;
        let result: OgImageResult;
        try {
          result = await fetchImage(targetUrl, { signal: entry.controller.signal });
        } catch {
          result = { kind: "transient" };
        }
        const imageUrl = result.kind === "found" ? result.url : null;
        if (inFlight.get(flightKey) !== entry) return imageUrl;
        cache.delete(targetUrl);
        cache.set(targetUrl, {
          imageUrl,
          expiresAt: now() + (result.kind === "transient" ? TRANSIENT_CACHE_TTL_MS : CACHE_TTL_MS),
        });
        while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
        return imageUrl;
      } catch {
        // Admission failures never poison the URL cache.
        return null;
      } finally {
        // An expired caller can return before the fetch settles; the permit cannot.
        release?.();
        entry.settled = true;
        if (inFlight.get(flightKey) === entry) inFlight.delete(flightKey);
      }
    })();
    inFlight.set(flightKey, entry);
    return entry;
  }

  async function resolve(targetUrl: string, signal: AbortSignal | undefined, article: boolean): Promise<string | null> {
    if (signal?.aborted || !isSafePublicHttpUrl(targetUrl)) return null;
    const cached = cache.get(targetUrl);
    if (cached && cached.expiresAt > now()) {
      cache.delete(targetUrl);
      cache.set(targetUrl, cached);
      return cached.imageUrl;
    }
    cache.delete(targetUrl);
    const flightKey = `${article ? "article" : "bff"}:${targetUrl}`;
    let entry = inFlight.get(flightKey);
    // Do not join queued work cancelled when its last caller detached.
    if (entry?.controller.signal.aborted) entry = undefined;
    entry ??= start(targetUrl, article, flightKey);
    entry.callers += 1;
    let removeAbort = () => {};
    let attached = true;
    const detach = () => {
      if (!attached) return;
      attached = false;
      entry.callers -= 1;
      // Once fetching, keep the permit and cache the real outcome within the upstream timeout.
      if (entry.callers === 0 && !entry.settled && !entry.fetching) entry.controller.abort();
    };
    try {
      const aborted = new Promise<null>((resolveAbort) => {
        if (!signal) return;
        const onAbort = () => { detach(); resolveAbort(null); };
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbort = () => signal.removeEventListener("abort", onAbort);
        if (signal.aborted) onAbort();
      });
      return await Promise.race([entry.promise, aborted]);
    } finally {
      removeAbort();
      detach();
    }
  }

  return {
    resolveOgImage: (url: string, options: ResolveOptions = {}) => resolve(url, options.signal, false),
    resolveArticleOgImage(url: string, options: ArticleResolveOptions = {}) {
      const budget = AbortSignal.timeout(options.budgetMs ?? 1500);
      const signal = options.signal ? AbortSignal.any([options.signal, budget]) : budget;
      return resolve(url, signal, true);
    },
  };
}

const defaultResolver = createOgImageResolver();
export const resolveOgImage = defaultResolver.resolveOgImage;
export const resolveArticleOgImage = defaultResolver.resolveArticleOgImage;
