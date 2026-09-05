import type { MetadataRoute } from "next";
import { isNewspaperPublic } from "@/lib/auth/public-newspaper";
import { resolveSiteUrl } from "@/lib/reader/edition-meta";

export const dynamic = "force-dynamic";

export function buildRobots({ isPublic, siteUrl }: {
  isPublic: boolean;
  siteUrl: string | null;
}): MetadataRoute.Robots {
  if (!isPublic || !siteUrl) {
    return { rules: [{ userAgent: "*", disallow: ["/"] }] };
  }
  return {
    rules: [{ userAgent: "*", allow: ["/a/", "/calendar", "/sitemap.xml", "/og-default.png"], disallow: ["/"] }],
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
  };
}

export default function robots(): MetadataRoute.Robots {
  return buildRobots({ isPublic: isNewspaperPublic(), siteUrl: resolveSiteUrl() });
}
