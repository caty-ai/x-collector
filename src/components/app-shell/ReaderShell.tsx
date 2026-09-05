import { Suspense } from "react";

import EditionNav from "@/components/app-shell/EditionNav";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Headline } from "@/components/ui/Headline";
import { Rule } from "@/components/ui/Rule";
import type { PoweredBy, SourceRepoLink } from "@/lib/masthead";
import {
  buildEditionPath,
  formatEditionDateLabel,
  shiftIsoDate,
} from "@/lib/reader/edition-nav";

type ReaderShellProps = {
  title: string;
  description: string;
  productName: string;
  editionDate: string;
  accessLabel: string;
  poweredBy?: PoweredBy | null;
  sourceRepo: SourceRepoLink | null;
  children?: React.ReactNode;
};

function EditionNavStatic({ date }: { date: string }) {
  return (
    <>
      <span className="font-sans text-wired-meta text-ink/60">
        {formatEditionDateLabel(date)}
      </span>
      <div className="mx-auto mt-6 max-w-4xl">
        <Rule />
        <div className="flex flex-wrap items-center justify-center gap-4 px-2 py-3 font-sans text-wired-eyebrow font-bold uppercase text-ink">
          <a
            href={buildEditionPath(shiftIsoDate(date, -1))}
            rel="prev"
            className="border border-ink bg-paper px-3 py-2"
          >
            前日
          </a>
          <a href="#reader-calendar" className="border-b border-ink pb-1">
            カレンダー
          </a>
          <a
            href={buildEditionPath(shiftIsoDate(date, 1))}
            rel="next"
            className="border border-ink bg-paper px-3 py-2"
          >
            翌日
          </a>
        </div>
        <Rule className="bg-ink" />
      </div>
    </>
  );
}

export default function ReaderShell({
  title,
  description,
  productName,
  editionDate,
  accessLabel,
  poweredBy,
  sourceRepo,
  children,
}: ReaderShellProps) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col">
        <header className="bg-paper">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
            <div className="flex flex-wrap items-center gap-5">
              <Eyebrow>{productName}</Eyebrow>
              <span className="border border-ink px-3 py-1 font-sans text-wired-eyebrow font-bold uppercase text-ink">
                {accessLabel}
              </span>
            </div>
          </div>

          <div className="px-5 py-8 text-center md:py-12">
            <Headline level="hero" as="h1" className="break-words text-center">
              {title}
            </Headline>
            <p className="mx-auto mt-3 max-w-3xl font-sans text-wired-eyebrow font-bold uppercase text-ink">
              {description}
            </p>

            <Suspense fallback={<EditionNavStatic date={editionDate} />}>
              <EditionNav initialDate={editionDate} />
            </Suspense>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 lg:px-8">{children}</main>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-5 py-5 font-sans text-wired-meta text-ink/60">
          <span>{title} / {accessLabel}</span>
          {poweredBy ? (
            <a href={poweredBy.url} rel="noopener noreferrer" target="_blank">
              {poweredBy.label}
            </a>
          ) : null}
          {sourceRepo ? (
            <span>
              Source:{" "}
              <a href={sourceRepo.url} rel="noopener noreferrer" target="_blank">
                {sourceRepo.label}
              </a>
            </span>
          ) : null}
          <span className="border border-ink px-3 py-1 font-sans text-wired-eyebrow font-bold uppercase text-ink">
            {title}
          </span>
        </footer>
      </div>
    </div>
  );
}
