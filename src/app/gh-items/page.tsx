"use client";

import { useEffect, useState } from "react";
import Nav from "../../components/Nav";

interface GhItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  url: string;
  author: string | null;
  tagName: string | null;
  stars: number | null;
  forks: number | null;
  language: string | null;
  topics: string[];
  publishedAt: string | null;
  source: { name: string; type: string };
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function GhItemsPage() {
  const [items, setItems] = useState<GhItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 30;

  const load = () =>
    fetch(`/api/gh-items?limit=${limit}&page=${page}`)
      .then((r) => r.json())
      .then((d) => { setItems(d.items || []); setTotal(d.total || 0); });

  useEffect(() => { load(); }, [page]);

  const totalPages = Math.ceil(total / limit);

  return (
    <main className="max-w-4xl mx-auto px-5 py-8">
      <Nav />

      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">🐙 GitHub Items</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {total} items from repository releases and trending searches
        </p>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="border border-hairline bg-paper p-4">
            <div className="flex justify-between items-start">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm">
                  {item.type === "release" ? "🏷️" : "⭐"}{" "}
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {item.title}
                  </a>
                </h3>
                {item.body && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {item.body.slice(0, 200)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-muted-foreground">
                  <span className="border border-hairline px-1.5 py-0.5 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">{item.source.name}</span>
                  {item.tagName && <span className="border border-hairline px-1.5 py-0.5 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">{item.tagName}</span>}
                  {item.stars != null && <span>⭐ {item.stars.toLocaleString()}</span>}
                  {item.forks != null && <span>🍴 {item.forks.toLocaleString()}</span>}
                  {item.language && <span className="border border-hairline px-1.5 py-0.5 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">{item.language}</span>}
                  {item.author && <span>by {item.author}</span>}
                  {item.publishedAt && <span>{timeAgo(item.publishedAt)}</span>}
                </div>
                {item.topics.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {item.topics.slice(0, 6).map((t) => (
                      <span key={t} className="border border-hairline px-1.5 py-0.5 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="ml-2 whitespace-nowrap font-sans text-wired-meta uppercase tracking-widest text-link hover:underline">
                Open ↗
              </a>
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="border border-hairline bg-paper px-3 py-1 font-sans text-wired-meta font-bold uppercase text-ink disabled:opacity-50">← Prev</button>
          <span className="px-3 py-1 text-sm">{page} / {totalPages}</span>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="border border-hairline bg-paper px-3 py-1 font-sans text-wired-meta font-bold uppercase text-ink disabled:opacity-50">Next →</button>
        </div>
      )}
    </main>
  );
}
