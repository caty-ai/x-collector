"use client";

import { isSafeHttpUrl } from "@/components/reader/reader-links";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { formatUtcToJstDate } from "@/lib/date-formatter";
import type { ProjectItem } from "@/lib/projects-shelf";

export default function ProjectsShelf({ title, items }: { title: string; items: ProjectItem[] }) {
  if (items.length === 0) return null;
  const featured = items.some((item) => item.kind === "featured");

  return (
    <section aria-label={title} className="border border-hairline bg-paper p-4">
      <Eyebrow>{title}</Eyebrow>
      <ul className={featured
        ? "mt-3 flex lg:flex-col overflow-x-auto snap-x snap-mandatory gap-4 [&>*]:snap-start [&>*]:shrink-0 [&>*]:w-[80%] lg:[&>*]:w-auto"
        : "mt-3 divide-y divide-hairline"}>
        {items.map((item, index) => {
          const href = item.kind === "featured" ? item.url ?? item.repoUrl : item.repoUrl;
          return (
            <li key={featured ? `${item.url ?? item.repo}-${index}` : item.repo} className={featured ? "min-w-0 space-y-1" : "space-y-1 py-3"}>
              {featured && item.imageUrl && isSafeHttpUrl(item.imageUrl) && (
                <div className="mb-2 aspect-[1200/630] overflow-hidden border border-hairline">
                  <img src={item.imageUrl} loading="lazy" decoding="async" referrerPolicy="no-referrer" alt="" className="h-full w-full object-cover" />
                </div>
              )}
              {isSafeHttpUrl(href) ? <a href={href} rel="noopener noreferrer" target="_blank" className="font-sans font-bold text-ink hover:underline">
                {item.name}
              </a> : <span className="font-sans font-bold text-ink">{item.name}</span>}
              {item.description && <p className="line-clamp-2 font-sans text-wired-meta text-ink/70">{item.description}</p>}
              {item.latestTag && (
                <p className="font-sans text-wired-meta text-ink/60">
                  {item.latestUrl && isSafeHttpUrl(item.latestUrl)
                    ? <a href={item.latestUrl} rel="noopener noreferrer" target="_blank" className="hover:underline">{item.latestTag}</a>
                    : item.latestTag}
                  {item.publishedAt && <> · <time dateTime={item.publishedAt}>{formatUtcToJstDate(item.publishedAt)}</time></>}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
