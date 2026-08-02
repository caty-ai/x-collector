import { PrismaClient } from "@prisma/client";
import Parser from "rss-parser";
import { userAgent } from "../lib/branding";
import { validateSafeHttpUrl } from "../lib/net/safe-fetch";

const prisma = new PrismaClient();
const parser = new Parser({
  timeout: 15_000,
  headers: {
    "User-Agent": userAgent(),
  },
});

interface CollectorCounters {
  sources: number;
  errors: number;
  total: number;
}

/**
 * Normalize a URL for dedup: strip utm_*, fbclid, gclid, etc.
 * Also resolve Google redirect URLs.
 */
function normalizeUrl(raw: string): string {
  try {
    // Resolve Google redirect: https://www.google.com/url?...&url=REAL_URL
    const parsed = new URL(raw);
    if (
      parsed.hostname.includes("google.com") &&
      parsed.pathname === "/url" &&
      parsed.searchParams.has("url")
    ) {
      raw = parsed.searchParams.get("url")!;
    }

    const url = new URL(raw);
    // Strip tracking params
    const stripParams = [
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "fbclid", "gclid", "ref", "source",
    ];
    for (const p of stripParams) url.searchParams.delete(p);
    // Remove trailing slash for consistency
    let out = url.toString();
    if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
    return out;
  } catch {
    return raw;
  }
}

export async function collectAlerts(): Promise<CollectorCounters> {
  const sources = await prisma.alertSource.findMany({ where: { active: true } });
  console.log(`\n--- Collecting Google Alerts: ${sources.length} active sources ---`);

  const run = await prisma.run.create({ data: { kind: "alert_collect" } });
  let total = 0;
  let errors = 0;

  for (const source of sources) {
    try {
      // Skip if fetched recently (within fetchIntervalHours)
      if (source.lastFetchedAt) {
        const elapsedMs = Date.now() - source.lastFetchedAt.getTime();
        const intervalMs = source.fetchIntervalHours * 3600_000;
        if (elapsedMs < intervalMs) {
          console.log(`Skipping "${source.name}" (fetched ${Math.round(elapsedMs / 60_000)}m ago, interval: ${source.fetchIntervalHours}h)`);
          continue;
        }
      }

      console.log(`Fetching alerts for "${source.name}"...`);
      // Best-effort SSRF pre-check only: rss-parser performs its own fetch, so DNS can change
      // after validation until parseURL is refactored to use pinned requests.
      await validateSafeHttpUrl(source.feedUrl, { timeoutMs: 15_000 });
      const feed = await parser.parseURL(source.feedUrl);

      let count = 0;
      const items = feed.items.slice(0, source.maxItemsPerFetch);

      for (const item of items) {
        const rawLink = item.link || item.guid || "";
        if (!rawLink) continue;

        const articleUrl = normalizeUrl(rawLink);
        const title = (item.title || "").replace(/<[^>]*>/g, "").trim();
        const snippet = (item.contentSnippet || item.content || "")
          .replace(/<[^>]*>/g, "")
          .trim()
          .slice(0, 1000);

        let publishedAt: Date | null = null;
        if (item.pubDate || item.isoDate) {
          const d = new Date(item.isoDate || item.pubDate!);
          if (!isNaN(d.getTime())) publishedAt = d;
        }

        try {
          await prisma.alertEntry.upsert({
            where: {
              sourceId_articleUrl: { sourceId: source.id, articleUrl },
            },
            create: {
              sourceId: source.id,
              title,
              snippet: snippet || null,
              articleUrl,
              rawLink: rawLink !== articleUrl ? rawLink : null,
              publishedAt,
              raw: item as any,
            },
            update: {
              title,
              snippet: snippet || null,
              publishedAt,
              raw: item as any,
            },
          });
          count++;
        } catch (e: any) {
          // Skip individual item errors (e.g. constraint violations)
          if (!e.code || e.code !== "P2002") {
            console.warn(`  Skipping item: ${e.message}`);
          }
        }
      }
      // Update lastFetchedAt
      await prisma.alertSource.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date() },
      });

      console.log(`  Upserted ${count} entries for "${source.name}"`);
      total += count;
    } catch (err: any) {
      console.error(`  Error for "${source.name}":`, err.message);
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

  console.log(`Alert run #${run.id} complete: ${total} entries, ${errors} errors`);
  await prisma.$disconnect();
  return { sources: sources.length, errors, total };
}

// CLI entry
if (require.main === module) {
  collectAlerts()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Fatal:", e);
      process.exit(1);
    });
}
