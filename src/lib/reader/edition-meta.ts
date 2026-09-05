import type { Metadata } from "next";

export function resolveSiteUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  for (const value of [env.NEWSPAPER_SITE_URL, env.NEXTAUTH_URL]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (url.username || url.password) continue;
      return url.origin;
    } catch {
      // Try the fallback value.
    }
  }
  return null;
}

export function buildEditionMetadata(input: {
  masthead: string;
  tagline: string;
  date: string;
  siteUrl: string | null;
}): Metadata {
  const editionTitle = `${input.masthead} ${input.date}`;
  const absoluteEditionUrl = input.siteUrl
    ? new URL(`/calendar?date=${input.date}`, input.siteUrl).toString()
    : undefined;

  return {
    title: input.masthead,
    description: input.tagline,
    ...(input.siteUrl ? { metadataBase: new URL(input.siteUrl) } : {}),
    openGraph: {
      type: "article",
      locale: "ja_JP",
      siteName: input.masthead,
      title: editionTitle,
      description: input.tagline,
      ...(absoluteEditionUrl ? { url: absoluteEditionUrl } : {}),
      ...(input.siteUrl ? { images: [new URL("/og-default.png", input.siteUrl).toString()] } : {}),
    },
    twitter: {
      card: "summary",
      ...(input.siteUrl ? { images: [new URL("/og-default.png", input.siteUrl).toString()] } : {}),
      title: editionTitle,
      description: input.tagline,
    },
  };
}
