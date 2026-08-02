import { PipelineItem, Prisma, PrismaClient } from "@prisma/client";
import { userAgent } from "../branding";
import { normalizeCanonicalUrl } from "./normalize";
import { sanitizeText, sanitizeToWellFormed } from "./text-sanitize";

const DEFAULT_LIMIT = 50;
const DEFAULT_PROVIDER = "transcriptapi";
const TRANSCRIPT_API_BASE_URL = "https://transcriptapi.com/api/v2/youtube/transcript";
const DEFAULT_MAX_TRANSCRIPT_CHARS = 16_000;
const DEFAULT_MAX_DESCRIPTION_CHARS = 6_000;
const DEFAULT_MAX_CLASSIFY_CONTEXT_CHARS = 2_400;
const TRANSCRIPT_API_TIMEOUT_MS = 30_000;
const YOUTUBE_PAGE_TIMEOUT_MS = 8_000;
const YT_ENRICH_VERSION = "youtube-transcript-v2";
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

export interface YoutubeTranscriptClassifyContext {
  provider: string | null;
  fetchedAt: string | null;
  videoId: string | null;
  language: string | null;
  text: string;
}

interface StoredYoutubeTranscriptEnrichment {
  version?: string;
  provider?: string;
  status?: string;
  fetchedAt?: string;
  sourceUrl?: string;
  videoId?: string;
  language?: string | null;
  transcriptText?: string;
  transcriptLength?: number;
  transcriptTruncated?: boolean;
  descriptionText?: string;
  descriptionLength?: number;
  descriptionUrls?: string[];
  classifyContext?: string;
  classifyContextLength?: number;
  metadata?: {
    title?: string | null;
    authorName?: string | null;
    authorUrl?: string | null;
    thumbnailUrl?: string | null;
    description?: string | null;
  } | null;
}

interface TranscriptApiSegment {
  text?: string;
  start?: number;
  duration?: number;
}

interface TranscriptApiResponse {
  video_id?: string;
  language?: string;
  transcript?: TranscriptApiSegment[];
  metadata?: {
    title?: string;
    author_name?: string;
    author_url?: string;
    thumbnail_url?: string;
    description?: string;
  };
}

interface TranscriptResult {
  videoId: string;
  sourceUrl: string;
  language: string | null;
  transcriptText: string;
  metadata: {
    title: string | null;
    authorName: string | null;
    authorUrl: string | null;
    thumbnailUrl: string | null;
    description: string | null;
  } | null;
}

export interface EnrichYoutubeTranscriptOptions {
  dryRun?: boolean;
  limit?: number;
  provider?: string;
  apiKey?: string;
  maxTranscriptChars?: number;
  maxDescriptionChars?: number;
  maxClassifyContextChars?: number;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

interface EnrichYoutubeTranscriptCounter {
  scanned: number;
  candidates: number;
  enriched: number;
  skippedAlreadyEnriched: number;
  skippedInvalidYoutubeUrl: number;
  failed: number;
}

export interface EnrichYoutubeTranscriptPreview {
  pipelineItemId: string;
  url: string;
  videoId: string;
  language: string | null;
  transcriptLength: number;
  classifyContextLength: number;
}

export interface EnrichYoutubeTranscriptMetrics {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  limit: number;
  provider: string;
  counter: EnrichYoutubeTranscriptCounter;
  previews: EnrichYoutubeTranscriptPreview[];
}

function createCounter(): EnrichYoutubeTranscriptCounter {
  return {
    scanned: 0,
    candidates: 0,
    enriched: 0,
    skippedAlreadyEnriched: 0,
    skippedInvalidYoutubeUrl: 0,
    failed: 0,
  };
}

function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function sanitize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function extractUrlsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const matched = text.match(URL_PATTERN) || [];
  return matched.map((url) => url.trim()).filter((url) => url.length > 0);
}

function normalizeExternalUrl(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;

  try {
    const normalized = normalizeCanonicalUrl(input);
    const parsed = new URL(normalized);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function decodeJsonEscapedString(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value;
  }
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

function sanitizeObjectStringFields<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === "string" ? sanitizeText(value) : value,
    ]),
  ) as T;
}

function extractYoutubeVideoId(rawUrl: string): string | null {
  const input = rawUrl.trim();
  if (!input) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }

  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();

    if (hostname === "youtu.be" || hostname.endsWith(".youtu.be")) {
      const [candidate] = url.pathname.replace(/^\//, "").split("/");
      return /^[a-zA-Z0-9_-]{11}$/.test(candidate || "") ? candidate : null;
    }

    if (hostname.includes("youtube.com") || hostname.includes("youtube-nocookie.com")) {
      const v = url.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      const pathParts = url.pathname.split("/").filter(Boolean);
      const markerIndex = pathParts.findIndex((part) =>
        ["embed", "shorts", "live", "v"].includes(part),
      );
      if (markerIndex >= 0) {
        const candidate = pathParts[markerIndex + 1];
        if (candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

function getPreferredYoutubeUrl(item: PipelineItem): string {
  if (item.canonicalUrl && /youtu\.be|youtube\.com/i.test(item.canonicalUrl)) {
    return item.canonicalUrl;
  }
  return item.url;
}

function getStoredYoutubeTranscriptEnrichment(
  raw: Prisma.JsonValue | null | undefined,
): StoredYoutubeTranscriptEnrichment | null {
  const root = getJsonObject(raw);
  const enrichment = getJsonObject(root.enrichment as Prisma.JsonValue | undefined);
  const youtubeTranscript = enrichment.youtubeTranscript;

  if (!isObject(youtubeTranscript)) return null;

  const record: StoredYoutubeTranscriptEnrichment = {
    version: getString(youtubeTranscript.version),
    provider: getString(youtubeTranscript.provider),
    status: getString(youtubeTranscript.status),
    fetchedAt: getString(youtubeTranscript.fetchedAt),
    sourceUrl: getString(youtubeTranscript.sourceUrl),
    videoId: getString(youtubeTranscript.videoId),
    language: getString(youtubeTranscript.language),
    transcriptText: getString(youtubeTranscript.transcriptText),
    descriptionText: getString(youtubeTranscript.descriptionText),
    descriptionUrls: Array.isArray(youtubeTranscript.descriptionUrls)
      ? youtubeTranscript.descriptionUrls
          .map((value) => getString(value))
          .filter((value): value is string => Boolean(value))
      : undefined,
    classifyContext: getString(youtubeTranscript.classifyContext),
    transcriptLength:
      typeof youtubeTranscript.transcriptLength === "number"
        ? youtubeTranscript.transcriptLength
        : undefined,
    descriptionLength:
      typeof youtubeTranscript.descriptionLength === "number"
        ? youtubeTranscript.descriptionLength
        : undefined,
    transcriptTruncated:
      typeof youtubeTranscript.transcriptTruncated === "boolean"
        ? youtubeTranscript.transcriptTruncated
        : undefined,
    classifyContextLength:
      typeof youtubeTranscript.classifyContextLength === "number"
        ? youtubeTranscript.classifyContextLength
        : undefined,
    metadata: isObject(youtubeTranscript.metadata)
      ? {
          title: getString(youtubeTranscript.metadata.title),
          authorName: getString(youtubeTranscript.metadata.authorName),
          authorUrl: getString(youtubeTranscript.metadata.authorUrl),
          thumbnailUrl: getString(youtubeTranscript.metadata.thumbnailUrl),
          description: getString(youtubeTranscript.metadata.description),
        }
      : null,
  };

  return record;
}

function mergeRawWithYoutubeEnrichment(
  raw: Prisma.JsonValue | null | undefined,
  enrichmentRecord: Prisma.InputJsonObject,
): Prisma.InputJsonObject {
  const root = getJsonObject(raw);
  const existingEnrichment = getJsonObject(root.enrichment as Prisma.JsonValue | undefined);

  return {
    ...(root as Prisma.InputJsonObject),
    enrichment: {
      ...(existingEnrichment as Prisma.InputJsonObject),
      youtubeTranscript: enrichmentRecord,
    },
  };
}

function toClassifyContext(
  transcriptText: string,
  metadata: TranscriptResult["metadata"],
  descriptionText: string | null,
  maxChars: number,
): string {
  const headerParts = [
    metadata?.title ? `title: ${metadata.title}` : null,
    metadata?.authorName ? `author: ${metadata.authorName}` : null,
  ].filter((value): value is string => Boolean(value));

  const parts = [
    headerParts.length > 0 ? headerParts.join(" | ") : null,
    sanitize(transcriptText),
    descriptionText ? `description: ${sanitize(descriptionText)}` : null,
  ].filter((value): value is string => Boolean(value));

  return truncate(parts.join("\n"), maxChars);
}

export function getYoutubeTranscriptClassifyContext(
  raw: Prisma.JsonValue | null | undefined,
  maxChars = DEFAULT_MAX_CLASSIFY_CONTEXT_CHARS,
): YoutubeTranscriptClassifyContext | null {
  const enriched = getStoredYoutubeTranscriptEnrichment(raw);
  if (!enriched || enriched.status !== "ok") return null;

  const base = enriched.classifyContext || enriched.transcriptText;
  if (!base) return null;

  const composed = enriched.descriptionText
    ? `${base}\n\ndescription: ${enriched.descriptionText}`
    : base;

  const text = truncate(sanitize(composed), maxChars);
  if (!text) return null;

  return {
    provider: enriched.provider || null,
    fetchedAt: enriched.fetchedAt || null,
    videoId: enriched.videoId || null,
    language: enriched.language || null,
    text,
  };
}

async function fetchTranscriptViaTranscriptApi(
  apiKey: string,
  sourceUrl: string,
): Promise<TranscriptResult> {
  const endpoint = new URL(TRANSCRIPT_API_BASE_URL);
  endpoint.searchParams.set("video_url", sourceUrl);
  endpoint.searchParams.set("include_metadata", "true");
  endpoint.searchParams.set("include_timestamp", "false");
  endpoint.searchParams.set("format", "json");

  const response = await fetch(endpoint.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(TRANSCRIPT_API_TIMEOUT_MS),
  });

  const payload = (await response.json()) as TranscriptApiResponse;

  if (!response.ok) {
    throw new Error(`TranscriptAPI ${response.status}: ${JSON.stringify(payload).slice(0, 320)}`);
  }

  const transcriptSegments = Array.isArray(payload.transcript) ? payload.transcript : [];
  const transcriptText = sanitize(
    transcriptSegments
      .map((segment) => (typeof segment?.text === "string" ? segment.text : ""))
      .join(" "),
  );

  if (!transcriptText) {
    throw new Error("TranscriptAPI returned empty transcript");
  }

  const fallbackVideoId = extractYoutubeVideoId(sourceUrl);
  const resolvedVideoId = getString(payload.video_id) || fallbackVideoId;
  if (!resolvedVideoId) {
    throw new Error("Unable to resolve YouTube video ID from transcript response");
  }

  return {
    videoId: resolvedVideoId,
    sourceUrl,
    language: getString(payload.language) || null,
    transcriptText,
    metadata: payload.metadata
      ? {
          title: getString(payload.metadata.title) || null,
          authorName: getString(payload.metadata.author_name) || null,
          authorUrl: getString(payload.metadata.author_url) || null,
          thumbnailUrl: getString(payload.metadata.thumbnail_url) || null,
          description: getString(payload.metadata.description) || null,
        }
      : null,
  };
}

async function fetchYoutubeDescription(sourceUrl: string, videoId: string): Promise<{
  descriptionText: string | null;
  descriptionUrls: string[];
}> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const targetUrl = /youtube\.com|youtu\.be/i.test(sourceUrl) ? sourceUrl : watchUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YOUTUBE_PAGE_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent("youtube-enrich", { contact: "+https://localhost" }),
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2",
      },
    });

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok) {
      throw new Error(`YouTube page HTTP ${response.status}`);
    }

    if (!contentType.includes("text/html")) {
      throw new Error(`Unsupported YouTube page content-type: ${contentType || "unknown"}`);
    }

    const html = await response.text();
    const match = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
    if (!match?.[1]) {
      return {
        descriptionText: null,
        descriptionUrls: [],
      };
    }

    const decoded = sanitize(decodeJsonEscapedString(match[1]));
    const descriptionText = decoded.length > 0 ? decoded : null;

    const descriptionUrls = uniq(
      extractUrlsFromText(descriptionText)
        .map((url) => normalizeExternalUrl(url))
        .filter((url): url is string => Boolean(url)),
    );

    return {
      descriptionText,
      descriptionUrls,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichAlertsYoutubeTranscripts(
  prisma: PrismaClient,
  options: EnrichYoutubeTranscriptOptions = {},
): Promise<EnrichYoutubeTranscriptMetrics> {
  const logger = options.logger || console;
  const startedAt = new Date();
  const dryRun = Boolean(options.dryRun);
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : DEFAULT_LIMIT;
  const provider = (options.provider || process.env.TRANSCRIPT_PROVIDER || DEFAULT_PROVIDER)
    .trim()
    .toLowerCase();

  if (provider !== "transcriptapi") {
    throw new Error(`Unsupported TRANSCRIPT_PROVIDER: ${provider || "(empty)"}`);
  }

  const apiKey = (options.apiKey || process.env.TRANSCRIPTAPI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("TRANSCRIPTAPI_API_KEY is not set");
  }

  const maxTranscriptChars =
    options.maxTranscriptChars && options.maxTranscriptChars > 500
      ? Math.floor(options.maxTranscriptChars)
      : DEFAULT_MAX_TRANSCRIPT_CHARS;

  const maxDescriptionChars =
    options.maxDescriptionChars && options.maxDescriptionChars > 200
      ? Math.floor(options.maxDescriptionChars)
      : DEFAULT_MAX_DESCRIPTION_CHARS;

  const maxClassifyContextChars =
    options.maxClassifyContextChars && options.maxClassifyContextChars > 200
      ? Math.floor(options.maxClassifyContextChars)
      : DEFAULT_MAX_CLASSIFY_CONTEXT_CHARS;

  const items = await prisma.pipelineItem.findMany({
    where: {
      platform: "alerts",
      normalizedAt: { not: null },
      OR: [
        { url: { contains: "youtube.com", mode: "insensitive" } },
        { url: { contains: "youtu.be", mode: "insensitive" } },
        { canonicalUrl: { contains: "youtube.com", mode: "insensitive" } },
        { canonicalUrl: { contains: "youtu.be", mode: "insensitive" } },
      ],
    },
    orderBy: [{ publishedAt: "desc" }, { ingestedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  const counter = createCounter();
  const previews: EnrichYoutubeTranscriptPreview[] = [];

  for (const item of items) {
    counter.scanned += 1;

    const sourceUrl = getPreferredYoutubeUrl(item);
    const videoId = extractYoutubeVideoId(sourceUrl);

    if (!videoId) {
      counter.skippedInvalidYoutubeUrl += 1;
      continue;
    }

    const existing = getStoredYoutubeTranscriptEnrichment(item.raw);
    const alreadyV2 =
      existing?.status === "ok" &&
      existing.videoId === videoId &&
      existing.version === YT_ENRICH_VERSION;

    if (alreadyV2) {
      counter.skippedAlreadyEnriched += 1;
      continue;
    }

    counter.candidates += 1;

    try {
      const fetched = await fetchTranscriptViaTranscriptApi(apiKey, sourceUrl);
      const transcriptText = truncate(fetched.transcriptText, maxTranscriptChars);

      let descriptionText = fetched.metadata?.description || null;
      let descriptionUrls: string[] = [];

      try {
        const details = await fetchYoutubeDescription(sourceUrl, fetched.videoId);
        descriptionText = details.descriptionText || descriptionText;
        descriptionUrls = details.descriptionUrls;
      } catch (detailError) {
        logger.warn(
          `[enrich-transcript] item=${item.id} videoId=${fetched.videoId} description fetch skipped: ${sanitizeErrorMessage(detailError)}`,
        );
      }

      descriptionText = descriptionText ? truncate(descriptionText, maxDescriptionChars) : null;

      const classifyContext = toClassifyContext(
        fetched.transcriptText,
        fetched.metadata,
        descriptionText,
        maxClassifyContextChars,
      );
      const sanitizedTranscriptText = sanitizeToWellFormed(transcriptText);
      const sanitizedDescriptionText = descriptionText ? sanitizeToWellFormed(descriptionText) : null;
      const sanitizedClassifyContext = sanitizeToWellFormed(classifyContext);
      const replacedCount =
        sanitizedTranscriptText.replacedCount +
        (sanitizedDescriptionText?.replacedCount || 0) +
        sanitizedClassifyContext.replacedCount;
      if (replacedCount > 0) {
        logger.warn(
          `[enrich-transcript] item=${item.id} videoId=${fetched.videoId} sanitized ill-formed code units before raw update: transcriptText=${sanitizedTranscriptText.replacedCount} descriptionText=${sanitizedDescriptionText?.replacedCount || 0} classifyContext=${sanitizedClassifyContext.replacedCount}`,
        );
      }

      const record: Prisma.InputJsonObject = {
        version: YT_ENRICH_VERSION,
        provider,
        status: "ok",
        fetchedAt: new Date().toISOString(),
        sourceUrl: fetched.sourceUrl,
        videoId: fetched.videoId,
        language: fetched.language,
        transcriptText: sanitizedTranscriptText.result,
        transcriptLength: fetched.transcriptText.length,
        transcriptTruncated: fetched.transcriptText.length > transcriptText.length,
        descriptionText: sanitizedDescriptionText?.result ?? null,
        descriptionLength: sanitizedDescriptionText?.result.length || 0,
        descriptionUrls,
        classifyContext: sanitizedClassifyContext.result,
        classifyContextLength: sanitizedClassifyContext.result.length,
        metadata: fetched.metadata ? sanitizeObjectStringFields(fetched.metadata) : null,
      };

      if (previews.length < 20) {
        previews.push({
          pipelineItemId: item.id,
          url: item.url,
          videoId: fetched.videoId,
          language: fetched.language,
          transcriptLength: fetched.transcriptText.length,
          classifyContextLength: classifyContext.length,
        });
      }

      if (!dryRun) {
        await prisma.pipelineItem.update({
          where: { id: item.id },
          data: {
            raw: mergeRawWithYoutubeEnrichment(item.raw, record),
          },
        });
      }

      counter.enriched += 1;
      logger.log(
        `[enrich-transcript] item=${item.id} videoId=${fetched.videoId} chars=${fetched.transcriptText.length} context=${classifyContext.length}`,
      );
    } catch (error) {
      counter.failed += 1;
      logger.warn(`[enrich-transcript] item=${item.id} failed: ${sanitizeErrorMessage(error)}`);
    }
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    dryRun,
    limit,
    provider,
    counter,
    previews,
  };
}
