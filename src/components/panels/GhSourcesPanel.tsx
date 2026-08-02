"use client";

import { useState, useEffect, useCallback } from "react";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { Headline } from "@/components/ui/Headline";
import { WiredButton } from "@/components/ui/WiredButton";

interface GhSource {
  id: number;
  name: string;
  type: string;
  repo?: string | null;
  query?: string | null;
  active: boolean;
  tags: string[];
  lastFetchedAt: string | null;
  createdAt: string;
  _count?: { items: number };
}

export default function GhSourcesPanel() {
  const [sources, setSources] = useState<GhSource[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<"repo" | "search">("repo");
  const [repo, setRepo] = useState("");
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState<number | null>(null);
  const [fetchAllLoading, setFetchAllLoading] = useState(false);
  const [message, setMessage] = useState("");

  const fetchSources = useCallback(async () => {
    const res = await fetch("/api/gh-sources");
    const data = await res.json();
    setSources(data.sources || []);
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (type === "repo" && !repo.trim()) return;
    if (type === "search" && !query.trim()) return;
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/gh-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || undefined,
        type,
        repo: type === "repo" ? repo.trim() : undefined,
        query: type === "search" ? query.trim() : undefined,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    });
    if (res.ok) {
      setName("");
      setRepo("");
      setQuery("");
      setTags("");
      setMessage("✅ Added!");
      fetchSources();
    } else {
      const data = await res.json();
      setMessage(`❌ ${data.error || "Failed"}`);
    }
    setLoading(false);
  }

  async function handleFetchOne(id: number, deepItems?: number) {
    setFetching(id);
    setMessage("");
    const body: any = { sourceId: id };
    if (deepItems) body.maxItems = deepItems;
    const res = await fetch("/api/gh-fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      const r = data.results?.[0];
      setMessage(`✅ ${r?.name}: ${r?.upserted || 0} items fetched`);
    } else {
      setMessage(`❌ ${data.error || "Failed"}`);
    }
    setFetching(null);
    fetchSources();
  }

  async function handleFetchAll() {
    setFetchAllLoading(true);
    setMessage("");
    const res = await fetch("/api/gh-fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (res.ok) {
      const totalUpserted = (data.results || []).reduce((sum: number, r: any) => sum + (r.upserted || 0), 0);
      const errCount = (data.results || []).filter((r: any) => r.error).length;
      setMessage(`✅ All sources: ${totalUpserted} items fetched (${errCount} errors)`);
    } else {
      setMessage(`❌ ${data.error || "Failed"}`);
    }
    setFetchAllLoading(false);
    fetchSources();
  }

  async function handleToggle(id: number, active: boolean) {
    await fetch("/api/gh-sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active: !active }),
    });
    fetchSources();
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete "${name}"? This removes all collected items too.`)) return;
    await fetch("/api/gh-sources", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchSources();
  }

  return (
    <div>
<div className="mb-8 border-b border-hairline pb-4">
        <Headline level="sm" as="h2">GitHub Sources</Headline>
        <p className="mt-1 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">
          Track repository releases or search for trending repos
        </p>
      </div>

      {/* Fetch all button */}
      <div className="mb-6 flex items-center gap-3">
        <WiredButton
          onClick={handleFetchAll}
          disabled={fetchAllLoading}
          className="disabled:opacity-50"
        >
          {fetchAllLoading ? "⏳ Fetching..." : "🔄 Fetch All Now"}
        </WiredButton>
        {message && <span className="font-sans text-sm text-ink-soft">{message}</span>}
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="mb-8 space-y-4 border border-hairline bg-paper p-5">
        <h3><Eyebrow>Add New GitHub Source</Eyebrow></h3>
        
        {/* Type selector */}
        <div>
          <label className="mb-1 block font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">Source Type</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType("repo")}
              className={`border px-3 py-1.5 font-sans text-wired-meta font-bold uppercase tracking-widest ${
                type === "repo"
                  ? "border-ink bg-ink text-paper"
                  : "border-hairline bg-paper text-ink"
              }`}
            >
              📦 Repo Releases
            </button>
            <button
              type="button"
              onClick={() => setType("search")}
              className={`border px-3 py-1.5 font-sans text-wired-meta font-bold uppercase tracking-widest ${
                type === "search"
                  ? "border-ink bg-ink text-paper"
                  : "border-hairline bg-paper text-ink"
              }`}
            >
              🔍 Search/Trending
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">Name (optional)</label>
            <input
              type="text"
              placeholder={type === "repo" ? 'e.g. "Claude Code"' : 'e.g. "AI Trending"'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm text-ink"
            />
          </div>
          <div>
            <label className="mb-1 block font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">Tags (comma-separated)</label>
            <input
              type="text"
              placeholder="e.g. ai, claude"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm text-ink"
            />
          </div>
        </div>

        {type === "repo" ? (
          <div>
            <label className="mb-1 block font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">Repository</label>
            <input
              type="text"
              placeholder='e.g. "anthropics/claude-code" or "https://github.com/anthropics/claude-code"'
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm text-ink"
              required
            />
            <p className="mt-1 font-sans text-wired-meta text-ink-soft">
              Repository in "owner/repo" format or full GitHub URL. Latest releases will be tracked.
            </p>
          </div>
        ) : (
          <div>
            <label className="mb-1 block font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">Search Query</label>
            <input
              type="text"
              placeholder='e.g. "topic:ai language:python stars:>100"'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm text-ink"
              required
            />
            <p className="mt-1 font-sans text-wired-meta text-ink-soft">
              GitHub search query. Results sorted by stars.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <WiredButton
            type="submit"
            disabled={loading}
            className="disabled:opacity-50"
          >
            {loading ? "Adding..." : "Add Source"}
          </WiredButton>
        </div>
      </form>

      {/* Source list */}
      <div className="space-y-3">
        {sources.map((s) => (
          <div
            key={s.id}
            className={`border border-hairline p-5 ${
              s.active ? "bg-paper" : "bg-paper opacity-60"
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{s.type === "repo" ? "📦" : "🔍"}</span>
                <span className="font-sans text-sm font-bold text-ink">{s.name}</span>
                <span className="border border-hairline px-1.5 py-0.5 font-mono text-wired-meta uppercase tracking-widest text-ink-soft">
                  {s.type === "repo" ? s.repo : s.query?.slice(0, 30)}
                </span>
                {(s.tags || []).map((t) => (
                  <span key={t} className="border border-hairline px-1.5 py-0.5 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">
                    {t}
                  </span>
                ))}
                <span className="font-sans text-wired-meta tabular-nums text-ink-soft">
                  {s._count?.items ?? 0} items
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleFetchOne(s.id)}
                  disabled={fetching === s.id}
                  className="border border-hairline bg-paper px-2 py-1 font-sans text-wired-meta font-bold uppercase text-ink disabled:opacity-50"
                >
                  {fetching === s.id ? "⏳" : "🔄 Fetch"}
                </button>
                <button
                  onClick={() => handleFetchOne(s.id, 100)}
                  disabled={fetching === s.id}
                  className="border border-hairline bg-paper px-2 py-1 font-sans text-wired-meta font-bold uppercase text-ink disabled:opacity-50"
                  title="Fetch up to 100 items"
                >
                  {fetching === s.id ? "⏳" : "🔍 Deep (100)"}
                </button>
                <button
                  onClick={() => handleToggle(s.id, s.active)}
                  className="border border-hairline bg-paper px-2 py-1 font-sans text-wired-meta font-bold uppercase text-ink"
                >
                  {s.active ? "Active" : "Paused"}
                </button>
                <button
                  onClick={() => handleDelete(s.id, s.name)}
                  className="border border-ink bg-paper px-2 py-1 font-sans text-wired-meta font-bold uppercase text-ink"
                >
                  Delete
                </button>
              </div>
            </div>
            <p className="font-sans text-wired-meta tabular-nums text-ink-soft">
              Type: {s.type} · Added {new Date(s.createdAt).toISOString().slice(0, 10)}
              {s.lastFetchedAt && ` · Last fetched: ${new Date(s.lastFetchedAt).toLocaleString()}`}
            </p>
          </div>
        ))}
        {sources.length === 0 && (
          <div className="border border-hairline py-16 text-center font-sans text-sm text-ink-soft">
            No GitHub sources yet. Add one above.
          </div>
        )}
      </div>
    </div>
  );
}
