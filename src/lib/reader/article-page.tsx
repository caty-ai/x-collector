import React from "react";
import { ArticleAiMenu } from "@/components/reader/ArticleAiMenu";
import { isSafeHttpUrl } from "@/components/reader/reader-links";
import type { PoweredBy, SourceRepoLink } from "@/lib/masthead";
import { formatEditionDateLabel } from "./edition-nav";
import { renderMarkdown } from "./markdown-render";

export function ArticlePage({ masthead, poweredBy, sourceRepo, date, id, sectionTitle, title, summary, sourceUrl, articleCount }: {
  masthead: string;
  poweredBy: PoweredBy | null;
  sourceRepo: SourceRepoLink | null;
  date: string;
  id: string;
  sectionTitle: string;
  title: string;
  summary: string;
  sourceUrl: string | null;
  articleCount: number;
}) {
  const credit = poweredBy && isSafeHttpUrl(poweredBy.url) ? poweredBy : null;
  const source = sourceRepo && isSafeHttpUrl(sourceRepo.url) ? sourceRepo : null;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8 md:px-6 md:py-10">
        <header className="border-b-4 border-ink pb-5">
          <a href="/calendar" className="font-wired-serif text-wired-display-md">{masthead}</a>
          <p className="mt-4 font-sans text-wired-meta text-ink/70">{formatEditionDateLabel(date)} · {sectionTitle}</p>
        </header>
        <article className="border border-hairline p-5 md:p-8">
          <h1 className="font-wired-serif text-wired-display-lg leading-tight">{title}</h1>
          <div className="mt-6">{renderMarkdown(summary)}</div>
          <div className="mt-6"><ArticleAiMenu title={title} sourceUrl={sourceUrl} summary={summary} anchorId={`article-${date}-${id}`} /></div>
          {sourceUrl && isSafeHttpUrl(sourceUrl) ? (
            <p className="mt-6 font-sans text-sm text-ink/70">引用元 <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-link underline underline-offset-2">{sourceUrl}</a></p>
          ) : null}
        </article>
        <nav className="flex flex-wrap gap-3" aria-label="紙面へ移動">
          <a href={`/calendar?date=${date}`} className="border border-ink bg-ink px-4 py-3 font-sans font-bold text-paper">{`この日の紙面を読む（他 ${articleCount - 1} 本）`}</a>
          <a href="/calendar" className="border border-ink px-4 py-3 font-sans">最新号</a>
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
