import type { Metadata } from "next";
import { isSafeHttpUrl, plainTextFromMarkdown } from "@/components/reader/reader-links";

let warnedMissingOrigin = false;

export async function buildArticleMetadata(input: {
  siteUrl: string | null;
  masthead: string;
  date: string;
  id: string;
  title: string;
  summary: string;
  sourceUrl: string | null;
  resolveOgImage: (url: string, options: { budgetMs: number }) => Promise<string | null>;
}): Promise<Metadata> {
  const title = `${input.title} | ${input.masthead}`;
  const description = Array.from(plainTextFromMarkdown(input.summary)).slice(0, 160).join("");
  const origin = input.siteUrl ? new URL(input.siteUrl).origin : null;
  const canonical = origin ? `${origin}/a/${input.date}/${input.id}` : undefined;
  let image: string | undefined;
  if (origin) {
    image = `${origin}/og-default.png`;
    if (input.sourceUrl && isSafeHttpUrl(input.sourceUrl)) {
      try {
        image = (await input.resolveOgImage(input.sourceUrl, { budgetMs: 1500 })) ?? image;
      } catch {
        // Share-card enrichment must never turn a readable article into a 500.
      }
    }
  } else if (!warnedMissingOrigin) {
    warnedMissingOrigin = true;
    console.warn("[article] set NEWSPAPER_SITE_URL for share cards");
  }
  return {
    title,
    description,
    ...(origin ? { metadataBase: new URL(origin), alternates: { canonical } } : { robots: { index: false, follow: false } }),
    openGraph: {
      type: "article", locale: "ja_JP", siteName: input.masthead,
      title: input.title, description, publishedTime: input.date,
      ...(canonical ? { url: canonical } : {}),
      ...(image ? { images: [image] } : {}),
    },
    twitter: { card: "summary_large_image", title: input.title, description, ...(image ? { images: [image] } : {}) },
  };
}
