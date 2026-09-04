"use client";

import { useSearchParams } from "next/navigation";

import { Rule } from "@/components/ui/Rule";
import {
  buildEditionPath,
  formatEditionDateLabel,
  resolveEditionDate,
  shiftIsoDate,
} from "@/lib/reader/edition-nav";

export default function EditionNav({ initialDate }: { initialDate: string }) {
  const raw = useSearchParams().get("date");
  const date = resolveEditionDate(raw, new Date(), initialDate);

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
