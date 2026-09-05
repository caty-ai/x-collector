import React from "react";
import { notFound, redirect } from "next/navigation";
import { isSafeHttpUrl } from "@/components/reader/reader-links";
import { PUBLIC_ARTICLE_PATH_RE } from "@/lib/auth/public-paths";
import { resolveArticleOgImage } from "@/lib/bff/og-image";
import { getMasthead, getPoweredBy, getSourceRepoLink, getXFollowHandle } from "@/lib/masthead";
import { ARTICLE_ID_RE, extractSourceUrl } from "@/lib/reader/article-id";
import { buildArticleMetadata } from "@/lib/reader/article-meta";
import { ArticlePage } from "@/lib/reader/article-page";
import { resolveSiteUrl } from "@/lib/reader/edition-meta";
import { isAcceptablePublicDate } from "@/lib/reader/edition-nav";
import { loadPublicEdition } from "@/lib/reader/public-edition-loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ArticleRouteProps = { params: { date: string; id: string }; searchParams?: Record<string, string | string[] | undefined> };
const warnTimestamps: number[] = [];

function validateParams(date: string, id: string): void {
  if (!isAcceptablePublicDate(date) || !ARTICLE_ID_RE.test(id) || !PUBLIC_ARTICLE_PATH_RE.test(`/a/${date}/${id}`)) notFound();
}

function warnUnknownId(date: string): void {
  const now = Date.now();
  while (warnTimestamps.length && warnTimestamps[0] <= now - 60_000) warnTimestamps.shift();
  if (warnTimestamps.length >= 10) return;
  warnTimestamps.push(now);
  console.warn("[article] unknown id", { date });
}

export async function generateMetadata({ params }: ArticleRouteProps) {
  validateParams(params.date, params.id);
  const loaded = await loadPublicEdition(params.date);
  if (!loaded) notFound();
  const selected = loaded.index.byId.get(params.id);
  if (!selected) return { title: getMasthead(), robots: { index: false, follow: false } };
  return buildArticleMetadata({
    siteUrl: resolveSiteUrl(), masthead: getMasthead(), date: params.date, id: params.id,
    title: selected.article.title, summary: selected.article.body,
    sourceUrl: extractSourceUrl(selected.article.source), resolveOgImage: resolveArticleOgImage,
  });
}

export default async function ArticleLandingPage({ params }: ArticleRouteProps) {
  validateParams(params.date, params.id);
  const loaded = await loadPublicEdition(params.date);
  if (!loaded) notFound();
  const selected = loaded.index.byId.get(params.id);
  if (!selected) {
    warnUnknownId(params.date);
    redirect(`/calendar?date=${params.date}&from=a`);
  }
  const sourceUrl = extractSourceUrl(selected.article.source);
  let imageUrl: string | null = null;
  if (sourceUrl && isSafeHttpUrl(sourceUrl)) {
    try {
      imageUrl = await resolveArticleOgImage(sourceUrl, { budgetMs: 1500 });
    } catch {
      // Image enrichment must never prevent the article from rendering.
    }
  }
  return <ArticlePage masthead={getMasthead()} poweredBy={getPoweredBy()} sourceRepo={getSourceRepoLink()} date={params.date} id={params.id}
    sectionTitle={selected.sectionTitle} title={selected.article.title} summary={selected.article.body}
    sourceUrl={sourceUrl} imageUrl={imageUrl} xFollowHandle={getXFollowHandle()} articleCount={loaded.articleCount} />;
}
