import { createHash } from "crypto";

export interface EmbedResult {
  embedding: number[];
  tokenCount?: number;
}

export interface EmbedBatchResult {
  results: Array<{ index: number; embedding: number[] }>;
  totalTokens: number;
  errors: Array<{ index: number; error: string }>;
}

type EmbedLogger = Pick<Console, "warn" | "error">;

const DEFAULT_EMBED_MODEL = "openai/text-embedding-3-small";
const DEFAULT_EMBED_ENDPOINT = "https://openrouter.ai/api/v1/embeddings";
const DEFAULT_BATCH_SIZE = 64;
const DEFAULT_MAX_RETRIES = 3;
const EMBED_INPUT_MAX_CHARS = 8192;
const OPENROUTER_EMBED_TIMEOUT_MS = 30_000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkWithOffset<T>(values: T[], size: number): Array<{ offset: number; values: T[] }> {
  const chunks: Array<{ offset: number; values: T[] }> = [];
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push({ offset, values: values.slice(offset, offset + size) });
  }
  return chunks;
}

function normalizeEmbeddingText(input: string): string {
  return input.replace(/[\u3000\t\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, EMBED_INPUT_MAX_CHARS);
}

export function buildEmbeddingText(title: string | null | undefined, body: string | null | undefined): string {
  return normalizeEmbeddingText(`${title ?? ""}\n${body ?? ""}`);
}

export function buildEmbeddingContentHash(title: string | null | undefined, body: string | null | undefined): string {
  return createHash("sha256").update(buildEmbeddingText(title, body)).digest("hex");
}

async function parseResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`OpenRouter returned non-JSON response: ${sanitizeErrorMessage(error)} body=${text.slice(0, 500)}`);
  }
}

function isEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

async function requestEmbeddingBatch(params: {
  texts: string[];
  apiKey: string;
  offset: number;
  model: string;
  endpoint: string;
  logger: EmbedLogger;
}): Promise<EmbedBatchResult> {
  const { texts, apiKey, offset, model, endpoint, logger } = params;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://localhost",
      "X-Title": "xcollector-step45-topic-cluster",
    },
    body: JSON.stringify({
      model,
      input: texts,
    }),
    signal: AbortSignal.timeout(OPENROUTER_EMBED_TIMEOUT_MS),
  });

  const payload = await parseResponseJson(response);
  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  const data = Array.isArray((payload as { data?: unknown }).data)
    ? ((payload as { data: unknown[] }).data)
    : [];
  const usage = (payload as { usage?: { total_tokens?: unknown } }).usage;
  const totalTokens =
    typeof usage?.total_tokens === "number" && Number.isFinite(usage.total_tokens)
      ? usage.total_tokens
      : 0;

  const results: EmbedBatchResult["results"] = [];
  const errors: EmbedBatchResult["errors"] = [];
  const seen = new Set<number>();

  for (let arrayIndex = 0; arrayIndex < data.length; arrayIndex += 1) {
    const row = data[arrayIndex] as { index?: unknown; embedding?: unknown };
    const relativeIndex =
      typeof row.index === "number" && Number.isInteger(row.index) ? row.index : arrayIndex;
    const absoluteIndex = offset + relativeIndex;

    if (relativeIndex < 0 || relativeIndex >= texts.length) {
      const error = `embedding response index out of range: ${relativeIndex}`;
      logger.warn(`[embedding] itemIndex=${absoluteIndex} error=${error}`);
      errors.push({ index: absoluteIndex, error });
      continue;
    }

    if (!isEmbedding(row.embedding)) {
      const error = "embedding response missing numeric embedding";
      logger.warn(`[embedding] itemIndex=${absoluteIndex} error=${error}`);
      errors.push({ index: absoluteIndex, error });
      continue;
    }

    seen.add(relativeIndex);
    results.push({ index: absoluteIndex, embedding: row.embedding });
  }

  for (let relativeIndex = 0; relativeIndex < texts.length; relativeIndex += 1) {
    if (seen.has(relativeIndex)) continue;
    const absoluteIndex = offset + relativeIndex;
    const error = "embedding response omitted item";
    logger.warn(`[embedding] itemIndex=${absoluteIndex} error=${error}`);
    errors.push({ index: absoluteIndex, error });
  }

  return { results, totalTokens, errors };
}

export async function embedTexts(
  texts: string[],
  apiKey: string,
  logger: EmbedLogger = console,
): Promise<EmbedBatchResult> {
  const model = (process.env.STEP_EMBED_MODEL || DEFAULT_EMBED_MODEL).trim();
  const endpoint = (process.env.STEP_EMBED_ENDPOINT || DEFAULT_EMBED_ENDPOINT).trim();
  const batchSize = parsePositiveInt(process.env.STEP_EMBED_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const maxRetries = parsePositiveInt(process.env.STEP_EMBED_MAX_RETRIES, DEFAULT_MAX_RETRIES);

  const output: EmbedBatchResult = {
    results: [],
    totalTokens: 0,
    errors: [],
  };

  if (texts.length === 0) return output;

  for (const batch of chunkWithOffset(texts, batchSize)) {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const result = await requestEmbeddingBatch({
          texts: batch.values,
          apiKey,
          offset: batch.offset,
          model,
          endpoint,
          logger,
        });

        output.results.push(...result.results);
        output.errors.push(...result.errors);
        output.totalTokens += result.totalTokens;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        logger.error(
          `[embedding] batchOffset=${batch.offset} batchSize=${batch.values.length} attempt=${attempt}/${maxRetries} failed: ${sanitizeErrorMessage(error)}`,
        );

        if (attempt < maxRetries) {
          await sleep(1000 * 2 ** (attempt - 1));
        }
      }
    }

    if (lastError) {
      const message = sanitizeErrorMessage(lastError);
      for (let relativeIndex = 0; relativeIndex < batch.values.length; relativeIndex += 1) {
        const index = batch.offset + relativeIndex;
        logger.warn(`[embedding] itemIndex=${index} error=${message}`);
        output.errors.push({ index, error: message });
      }
    }
  }

  output.results.sort((a, b) => a.index - b.index);
  output.errors.sort((a, b) => a.index - b.index);
  return output;
}
