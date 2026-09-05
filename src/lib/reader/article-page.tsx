import React from "react";
import { ArticleThumbnail } from "@/components/reader/ArticleThumbnail";
import { XFollowButton } from "@/components/reader/XFollowButton";
import { ArticleAiMenu } from "@/components/reader/ArticleAiMenu";
import { isSafeHttpUrl } from "@/components/reader/reader-links";
import type { PoweredBy, SourceRepoLink } from "@/lib/masthead";
import { formatEditionDateLabel } from "./edition-nav";
import { renderMarkdown } from "./markdown-render";

export function ArticlePage({ masthead, poweredBy, sourceRepo, date, id, sectionTitle, title, summary, sourceUrl, imageUrl, xFollowHandle, articleCount }: {
  masthead: string;
  poweredBy: PoweredBy | null;
  sourceRepo: SourceRepoLink | null;
  date: string;
  id: string;
  sectionTitle: string;
  title: string;
  summary: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  xFollowHandle: string | null;
  articleCount: number;
}) {
  const credit = poweredBy && isSafeHttpUrl(poweredBy.url) ? poweredBy : null;
  const source = sourceRepo && isSafeHttpUrl(sourceRepo.url) ? sourceRepo : null;

  const safeSourceUrl = sourceUrl && isSafeHttpUrl(sourceUrl) ? sourceUrl : null;
  let hostname: string | null = null;
  if (safeSourceUrl) {
    try {
      hostname = new URL(safeSourceUrl).hostname.replace(/^www\./, "");
    } catch {
      // Omit the hostname if the source cannot be parsed.
    }
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8 md:px-6 md:py-10">
        <header className="border-b-4 border-ink pb-5">
          <a href="/calendar" className="font-wired-serif text-wired-display-md">{masthead}</a>
          <p className="mt-4 font-sans text-wired-meta text-ink/70">{formatEditionDateLabel(date)} · {sectionTitle}</p>
        </header>
        <article className="border border-hairline p-5 md:p-8">
          <h1 className="font-wired-serif text-wired-display-sm md:text-wired-display-md lg:text-wired-display-lg leading-tight md:leading-tight lg:leading-tight">{title}</h1>
          {imageUrl && isSafeHttpUrl(imageUrl) ? <ArticleThumbnail src={imageUrl} /> : null}
          <div className="mt-6">{renderMarkdown(summary)}</div>
          <div className="mt-6"><ArticleAiMenu title={title} sourceUrl={sourceUrl} summary={summary} anchorId={`article-${date}-${id}`} /></div>
          {xFollowHandle || safeSourceUrl ? (
            <div className="mt-8 flex flex-col items-center gap-4">
              {xFollowHandle ? <XFollowButton handle={xFollowHandle} /> : null}
              {safeSourceUrl ? <a href={safeSourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center border border-ink bg-ink px-6 py-3 font-sans text-wired-eyebrow font-bold uppercase text-paper hover:opacity-90">記事を確認する</a> : null}
              {hostname ? <span className="font-sans text-wired-meta text-ink/60">{hostname}</span> : null}
            </div>
          ) : null}
        </article>
        <nav className="flex flex-col gap-3 sm:flex-row sm:flex-wrap" aria-label="紙面へ移動">
          <a href={`/calendar?date=${date}`} className="border border-ink bg-ink px-4 py-3 text-center font-sans font-bold text-paper">{`この日の紙面を読む（他 ${articleCount - 1} 本）`}</a>
          <a href="/calendar" className="border border-ink px-4 py-3 text-center font-sans">最新号</a>
        </nav>
        {credit || source ? (
          <footer className="border-t border-hairline pt-4 font-sans text-wired-meta text-ink/60">
            {credit ? <>Powered by <a href={credit.url} target="_blank" rel="noopener noreferrer" className="underline">{credit.label}</a></> : null}
            {credit && source ? " · " : null}
            {source ? <>Source: <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline">{source.label}</a></> : null}
          </footer>
        ) : null}
      </div>
    </main>
  );
}
