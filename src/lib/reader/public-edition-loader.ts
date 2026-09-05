import "server-only";

import { cache } from "react";
import { createSemaphore } from "@/lib/bff/semaphore";
import {
  buildNewsletterLatestPublicUpstreamUrl,
  resolveNewsletterApiKey,
  resolveRailwayApiBaseUrl,
} from "@/lib/bff/upstream";
import { indexArticles } from "./article-id";
import { isAcceptablePublicDate } from "./edition-nav";
import { parseNewsletterMarkdown, type ParsedNewsletter } from "./newsletter-markdown";

export class UpstreamBusyError extends Error {
  constructor() {
    super("Public edition fetch capacity exceeded");
    this.name = "UpstreamBusyError";
  }
}

export class UpstreamTransientError extends Error {
  constructor() {
    super("Public edition upstream temporarily unavailable");
    this.name = "UpstreamTransientError";
  }
}

export type LoadedEdition = {
  date: string;
  parsed: ParsedNewsletter;
  index: ReturnType<typeof indexArticles>;
  articleCount: number;
};

type LoaderDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  resolveBaseUrl?: () => URL | null;
  resolveApiKey?: () => string | null;
  parseMarkdown?: (markdown: string) => ParsedNewsletter;
  semaphore?: Pick<ReturnType<typeof createSemaphore>, "acquire">;
};
type Entry<T> = { expiresAt: number; value: T };
type Status = "not_found" | "not_published" | "error";

// Independent from the OG-image admission pool.
const loaderSemaphore = createSemaphore(4, 32);
const reactCache: typeof cache = typeof cache === "function" ? cache : (fn) => fn;

export function createPublicEditionLoader(deps: LoaderDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const resolveBaseUrl = deps.resolveBaseUrl ?? resolveRailwayApiBaseUrl;
  const resolveApiKey = deps.resolveApiKey ?? resolveNewsletterApiKey;
  const parseMarkdown = deps.parseMarkdown ?? parseNewsletterMarkdown;
  const semaphore = deps.semaphore ?? loaderSemaphore;
  const positive = new Map<string, Entry<LoadedEdition>>();
  const negative = new Map<string, Entry<Status>>();
  const inFlight = new Map<string, Promise<LoadedEdition | null>>();

  function get<T>(map: Map<string, Entry<T>>, date: string): T | undefined {
    const entry = map.get(date);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      map.delete(date);
      return undefined;
    }
    return entry.value; // Hits do not reorder insertion-order FIFO caches.
  }

  function put<T>(map: Map<string, Entry<T>>, date: string, value: T, ttl: number, limit: number) {
    map.delete(date);
    map.set(date, { value, expiresAt: now() + ttl });
    while (map.size > limit) map.delete(map.keys().next().value!);
  }

  function rememberStatus(date: string, status: Status) {
    put(negative, date, status, status === "error" ? 10_000 : 60_000, 4096);
  }

  async function fetchEdition(date: string): Promise<LoadedEdition | null> {
    const baseUrl = resolveBaseUrl();
    const apiKey = resolveApiKey();
    // Configuration failures and admission failures must never enter status cache.
    if (!baseUrl || !apiKey) throw new Error("Public edition loader is misconfigured");
    let release: () => void;
    try {
      release = await semaphore.acquire(AbortSignal.timeout(3_000));
    } catch {
      throw new UpstreamBusyError();
    }
    try {
      let response: Response;
      let payload: string;
      try {
        response = await fetchImpl(buildNewsletterLatestPublicUpstreamUrl(baseUrl, {
          date, format: "json", includeContent: "1", includeItems: "0",
        }), {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 404) {
          rememberStatus(date, "not_found");
          return null;
        }
        if (!response.ok) throw new UpstreamTransientError();
        payload = await response.text();
      } catch {
        rememberStatus(date, "error");
        throw new UpstreamTransientError();
      }

      // Mirror the public BFF predicate before reading any contentMd.
      let body: { edition?: { status?: unknown; contentMd?: unknown } } | null;
      try {
        body = JSON.parse(payload);
        if (body?.edition?.status !== "published") {
          rememberStatus(date, "not_published");
          return null;
        }
      } catch {
        rememberStatus(date, "not_published");
        return null;
      }
      const contentMd = typeof body.edition.contentMd === "string" ? body.edition.contentMd : "";
      const parsed = parseMarkdown(contentMd);
      const index = indexArticles(parsed);
      const loaded = { date, parsed, index, articleCount: index.total };
      put(positive, date, loaded, 60_000, 16);
      negative.delete(date);
      return loaded;
    } finally {
      release();
    }
  }

  async function load(date: string): Promise<LoadedEdition | null> {
    if (!isAcceptablePublicDate(date, new Date(now()))) return null;
    const cached = get(positive, date);
    if (cached !== undefined) return cached;
    const status = get(negative, date);
    if (status === "error") throw new UpstreamTransientError();
    if (status !== undefined) return null;
    const pending = inFlight.get(date);
    if (pending) return pending;
    const leader = fetchEdition(date);
    inFlight.set(date, leader);
    try {
      return await leader;
    } finally {
      inFlight.delete(date);
    }
  }

  return reactCache(load);
}

export const loadPublicEdition = createPublicEditionLoader();
