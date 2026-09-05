import type { MetadataRoute } from "next";
import { isNewspaperPublic } from "@/lib/auth/public-newspaper";
import { resolveSiteUrl } from "@/lib/reader/edition-meta";
import { shiftIsoDate, todayJstIsoDate } from "@/lib/reader/edition-nav";
import { loadPublicEdition } from "@/lib/reader/public-edition-loader";

export const dynamic = "force-dynamic";

// Kept small (≤ the loader's positive cache, 16 today) so one sitemap request fits
// one cache generation; if either number changes, revisit both.
export const SITEMAP_DAYS = 7;
export const SITEMAP_BUDGET_MS = 5_000;

export async function buildSitemapEntries({ isPublic, siteUrl, dates, load, now = Date.now }: {
  isPublic: boolean;
  siteUrl: string | null;
  dates: readonly string[];
  load: typeof loadPublicEdition;
  now?: () => number;
}): Promise<MetadataRoute.Sitemap> {
  if (!isPublic || !siteUrl) return [];
  const entries: MetadataRoute.Sitemap = [];
  let skipped = 0;
  const startedAt = now();
  for (const [index, date] of dates.entries()) {
    if (now() - startedAt >= SITEMAP_BUDGET_MS) {
      skipped += dates.length - index;
      break;
    }
    try {
      const loaded = await load(date);
      if (!loaded) continue;
      const dailyEntries = Array.from(loaded.index.byId.keys(), (id) => ({
        url: new URL(`/a/${date}/${id}`, siteUrl).toString(),
        lastModified: new Date(`${date}T00:00:00+09:00`),
      }));
      entries.push(...dailyEntries);
    } catch {
      skipped++;
    }
  }
  if (skipped > 0) {
    console.warn("[sitemap] skipped %d of %d editions", skipped, dates.length);
  }
  return entries;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const isPublic = isNewspaperPublic();
  const siteUrl = resolveSiteUrl();
  if (!isPublic || !siteUrl) return [];
  const today = todayJstIsoDate();
  return buildSitemapEntries({
    isPublic,
    siteUrl,
    dates: Array.from({ length: SITEMAP_DAYS }, (_, offset) => shiftIsoDate(today, -offset)),
    load: loadPublicEdition,
  });
}
