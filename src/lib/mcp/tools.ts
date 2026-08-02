import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PRODUCT_SLUG } from "../branding";

const selfBaseUrl =
  process.env.MCP_SELF_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

async function fetchUpstream(
  path: string,
  apiKey: string | undefined,
): Promise<{ text: string } | ReturnType<typeof errorResult>> {
  try {
    const response = await fetch(`${selfBaseUrl}${path}`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();

    if (!response.ok) {
      return errorResult(`Upstream request failed (${response.status}): ${text.replace(/\s+/g, " ").trim().slice(0, 400) || "(empty response)"}`);
    }

    return { text };
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      return errorResult("Upstream request timed out after 30s");
    }

    return errorResult(
      `Upstream request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const dateTimeSchema = z.string().datetime({ offset: true });

export function registerMcpTools(server: McpServer): void {
  server.registerTool(
    "search_feed",
    {
      title: "Search family feed",
      description:
        `Search the ${PRODUCT_SLUG} family feed. Pagination is an honest cursor: while meta.truncated is true, call this tool again with since=meta.nextSince; stop only when meta.truncated is false. Do not reuse an older cursor or infer completion from the item count.`,
      inputSchema: {
        tags: z.string().optional(),
        keywords: z.string().optional(),
        category: z.string().optional(),
        platform: z.string().optional(),
        date: dateSchema.optional(),
        from: dateTimeSchema.optional(),
        to: dateTimeSchema.optional(),
        since: dateTimeSchema.optional(),
        limit: z.number().int().min(1).max(500).default(100),
        dedup: z.boolean().optional(),
      },
    },
    async (input) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) query.set(key, String(value));
      }

      const result = await fetchUpstream(
        `/api/family-feed${query.size ? `?${query.toString()}` : ""}`,
        process.env.FAMILY_FEED_API_KEY,
      );
      if ("isError" in result) return result;

      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(JSON.parse(result.text)) }] };
      } catch {
        return errorResult("Upstream request returned invalid JSON");
      }
    },
  );

  server.registerTool(
    "get_daily_news",
    {
      title: "Get latest daily news edition",
      description: "Get the latest newsletter edition, optionally for a JST calendar date.",
      inputSchema: {
        date: dateSchema.optional(),
        format: z.enum(["json", "markdown"]).default("markdown"),
        includeItems: z.boolean().optional(),
      },
    },
    async ({ date, format, includeItems }) => {
      const query = new URLSearchParams();
      if (date) query.set("date", date);
      if (format === "markdown") query.set("format", "markdown");
      if (includeItems !== undefined) query.set("includeItems", includeItems ? "1" : "0");

      const newsletterApiKey =
        process.env.NEWSLETTER_API_KEY || process.env.DIGEST_API_KEY || process.env.FEED_API_KEY;
      const result = await fetchUpstream(
        `/api/newsletter-editions/latest${query.size ? `?${query.toString()}` : ""}`,
        newsletterApiKey,
      );
      if ("isError" in result) return result;

      if (format === "markdown") {
        return { content: [{ type: "text" as const, text: result.text }] };
      }

      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(JSON.parse(result.text)) }] };
      } catch {
        return errorResult("Upstream request returned invalid JSON");
      }
    },
  );
}
