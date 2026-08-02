import { createHash } from "crypto";
import { PipelineItem, Prisma, PrismaClient } from "@prisma/client";
import { userAgent } from "../branding";
import { SafeFetchDependencies, safeFetchText } from "../net/safe-fetch";
import { normalizeCanonicalUrl } from "./normalize";
import { sanitizeToWellFormed } from "./text-sanitize";

const DEFAULT_LIMIT = 50;
const DEFAULT_MAX_URLS_PER_ITEM = 3;
const DEFAULT_MAX_LINKS_PER_ITEM = 20;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_FETCH_CHARS = 220_000;
const DEFAULT_MAX_TEXT_CHARS = 8_000;
const DEFAULT_MAX_CLASSIFY_CONTEXT_CHARS = 1_000;
const DEFAULT_CLASSIFY_MAX_LINKS = 3;

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

const HTML_ENTITY_TABLE: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

interface StoredLinkContent {
  version?: string;
  status?: string;
  fetchedAt?: string;
  source?: string;
  url?: string;
  normalizedUrl?: string;
  urlKey?: string;
  urlHash?: string;
  httpStatus?: number;
  title?: string | null;
  description?: string | null;
  contentText?: string;
  contentLength?: number;
  contentTruncated?: boolean;
  classifyContext?: string;
  classifyContextLength?: number;
  contentHash?: string;
  error?: string;
}

interface CandidateUrl {
  url: string;
  normalizedUrl: string;
  source: string;
  urlKey: string;
}

interface FetchResult {
  status: number;
  contentType: string;
  body: string;
}

interface ParsedReadable {
  title: string | null;
  description: string | null;
  text: string;
}

export interface LinkContentClassifyContext {
  url: string;
  source: string | null;
  fetchedAt: string | null;
  title: string | null;
  text: string;
}

export interface EnrichLinksOptions {
  dryRun?: boolean;
  limit?: number;
  platforms?: string[];
  maxUrlsPerItem?: number;
  maxLinksPerItem?: number;
  timeoutMs?: number;
  maxRetries?: number;
  maxFetchChars?: number;
  maxTextChars?: number;
  maxClassifyContextChars?: number;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

interface EnrichLinksCounter {
  scannedItems: number;
  candidateItems: number;
  processedUrls: number;
  enrichedUrls: number;
  skippedAlreadyEnriched: number;
  skippedInvalidUrl: number;
  skippedYoutubeUrl: number;
  failedUrls: number;
  updatedItems: number;
}

export interface EnrichLinksPreview {
  pipelineItemId: string;
  platform: string;
  url: string;
  enrichedUrls: string[];
}

export interface EnrichLinksMetrics {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  limit: number;
  platforms?: string[];
  counter: EnrichLinksCounter;
  previews: EnrichLinksPreview[];
}

function createCounter(): EnrichLinksCounter {
  return {
    scannedItems: 0,
    candidateItems: 0,
    processedUrls: 0,
    enrichedUrls: 0,
    skippedAlreadyEnriched: 0,
    skippedInvalidUrl: 0,
    skippedYoutubeUrl: 0,
    failedUrls: 0,
    updatedItems: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1_000);
  return String(error).slice(0, 1_000);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getJsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return match;
    }

    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return match;
    }

    return HTML_ENTITY_TABLE[entity] ?? match;
  });
}

function extractUrlsFromText(input: string | null | undefined): string[] {
  if (!input) return [];

  const urls: string[] = [];
  const matches = input.match(URL_PATTERN) || [];

  for (const match of matches) {
    const cleaned = match.replace(/[).,!?;:'"\]]+$/g, "").trim();
    if (cleaned) urls.push(cleaned);
  }

  return urls;
}

function normalizeUrlCandidate(raw: string): string | null {
  const value = (raw || "").trim();
  if (!value) return null;

  // Guard malformed percent-encoding (e.g. "%" without two hex chars).
  if (/%(?![0-9A-Fa-f]{2})/.test(value)) {
    return null;
  }

  try {
    const url = new URL(value);
    if (!url.protocol.startsWith("http")) return null;

    const normalized = normalizeCanonicalUrl(url.toString());

    // Additional guard: URL parser used by fetch can reject malformed escape sequences.
    if (/%(?![0-9A-Fa-f]{2})/.test(normalized)) {
      return null;
    }

    // Validate URI-level escaping as well.
    decodeURI(normalized);

    return normalized;
  } catch {
    return null;
  }
}

function isYoutubeUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === "youtu.be" ||
      hostname.endsWith(".youtu.be") ||
      hostname.includes("youtube.com") ||
      hostname.includes("youtube-nocookie.com")
    );
  } catch {
    return /youtu\.be|youtube\.com/i.test(url);
  }
}

function toUrlKey(normalizedUrl: string): string {
  return createHash("sha256").update(normalizedUrl).digest("hex");
}

function collectUrlsFromUnknown(
  value: unknown,
  add: (url: string, source: string) => void,
  source: string,
  depth = 0,
): void {
  if (depth > 4 || value == null) return;

  if (typeof value === "string") {
    for (const url of extractUrlsFromText(value)) {
      add(url, source);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 80)) {
      collectUrlsFromUnknown(entry, add, source, depth + 1);
    }
    return;
  }

  if (!isObject(value)) return;

  const entries = Object.entries(value).slice(0, 120);

  for (const [key, child] of entries) {
    const normalizedKey = key.toLowerCase();
    if (typeof child === "string") {
      if (/(^|_)(url|link|href|sourceurl|articleurl|rawlink)$/.test(normalizedKey)) {
        add(child, `${source}:${normalizedKey}`);
      }
      for (const url of extractUrlsFromText(child)) {
        add(url, `${source}:${normalizedKey}`);
      }
      continue;
    }

    collectUrlsFromUnknown(child, add, `${source}:${normalizedKey}`, depth + 1);
  }
}

function extractTwitterEntityUrls(data: Record<string, unknown>): string[] {
  const entities = data.entities;
  if (!isObject(entities)) return [];

  const urls = Array.isArray(entities.urls) ? entities.urls : [];
  const found: string[] = [];

  for (const urlEntry of urls.slice(0, 20)) {
    if (!isObject(urlEntry)) continue;
    const candidates = [
      getString(urlEntry.expanded_url),
      getString(urlEntry.unwound_url),
      getString(urlEntry.url),
      getString(urlEntry.display_url),
    ].filter((value): value is string => Boolean(value));

    found.push(...candidates);
  }

  return found;
}

function extractFacebookTopCommentUrls(data: Record<string, unknown>): string[] {
  const topComments = data.topComments;
  if (!Array.isArray(topComments)) return [];

  const found: string[] = [];

  for (const comment of topComments.slice(0, 25)) {
    if (typeof comment === "string") {
      found.push(...extractUrlsFromText(comment));
      continue;
    }

    if (!isObject(comment)) continue;

    for (const field of ["text", "message", "comment", "url", "link"]) {
      const value = getString(comment[field]);
      if (!value) continue;
      if (field === "url" || field === "link") {
        found.push(value);
      }
      found.push(...extractUrlsFromText(value));
    }
  }

  return found;
}

function extractYoutubeDescriptionUrls(rawRoot: Record<string, unknown>): string[] {
  const enrichment = getJsonObject(rawRoot.enrichment as Prisma.JsonValue | undefined);
  const youtube = getJsonObject(enrichment.youtubeTranscript as Prisma.JsonValue | undefined);

  const found: string[] = [];

  const descriptionUrls = youtube.descriptionUrls;
  if (Array.isArray(descriptionUrls)) {
    for (const value of descriptionUrls) {
      const url = getString(value);
      if (url) found.push(url);
    }
  }

  const descriptionText = getString(youtube.descriptionText);
  if (descriptionText) {
    found.push(...extractUrlsFromText(descriptionText));
  }

  const metadata = getJsonObject(youtube.metadata as Prisma.JsonValue | undefined);
  const metadataDescription = getString(metadata.description);
  if (metadataDescription) {
    found.push(...extractUrlsFromText(metadataDescription));
  }

  return found;
}

function getStoredLinkContents(raw: Prisma.JsonValue | null | undefined): StoredLinkContent[] {
  const root = getJsonObject(raw);
  const enrichment = getJsonObject(root.enrichment as Prisma.JsonValue | undefined);
  const rawList = enrichment.linkContents;

  if (!Array.isArray(rawList)) return [];

  const list: StoredLinkContent[] = [];

  for (const entry of rawList) {
    if (!isObject(entry)) continue;

    list.push({
      version: getString(entry.version),
      status: getString(entry.status),
      fetchedAt: getString(entry.fetchedAt),
      source: getString(entry.source),
      url: getString(entry.url),
      normalizedUrl: getString(entry.normalizedUrl),
      urlKey: getString(entry.urlKey),
      urlHash: getString(entry.urlHash),
      httpStatus: typeof entry.httpStatus === "number" ? entry.httpStatus : undefined,
      title: getString(entry.title) || null,
      description: getString(entry.description) || null,
      contentText: getString(entry.contentText),
      contentLength: typeof entry.contentLength === "number" ? entry.contentLength : undefined,
      contentTruncated:
        typeof entry.contentTruncated === "boolean" ? entry.contentTruncated : undefined,
      classifyContext: getString(entry.classifyContext),
      classifyContextLength:
        typeof entry.classifyContextLength === "number" ? entry.classifyContextLength : undefined,
      contentHash: getString(entry.contentHash),
      error: getString(entry.error),
    });
  }

  return list;
}

function mergeRawWithLinkContents(
  raw: Prisma.JsonValue | null | undefined,
  newEntries: Prisma.InputJsonObject[],
  maxLinksPerItem: number,
): Prisma.InputJsonObject {
  const root = getJsonObject(raw);
  const existingEnrichment = getJsonObject(root.enrichment as Prisma.JsonValue | undefined);
  const existing = getStoredLinkContents(raw);

  const byKey = new Map<string, Prisma.InputJsonObject>();

  for (const entry of existing) {
    const key = entry.urlKey || (entry.normalizedUrl ? toUrlKey(entry.normalizedUrl) : undefined);
    if (!key) continue;
    byKey.set(key, entry as unknown as Prisma.InputJsonObject);
  }

  for (const entry of newEntries) {
    const key = getString(entry.urlKey);
    if (!key) continue;
    byKey.set(key, entry);
  }

  const merged = [...byKey.values()]
    .sort((a, b) => {
      const aDate = Date.parse((getString(a.fetchedAt) || "") as string);
      const bDate = Date.parse((getString(b.fetchedAt) || "") as string);
      return (Number.isFinite(bDate) ? bDate : 0) - (Number.isFinite(aDate) ? aDate : 0);
    })
    .slice(0, Math.max(1, maxLinksPerItem));

  return {
    ...(root as Prisma.InputJsonObject),
    enrichment: {
      ...(existingEnrichment as Prisma.InputJsonObject),
      linkContents: merged,
    },
  };
}

function extractCandidateUrls(item: PipelineItem): CandidateUrl[] {
  const candidates = new Map<string, CandidateUrl>();

  const addCandidate = (raw: string | null | undefined, source: string) => {
    if (!raw) return;

    const normalized = normalizeUrlCandidate(raw);
    if (!normalized) return;

    const urlKey = toUrlKey(normalized);
    if (candidates.has(urlKey)) return;

    candidates.set(urlKey, {
      url: raw.trim(),
      normalizedUrl: normalized,
      source,
      urlKey,
    });
  };

  addCandidate(item.url, "item:url");
  addCandidate(item.canonicalUrl, "item:canonicalUrl");

  for (const url of extractUrlsFromText(item.title)) {
    addCandidate(url, "item:title");
  }

  for (const url of extractUrlsFromText(item.body)) {
    addCandidate(url, "item:body");
  }

  const root = getJsonObject(item.raw);
  const data = getJsonObject(root.data as Prisma.JsonValue | undefined);

  for (const url of extractYoutubeDescriptionUrls(root)) {
    addCandidate(url, "youtube:description");
  }

  if (item.platform === "twitter") {
    for (const url of extractTwitterEntityUrls(data)) {
      addCandidate(url, "twitter:entities");
    }
  }

  if (item.platform === "facebook") {
    for (const url of extractFacebookTopCommentUrls(data)) {
      addCandidate(url, "facebook:topComments");
    }
  }

  if (item.platform === "alerts") {
    const nestedRaw = data.raw;
    if (nestedRaw) {
      collectUrlsFromUnknown(nestedRaw, addCandidate, "alerts:raw");
    }
  }

  collectUrlsFromUnknown(data, addCandidate, "raw:data");

  return [...candidates.values()];
}

export async function fetchGuardedLinkContent(
  url: string,
  timeoutMs: number,
  maxRetries: number,
  maxBodyBytes?: number,
  dependencies?: SafeFetchDependencies,
): Promise<FetchResult> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt += 1) {
    try {
      const response = await safeFetchText(url, {
        method: "GET",
        timeoutMs,
        maxBodyBytes,
        dependencies,
        headers: {
          "User-Agent": userAgent("link-enrich", { contact: "+https://localhost" }),
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2",
        },
      });
      const contentType = (response.headers["content-type"] || "").toString().toLowerCase();
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("application/xhtml+xml") &&
        !contentType.includes("text/plain")
      ) {
        throw new Error(`Unsupported content-type: ${contentType || "unknown"}`);
      }

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`);
      }

      return {
        status: response.status,
        contentType,
        body: response.body,
      };
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        await sleep(attempt * 500);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to fetch link content with unknown error");
}

function parseReadableContent(contentType: string, rawBody: string): ParsedReadable {
  if (contentType.includes("text/plain")) {
    return {
      title: null,
      description: null,
      text: sanitize(rawBody),
    };
  }

  const titleMatch = rawBody.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? sanitize(decodeHtmlEntities(titleMatch[1])) : null;

  const descriptionMatch =
    rawBody.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i) ||
    rawBody.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i);
  const description = descriptionMatch ? sanitize(decodeHtmlEntities(descriptionMatch[1])) : null;

  const withoutNoise = rawBody
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ");

  const text = sanitize(decodeHtmlEntities(withoutNoise.replace(/<[^>]+>/g, " ")));

  return {
    title,
    description,
    text,
  };
}

function buildClassifyContext(
  parsed: ParsedReadable,
  normalizedUrl: string,
  maxClassifyContextChars: number,
): string {
  const parts = [
    parsed.title ? `title: ${parsed.title}` : null,
    parsed.description ? `description: ${parsed.description}` : null,
    parsed.text ? `content: ${parsed.text}` : null,
    `url: ${normalizedUrl}`,
  ].filter((value): value is string => Boolean(value));

  return truncate(parts.join("\n"), maxClassifyContextChars);
}

function toPlatformFilter(platforms?: string[]): string[] | undefined {
  if (!platforms || platforms.length === 0) return undefined;

  const normalized = [...new Set(platforms.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
}

export function getLinkContentsClassifyContext(
  raw: Prisma.JsonValue | null | undefined,
  options?: {
    maxTotalChars?: number;
    maxLinks?: number;
  },
): LinkContentClassifyContext[] {
  const maxTotalChars =
    options?.maxTotalChars && options.maxTotalChars > 200
      ? Math.floor(options.maxTotalChars)
      : DEFAULT_MAX_CLASSIFY_CONTEXT_CHARS;

  const maxLinks =
    options?.maxLinks && options.maxLinks > 0
      ? Math.floor(options.maxLinks)
      : DEFAULT_CLASSIFY_MAX_LINKS;

  const records = getStoredLinkContents(raw).filter((entry) => entry.status === "ok");

  let consumed = 0;
  const selected: LinkContentClassifyContext[] = [];

  for (const record of records) {
    if (selected.length >= maxLinks) break;

    const sourceText = record.classifyContext || record.contentText;
    if (!sourceText) continue;

    const remaining = maxTotalChars - consumed;
    if (remaining < 120) break;

    const text = truncate(sanitize(sourceText), remaining);
    if (!text) continue;

    selected.push({
      url: record.normalizedUrl || record.url || "",
      source: record.source || null,
      fetchedAt: record.fetchedAt || null,
      title: record.title || null,
      text,
    });

    consumed += text.length;
  }

  return selected;
}

export async function enrichPipelineItemLinks(
  prisma: PrismaClient,
  options: EnrichLinksOptions = {},
): Promise<EnrichLinksMetrics> {
  const logger = options.logger || console;
  const startedAt = new Date();
  const dryRun = Boolean(options.dryRun);
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : DEFAULT_LIMIT;
  const platformFilter = toPlatformFilter(options.platforms);

  const maxUrlsPerItem =
    options.maxUrlsPerItem && options.maxUrlsPerItem > 0
      ? Math.floor(options.maxUrlsPerItem)
      : Number.parseInt(process.env.LINK_ENRICH_MAX_URLS_PER_ITEM || "", 10) ||
        DEFAULT_MAX_URLS_PER_ITEM;

  const maxLinksPerItem =
    options.maxLinksPerItem && options.maxLinksPerItem > 0
      ? Math.floor(options.maxLinksPerItem)
      : Number.parseInt(process.env.LINK_ENRICH_MAX_LINKS_PER_ITEM || "", 10) ||
        DEFAULT_MAX_LINKS_PER_ITEM;

  const timeoutMs =
    options.timeoutMs && options.timeoutMs > 500
      ? Math.floor(options.timeoutMs)
      : Number.parseInt(process.env.LINK_ENRICH_TIMEOUT_MS || "", 10) || DEFAULT_TIMEOUT_MS;

  const maxRetries =
    options.maxRetries && options.maxRetries > 0
      ? Math.floor(options.maxRetries)
      : Number.parseInt(process.env.LINK_ENRICH_MAX_RETRIES || "", 10) || DEFAULT_MAX_RETRIES;

  const maxFetchChars =
    options.maxFetchChars && options.maxFetchChars > 2_000
      ? Math.floor(options.maxFetchChars)
      : Number.parseInt(process.env.LINK_ENRICH_MAX_FETCH_CHARS || "", 10) ||
        DEFAULT_MAX_FETCH_CHARS;

  const maxTextChars =
    options.maxTextChars && options.maxTextChars > 200
      ? Math.floor(options.maxTextChars)
      : Number.parseInt(process.env.LINK_ENRICH_MAX_TEXT_CHARS || "", 10) ||
        DEFAULT_MAX_TEXT_CHARS;

  const maxClassifyContextChars =
    options.maxClassifyContextChars && options.maxClassifyContextChars > 200
      ? Math.floor(options.maxClassifyContextChars)
      : Number.parseInt(process.env.LINK_ENRICH_MAX_CLASSIFY_CONTEXT_CHARS || "", 10) ||
        DEFAULT_MAX_CLASSIFY_CONTEXT_CHARS;

  const where: Prisma.PipelineItemWhereInput = {
    normalizedAt: { not: null },
  };

  if (platformFilter && platformFilter.length > 0) {
    where.platform = { in: platformFilter };
  }

  const items = await prisma.pipelineItem.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { ingestedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  const counter = createCounter();
  const previews: EnrichLinksPreview[] = [];

  for (const item of items) {
    counter.scannedItems += 1;

    const existing = getStoredLinkContents(item.raw);
    const existingKeys = new Set<string>();

    for (const entry of existing) {
      if (entry.urlKey) existingKeys.add(entry.urlKey);
      if (entry.urlHash) existingKeys.add(entry.urlHash);
      if (entry.normalizedUrl) existingKeys.add(toUrlKey(entry.normalizedUrl));
      if (entry.contentHash) existingKeys.add(entry.contentHash);
    }

    const candidates = extractCandidateUrls(item);
    const pending: CandidateUrl[] = [];

    for (const candidate of candidates) {
      if (!candidate.normalizedUrl) {
        counter.skippedInvalidUrl += 1;
        continue;
      }

      if (isYoutubeUrl(candidate.normalizedUrl)) {
        counter.skippedYoutubeUrl += 1;
        continue;
      }

      if (existingKeys.has(candidate.urlKey)) {
        counter.skippedAlreadyEnriched += 1;
        continue;
      }

      pending.push(candidate);
      if (pending.length >= maxUrlsPerItem) break;
    }

    if (pending.length === 0) {
      continue;
    }

    counter.candidateItems += 1;

    const newEntries: Prisma.InputJsonObject[] = [];

    for (const candidate of pending) {
      counter.processedUrls += 1;

      try {
        // Stream-time byte cap: 4 bytes = max UTF-8 code point width, so this can never
        // drop content the char-level truncate below would have kept.
        const fetched = await fetchGuardedLinkContent(
          candidate.normalizedUrl,
          timeoutMs,
          maxRetries,
          maxFetchChars * 4,
        );
        const clippedBody = truncate(fetched.body, maxFetchChars);

        const parsed = parseReadableContent(fetched.contentType, clippedBody);
        const contentText = truncate(parsed.text, maxTextChars);

        if (!contentText) {
          throw new Error("Readable content is empty");
        }

        const classifyContext = buildClassifyContext(
          {
            ...parsed,
            text: contentText,
          },
          candidate.normalizedUrl,
          maxClassifyContextChars,
        );

        const sanitizedContentText = sanitizeToWellFormed(contentText);
        const sanitizedTitle = parsed.title ? sanitizeToWellFormed(parsed.title) : null;
        const sanitizedDescription = parsed.description
          ? sanitizeToWellFormed(parsed.description)
          : null;
        const sanitizedClassifyContext = sanitizeToWellFormed(classifyContext);
        const replacedCount =
          sanitizedContentText.replacedCount +
          (sanitizedTitle?.replacedCount || 0) +
          (sanitizedDescription?.replacedCount || 0) +
          sanitizedClassifyContext.replacedCount;
        if (replacedCount > 0) {
          logger.warn(
            `[enrich-links] item=${item.id} sanitized ill-formed code units before raw update: contentText=${sanitizedContentText.replacedCount} title=${sanitizedTitle?.replacedCount || 0} description=${sanitizedDescription?.replacedCount || 0} classifyContext=${sanitizedClassifyContext.replacedCount}`,
          );
        }

        const contentHash = createHash("sha256").update(sanitizedContentText.result).digest("hex");

        const entry: Prisma.InputJsonObject = {
          version: "link-content-v1",
          status: "ok",
          fetchedAt: new Date().toISOString(),
          source: candidate.source,
          url: candidate.url,
          normalizedUrl: candidate.normalizedUrl,
          urlKey: candidate.urlKey,
          urlHash: candidate.urlKey,
          httpStatus: fetched.status,
          title: sanitizedTitle?.result ?? null,
          description: sanitizedDescription?.result ?? null,
          contentText: sanitizedContentText.result,
          contentLength: parsed.text.length,
          contentTruncated: parsed.text.length > contentText.length,
          classifyContext: sanitizedClassifyContext.result,
          classifyContextLength: sanitizedClassifyContext.result.length,
          contentHash,
        };

        existingKeys.add(candidate.urlKey);
        existingKeys.add(contentHash);
        newEntries.push(entry);
        counter.enrichedUrls += 1;

        logger.log(
          `[enrich-links] item=${item.id} platform=${item.platform} url=${candidate.normalizedUrl} chars=${contentText.length}`,
        );
      } catch (error) {
        counter.failedUrls += 1;
        const message = sanitizeErrorMessage(error);

        const failureEntry: Prisma.InputJsonObject = {
          version: "link-content-v1",
          status: "failed",
          fetchedAt: new Date().toISOString(),
          source: candidate.source,
          url: candidate.url,
          normalizedUrl: candidate.normalizedUrl,
          urlKey: candidate.urlKey,
          urlHash: candidate.urlKey,
          error: message,
        };

        existingKeys.add(candidate.urlKey);
        newEntries.push(failureEntry);

        logger.warn(
          `[enrich-links] item=${item.id} platform=${item.platform} url=${candidate.normalizedUrl} failed: ${message}`,
        );
      }
    }

    if (newEntries.length === 0) {
      continue;
    }

    if (previews.length < 20) {
      previews.push({
        pipelineItemId: item.id,
        platform: item.platform,
        url: item.url,
        enrichedUrls: newEntries
          .map((entry) => getString(entry.normalizedUrl))
          .filter((value): value is string => Boolean(value)),
      });
    }

    if (!dryRun) {
      await prisma.pipelineItem.update({
        where: { id: item.id },
        data: {
          raw: mergeRawWithLinkContents(item.raw, newEntries, maxLinksPerItem),
        },
      });
    }

    counter.updatedItems += 1;
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    dryRun,
    limit,
    platforms: platformFilter,
    counter,
    previews,
  };
}
