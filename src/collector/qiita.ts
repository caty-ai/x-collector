import { Prisma, PrismaClient } from "@prisma/client";
import { userAgent } from "../lib/branding";

const prisma = new PrismaClient();

interface CollectorCounters {
  sources: number;
  errors: number;
  total: number;
}

interface QiitaRawItem {
  id?: string;
  title?: string;
  body?: string;
  url?: string;
  user?: {
    id?: string;
    name?: string;
  };
  likes_count?: number;
  stocks_count?: number;
  comments_count?: number;
  tags?: { name?: string }[];
  created_at?: string;
}

/**
 * Extract tag name from a Qiita URL.
 * e.g. "https://qiita.com/tags/ChatGPT" -> "ChatGPT"
 * e.g. "ChatGPT" -> "ChatGPT"
 */
export function extractTag(url: string): string {
  try {
    const match = url.match(/qiita\.com\/tags\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : url.trim();
  } catch {
    return url.trim();
  }
}

const DEFAULT_MAX_ITEMS = 50;
const QIITA_API_URL = "https://qiita.com/api/v2";
const COLLECTOR_FETCH_TIMEOUT_MS = 30_000;

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertItem(item: QiitaRawItem, sourceId: number) {
  const itemId = item.id;
  if (!itemId) return null;

  const userName = item.user?.name || item.user?.id || null;
  const userId = item.user?.id || null;
  const tags = (item.tags || []).map((t) => t.name).filter(Boolean) as string[];

  return prisma.qiitaItem.upsert({
    where: { id: itemId },
    create: {
      id: itemId,
      sourceId,
      title: item.title || "",
      body: item.body || null,
      url: item.url || "",
      userId,
      userName,
      likesCount: item.likes_count || 0,
      stocksCount: item.stocks_count || 0,
      commentsCount: item.comments_count || 0,
      tags,
      publishedAt: item.created_at ? new Date(item.created_at) : null,
    },
    update: {
      title: item.title || "",
      body: item.body || null,
      likesCount: item.likes_count || 0,
      stocksCount: item.stocks_count || 0,
      commentsCount: item.comments_count || 0,
      tags,
      fetchedAt: new Date(),
    },
  });
}

/**
 * Fetch items for a single source.
 * Returns { upserted, error? }
 */
export async function fetchSourceItems(
  source: { id: number; name: string; tag: string; maxItems: number },
  maxItemsOverride?: number
): Promise<{ upserted: number; error?: string }> {
  const maxItems = maxItemsOverride ?? source.maxItems ?? DEFAULT_MAX_ITEMS;
  const perPage = Math.min(maxItems, 100);

  try {
    const apiUrl = `${QIITA_API_URL}/items?query=tag:${encodeURIComponent(source.tag)}&per_page=${perPage}`;

    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": userAgent(),
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(COLLECTOR_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errorMsg = `HTTP ${res.status}`;
      if (res.status === 429) {
        return { upserted: 0, error: "Rate limited (60 req/hour without auth). Please try again later." };
      }
      if (res.status === 404) {
        return { upserted: 0, error: "Tag not found or no articles." };
      }
      return { upserted: 0, error: errorMsg };
    }

    const items: QiitaRawItem[] = await res.json();

    if (!Array.isArray(items)) {
      return { upserted: 0, error: "Invalid response format" };
    }

    let upserted = 0;

    for (const item of items) {
      if (!item.id) continue;

      try {
        await upsertItem(item, source.id);
        upserted++;
      } catch (err) {
        console.error(`  [Qiita] Error upserting item ${item.id}:`, err);
      }

      // Respectful delay between upserts
      await delay(50);
    }

    // Update lastFetchedAt
    await prisma.qiitaSource.update({
      where: { id: source.id },
      data: { lastFetchedAt: new Date() },
    });

    return { upserted };
  } catch (err: any) {
    return { upserted: 0, error: err.message || "Unknown error" };
  }
}

export async function collectQiita(): Promise<CollectorCounters> {
  const sources = await prisma.qiitaSource.findMany({ where: { active: true } });
  console.log(`[Qiita] Found ${sources.length} active Qiita sources`);

  if (sources.length === 0) {
    console.log("[Qiita] No sources to collect");
    return { sources: 0, errors: 0, total: 0 };
  }

  const run = await prisma.run.create({ data: { kind: "qiita_collect" } });
  let total = 0;
  let errors = 0;

  for (const source of sources) {
    try {
      console.log(`[Qiita] Fetching items for "${source.name}" (tag: ${source.tag}, maxItems: ${source.maxItems})...`);
      const result = await fetchSourceItems(source);
      total += result.upserted;
      if (result.error) {
        console.error(`  [Qiita] Error: ${result.error}`);
        errors++;
      } else {
        console.log(`  [Qiita] Upserted ${result.upserted} items for "${source.name}"`);
      }
      // Respectful delay between sources (Qiita has rate limits)
      await delay(1000);
    } catch (err) {
      console.error(`  [Qiita] Error for "${source.name}":`, err);
      errors++;
    }
  }

  await prisma.run.update({
    where: { id: run.id },
    data: {
      endedAt: new Date(),
      status: errors ? "partial" : "done",
      meta: { total, errors },
    },
  });

  console.log(`[Qiita] Run #${run.id} complete: ${total} items, ${errors} errors`);
  await prisma.$disconnect();
  return { sources: sources.length, errors, total };
}

// CLI entry
if (require.main === module) {
  collectQiita()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Fatal:", e);
      process.exit(1);
    });
}
