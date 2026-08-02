import { PrismaClient } from "@prisma/client";
import Nav from "../../components/Nav";

const prisma = new PrismaClient();
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function timeAgo(date: Date | null): string {
  if (!date) return "unknown";
  const diff = Date.now() - date.getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return date.toISOString().slice(0, 10);
}

export default async function FbPostsPage({
  searchParams,
}: {
  searchParams: { source?: string; tag?: string; page?: string };
}) {
  const sourceFilter = searchParams.source || "";
  const tagFilter = searchParams.tag || "";
  const page = Math.max(1, parseInt(searchParams.page || "1", 10));

  // Get all sources for filters
  const allSources = await prisma.fbSource.findMany({
    include: { _count: { select: { posts: true } } },
    orderBy: { name: "asc" },
  });
  const allTags = new Set<string>();
  for (const s of allSources) for (const t of s.tags || []) allTags.add(t);

  // If tag filter, find matching source IDs
  let tagSourceIds: number[] | undefined;
  if (tagFilter) {
    tagSourceIds = allSources
      .filter((s) => (s.tags || []).includes(tagFilter))
      .map((s) => s.id);
    if (tagSourceIds.length === 0) tagSourceIds = [-1];
  }

  // Build where clause
  const where: any = {};
  if (sourceFilter) {
    const src = allSources.find((s) => s.name === sourceFilter);
    if (src) where.sourceId = src.id;
  } else if (tagSourceIds) {
    where.sourceId = { in: tagSourceIds };
  }

  const totalCount = await prisma.fbPost.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const posts = await prisma.fbPost.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    skip: (safePage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: { source: true },
  });

  const totalPosts = await prisma.fbPost.count();

  function buildUrl(params: Record<string, string>) {
    const p = new URLSearchParams();
    const merged = { source: sourceFilter, tag: tagFilter, page: "1", ...params };
    if (merged.source) p.set("source", merged.source);
    if (merged.tag) p.set("tag", merged.tag);
    if (merged.page && merged.page !== "1") p.set("page", merged.page);
    if (params.tag !== undefined) p.delete("source");
    if (params.source !== undefined) p.delete("tag");
    const qs = p.toString();
    return qs ? `/fb-posts?${qs}` : "/fb-posts";
  }

  const sortedTags = [...allTags].sort();

  return (
    <main className="max-w-4xl mx-auto px-5 py-8">
      <Nav />

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Facebook Posts</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {totalPosts} posts collected from {allSources.length} sources
        </p>
      </div>

      {/* Controls */}
      <div className="space-y-4 mb-8">
        {/* Tags */}
        {sortedTags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground w-10">Tag</span>
            <a
              href={buildUrl({ tag: "" })}
              className={`inline-flex border px-3 py-1.5 font-sans text-wired-meta font-bold uppercase transition-colors ${
                !tagFilter && !sourceFilter ? "border-ink bg-ink text-paper" : "border-hairline bg-paper text-ink hover:border-ink"
              }`}
            >
              All
            </a>
            {sortedTags.map((t) => (
              <a
                key={t}
                href={buildUrl({ tag: t })}
                className={`inline-flex border px-3 py-1.5 font-sans text-wired-meta font-bold uppercase transition-colors ${
                  tagFilter === t
                    ? "border-ink bg-ink text-paper"
                    : "border-hairline bg-paper text-ink-soft hover:border-ink hover:text-ink"
                }`}
              >
                🏷 {t}
              </a>
            ))}
          </div>
        )}

        {/* Source */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground w-10">From</span>
          <a
            href={buildUrl({ source: "" })}
            className={`inline-flex border px-3 py-1.5 font-sans text-wired-meta font-bold uppercase transition-colors ${
              !sourceFilter && !tagFilter ? "border-ink bg-ink text-paper" : "border-hairline bg-paper text-ink hover:border-ink"
            }`}
          >
            All
          </a>
          {allSources.map((s) => (
            <a
              key={s.id}
              href={buildUrl({ source: s.name })}
              className={`inline-flex items-center gap-1 border px-3 py-1.5 font-sans text-wired-meta font-bold uppercase transition-colors ${
                sourceFilter === s.name
                  ? "border-ink bg-ink text-paper"
                  : "border-hairline bg-paper text-ink hover:border-ink"
              }`}
            >
              {s.type === "group" ? "👥" : "📄"} {s.name}
              <span className={`text-[10px] ${sourceFilter === s.name ? "opacity-70" : "text-muted-foreground"}`}>
                ({s._count.posts})
              </span>
            </a>
          ))}
        </div>
      </div>

      {/* Info */}
      <p className="text-xs text-muted-foreground mb-4">
        {totalCount > 0 ? `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, totalCount)}` : "0"} of {totalCount}
        {sourceFilter && ` from "${sourceFilter}"`}
        {tagFilter && ` · tag: ${tagFilter}`}
      </p>

      {/* Cards */}
      <div className="space-y-3">
        {posts.map((p) => (
          <div key={p.postId} className="border border-hairline bg-paper p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="border border-hairline bg-paper px-1.5 py-0.5 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">
                  {p.source.type === "group" ? "👥" : "📄"} {p.source.name}
                </span>
                {(p.source.tags || []).map((t) => (
                  <a
                    key={t}
                    href={buildUrl({ tag: t })}
                    className="border border-hairline px-1.5 py-0.5 font-sans text-wired-meta uppercase tracking-widest text-ink-soft transition-colors hover:border-ink hover:text-ink"
                  >
                    {t}
                  </a>
                ))}
                <span className="text-xs text-muted-foreground">
                  {timeAgo(p.publishedAt)}
                </span>
              </div>
              {p.url && (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener"
                  className="text-xs text-link hover:underline"
                >
                  Open ↗
                </a>
              )}
            </div>

            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-foreground/80">
                {p.author}
              </span>
            </div>

            <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap break-words">
              {p.text.slice(0, 500)}{p.text.length > 500 ? "…" : ""}
            </p>

            {p.image && (
              <div className="mt-3">
                <img
                  src={p.image}
                  alt=""
                  className="max-h-48 border border-hairline object-cover"
                  loading="lazy"
                />
              </div>
            )}

            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <span>👍 {p.reactionCount}</span>
              <span>💬 {p.commentCount}</span>
              {p.publishedAt && (
                <span>{new Date(p.publishedAt).toLocaleString()}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {posts.length === 0 && (
        <div className="text-center text-muted-foreground py-16">
          No Facebook posts yet. Add sources in <a href="/fb-sources" className="text-link underline">FB Sources</a>.
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-1.5 mt-8 pb-8">
          {safePage > 1 && (
            <a href={buildUrl({ page: String(safePage - 1) })} className="border border-hairline bg-paper px-3 py-2 font-sans text-wired-meta font-bold uppercase text-ink transition-colors hover:border-ink">
              ← Prev
            </a>
          )}
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
            .reduce((acc: (number | string)[], p, i, arr) => {
              if (i > 0 && typeof arr[i - 1] === "number" && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
              acc.push(p);
              return acc;
            }, [])
            .map((p, i) =>
              typeof p === "string" ? (
                <span key={`d${i}`} className="px-1 text-muted-foreground">…</span>
              ) : (
                <a
                  key={p}
                  href={buildUrl({ page: String(p) })}
                  className={`border px-3 py-2 font-sans text-wired-meta font-bold uppercase transition-colors ${
                    p === safePage
                      ? "border-ink bg-ink text-paper"
                      : "border-hairline bg-paper text-ink hover:border-ink"
                  }`}
                >
                  {p}
                </a>
              )
            )}
          {safePage < totalPages && (
            <a href={buildUrl({ page: String(safePage + 1) })} className="border border-hairline bg-paper px-3 py-2 font-sans text-wired-meta font-bold uppercase text-ink transition-colors hover:border-ink">
              Next →
            </a>
          )}
        </div>
      )}
    </main>
  );
}
