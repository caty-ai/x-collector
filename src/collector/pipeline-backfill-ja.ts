import { PrismaClient } from "@prisma/client";
import { DEFAULT_LLM_MODEL } from "../lib/pipeline/classify-llm";
import { sanitizeToWellFormed } from "../lib/pipeline/text-sanitize";

const DEFAULT_LIMIT = 50;
const DEFAULT_MAX_BODY_CHARS = 4000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_OUTPUT_TOKENS = 800;
const OPENROUTER_CHAT_TIMEOUT_MS = 120_000;

const JSON_SCHEMA = {
  name: "xcollector_backfill_ja_copy",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      titleJa: { type: ["string", "null"] },
      summaryJa: { type: ["string", "null"] },
    },
    required: ["titleJa", "summaryJa"],
  },
};

interface CliOptions {
  dryRun: boolean;
  limit?: number;
  model?: string;
  maxBodyChars?: number;
  maxRetries?: number;
}

interface BackfillResult {
  titleJa: string | null;
  summaryJa: string | null;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (token.startsWith("--limit=")) {
      options.limit = parsePositiveInt(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--limit") {
      options.limit = parsePositiveInt(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token.startsWith("--model=")) {
      options.model = token.split("=", 2)[1] || undefined;
      continue;
    }

    if (token === "--model") {
      options.model = argv[i + 1] || undefined;
      i += 1;
      continue;
    }

    if (token.startsWith("--max-body-chars=")) {
      options.maxBodyChars = parsePositiveInt(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--max-body-chars") {
      options.maxBodyChars = parsePositiveInt(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token.startsWith("--max-retries=")) {
      options.maxRetries = parsePositiveInt(token.split("=", 2)[1]);
      continue;
    }

    if (token === "--max-retries") {
      options.maxRetries = parsePositiveInt(argv[i + 1]);
      i += 1;
      continue;
    }
  }

  return options;
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

function normalizeText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.replace(/\s+/g, " ").trim();
  return value || null;
}

function extractJson(raw: string): unknown {
  const trimmed = (raw || "").trim();
  if (!trimmed) throw new Error("LLM response content is empty");

  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error(`LLM response is not valid JSON: ${trimmed.slice(0, 240)}`);
  }
}

function normalizeResult(raw: unknown): BackfillResult {
  const obj = (raw || {}) as Record<string, unknown>;
  return {
    titleJa: normalizeText(obj.titleJa),
    summaryJa: normalizeText(obj.summaryJa),
  };
}

async function callOpenRouterForJaCopy(params: {
  apiKey: string;
  model: string;
  maxBodyChars: number;
  maxRetries: number;
  item: {
    id: string;
    platform: string;
    title: string | null;
    body: string | null;
    url: string;
    sourceRef: string | null;
    publishedAt: Date | null;
  };
}): Promise<BackfillResult> {
  const { apiKey, model, maxBodyChars, maxRetries, item } = params;
  const userPayload = {
    platform: item.platform,
    title: item.title || "",
    body: (item.body || "").slice(0, maxBodyChars),
    url: item.url,
    sourceRef: item.sourceRef || null,
    publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
  };

  const body = {
    model,
    temperature: 0,
    max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
    response_format: {
      type: "json_schema",
      json_schema: JSON_SCHEMA,
    },
    messages: [
      {
        role: "system",
        content: [
          "You are localizing one article for a Japanese AI newsletter.",
          "Return JSON only.",
          "Return `titleJa` (Japanese headline) and `summaryJa` (2-3 sentence Japanese summary).",
          "If the article language is `ja`, summarize directly in Japanese. Otherwise translate to Japanese and summarize.",
          "Do not invent facts beyond the input. Do not translate the full article body.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(userPayload),
      },
    ],
  };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://localhost",
    "X-Title": "xcollector-backfill-ja-copy",
  };

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt += 1) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OPENROUTER_CHAT_TIMEOUT_MS),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`OpenRouter ${response.status}: ${JSON.stringify(payload).slice(0, 400)}`);
      }

      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error(`OpenRouter returned non-text content: ${JSON.stringify(content).slice(0, 200)}`);
      }

      return normalizeResult(extractJson(content));
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("OpenRouter request failed with unknown error");
}

async function main() {
  const prisma = new PrismaClient();
  const options = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(options.dryRun);
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : DEFAULT_LIMIT;
  const model = (options.model || DEFAULT_LLM_MODEL).trim();
  const maxBodyChars =
    options.maxBodyChars && options.maxBodyChars > 200
      ? Math.floor(options.maxBodyChars)
      : DEFAULT_MAX_BODY_CHARS;
  const maxRetries =
    options.maxRetries && options.maxRetries > 0
      ? Math.floor(options.maxRetries)
      : DEFAULT_MAX_RETRIES;

  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set");
    }

    const rows = await prisma.pipelineClassification.findMany({
      where: { OR: [{ titleJa: null }, { summaryJa: null }] },
      include: {
        pipelineItem: {
          select: {
            id: true,
            platform: true,
            title: true,
            body: true,
            url: true,
            sourceRef: true,
            publishedAt: true,
          },
        },
      },
      orderBy: [{ classifiedAt: "desc" }, { id: "desc" }],
      take: limit,
    });

    let processed = 0;
    let updated = 0;
    let failed = 0;

    for (const row of rows) {
      processed += 1;
      try {
        const result = await callOpenRouterForJaCopy({
          apiKey,
          model,
          maxBodyChars,
          maxRetries,
          item: row.pipelineItem,
        });

        const sanitizedTitleJa = result.titleJa === null ? null : sanitizeToWellFormed(result.titleJa);
        const sanitizedSummaryJa =
          result.summaryJa === null ? null : sanitizeToWellFormed(result.summaryJa);
        const replacedCount =
          (sanitizedTitleJa?.replacedCount || 0) + (sanitizedSummaryJa?.replacedCount || 0);
        if (replacedCount > 0) {
          console.warn(
            `[backfill-ja] classification=${row.id} item=${row.pipelineItemId} sanitized ill-formed code units before update: titleJa=${sanitizedTitleJa?.replacedCount || 0} summaryJa=${sanitizedSummaryJa?.replacedCount || 0}`,
          );
        }

        if (!dryRun) {
          await prisma.pipelineClassification.update({
            where: { id: row.id },
            data: {
              titleJa: sanitizedTitleJa?.result ?? null,
              summaryJa: sanitizedSummaryJa?.result ?? null,
            },
          });
          updated += 1;
        }

        console.log(
          `[backfill-ja] classification=${row.id} item=${row.pipelineItemId} dryRun=${dryRun} titleJa=${result.titleJa ? "yes" : "null"} summaryJa=${result.summaryJa ? "yes" : "null"}`,
        );
      } catch (error) {
        failed += 1;
        console.warn(
          `[backfill-ja] classification=${row.id} item=${row.pipelineItemId} failed: ${sanitizeErrorMessage(error)}`,
        );
      }
    }

    console.log("\n=== Pipeline JA backfill summary ===");
    console.log(
      JSON.stringify(
        {
          dryRun,
          limit,
          model,
          scanned: rows.length,
          processed,
          updated,
          failed,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Fatal backfill-ja error:", error);
  process.exit(1);
});
