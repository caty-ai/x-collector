import type { MetadataRoute } from "next";
import { isNewspaperPublic } from "@/lib/auth/public-newspaper";
import { resolveSiteUrl } from "@/lib/reader/edition-meta";
import { shiftIsoDate, todayJstIsoDate } from "@/lib/reader/edition-nav";
import { loadPublicEdition } from "@/lib/reader/public-edition-loader";

export const dynamic = "force-dynamic";

// Must stay <= the loader's positive cache size (16) to fit one cache generation.
export const SITEMAP_DAYS = 7;

export async function buildSitemapEntries({ isPublic, siteUrl, dates, load }: {
  isPublic: boolean;
  siteUrl: string | null;
  dates: readonly string[];
  load: typeof loadPublicEdition;
}): Promise<MetadataRoute.Sitemap> {
  if (!isPublic || !siteUrl) return [];
  const entries: MetadataRoute.Sitemap = [];
  let warned = false;
  for (const date of dates) {
    try {
      const loaded = await load(date);
      if (!loaded) continue;
      const dailyEntries = Array.from(loaded.index.byId.keys(), (id) => ({
        url: new URL(`/a/${date}/${id}`, siteUrl).toString(),
        lastModified: new Date(`${date}T00:00:00+09:00`),
      }));
      entries.push(...dailyEntries);
    } catch {
      if (!warned) {
        warned = true;
        console.warn("[sitemap] skipped unavailable edition");
      }
    }
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
