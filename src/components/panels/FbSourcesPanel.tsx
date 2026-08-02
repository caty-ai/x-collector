"use client";

import { useState, useEffect, useCallback } from "react";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { Headline } from "@/components/ui/Headline";
import { WiredButton } from "@/components/ui/WiredButton";

interface FbSource {
  id: number;
  name: string;
  type: string;
  url: string;
  slug: string;
  active: boolean;
  tags: string[];
  maxPages: number;
  lastFetchedAt: string | null;
  createdAt: string;
  _count?: { posts: number };
}

export default function FbSourcesPanel() {
  const [sources, setSources] = useState<FbSource[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState<number | null>(null);
  const [fetchAllLoading, setFetchAllLoading] = useState(false);
  const [message, setMessage] = useState("");

  const fetchSources = useCallback(async () => {
    const res = await fetch("/api/fb-sources");
    const data = await res.json();
    setSources(data.sources || []);
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/fb-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || undefined,
        url: url.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    });
    if (res.ok) {
      setName("");
      setUrl("");
      setTags("");
      setMessage("✅ Added!");
      fetchSources();
    } else {
      const data = await res.json();
      setMessage(`❌ ${data.error || "Failed"}`);
    }
    setLoading(false);
  }

  async function handleFetchOne(id: number, deepPages?: number) {
    setFetching(id);
    setMessage("");
    const body: any = { sourceId: id };
    if (deepPages) body.maxPages = deepPages;
    const res = await fetch("/api/fb-fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      const r = data.results?.[0];
      setMessage(`✅ ${r?.name}: ${r?.upserted || 0} posts fetched in ${r?.pages || 0} pages`);
    } else {
      setMessage(`❌ ${data.error || "Failed"}`);
    }
    setFetching(null);
    fetchSources();
  }

  async function handleFetchAll() {
    setFetchAllLoading(true);
    setMessage("");
    const res = await fetch("/api/fb-fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (res.ok) {
      const totalUpserted = (data.results || []).reduce((sum: number, r: any) => sum + (r.upserted || 0), 0);
      const errCount = (data.results || []).filter((r: any) => r.error).length;
      setMessage(`✅ All sources: ${totalUpserted} posts fetched (${errCount} errors)`);
    } else {
      setMessage(`❌ ${data.error || "Failed"}`);
    }
    setFetchAllLoading(false);
    fetchSources();
  }

  async function handleToggle(id: number, active: boolean) {
    await fetch("/api/fb-sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active: !active }),
    });
    fetchSources();
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete "${name}"? This removes all collected posts too.`)) return;
    await fetch("/api/fb-sources", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchSources();
  }

  return (
    <div>
<div className="mb-8 border-b border-hairline pb-4">
        <Headline level="sm" as="h2">Facebook Sources</Headline>
        <p className="mt-1 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">
          Manage Facebook groups and pages to collect posts from
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
        <h3><Eyebrow>Add New Facebook Source</Eyebrow></h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">Name (optional)</label>
            <input
              type="text"
              placeholder='e.g. "GPTs研究会"'
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm text-ink"
            />
          </div>
          <div>
            <label className="mb-1 block font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">Tags (comma-separated)</label>
            <input
              type="text"
              placeholder="e.g. ai, japanese"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm text-ink"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">Facebook URL</label>
          <input
            type="url"
            placeholder="https://www.facebook.com/groups/example or https://www.facebook.com/PageName"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm text-ink"
            required
          />
          <p className="mt-1 font-sans text-wired-meta text-ink-soft">
            Paste the Facebook group or page URL. Type (group/page) is auto-detected.
          </p>
        </div>
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
                <span className="text-sm">
                  {s.type === "group" ? "👥" : "📄"}
                </span>
                <span className="font-sans text-sm font-bold text-ink">{s.name}</span>
                <span className="border border-hairline px-1.5 py-0.5 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">
                  {s.type}
                </span>
                {(s.tags || []).map((t) => (
                  <span key={t} className="border border-hairline px-1.5 py-0.5 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">
                    {t}
                  </span>
                ))}
                <span className="font-sans text-wired-meta tabular-nums text-ink-soft">
                  {s._count?.posts ?? 0} posts
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
                  onClick={() => handleFetchOne(s.id, 20)}
                  disabled={fetching === s.id}
                  className="border border-hairline bg-paper px-2 py-1 font-sans text-wired-meta font-bold uppercase text-ink disabled:opacity-50"
                  title="Fetch up to ~50 posts (20 pages)"
                >
                  {fetching === s.id ? "⏳" : "🔍 Deep (50)"}
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
            <p className="truncate font-sans text-wired-meta text-ink-soft">{s.url}</p>
            <p className="mt-1 font-sans text-wired-meta tabular-nums text-ink-soft">
              Slug: {s.slug} · Routine: {s.maxPages} page(s) · Added {new Date(s.createdAt).toISOString().slice(0, 10)}
              {s.lastFetchedAt && ` · Last fetched: ${new Date(s.lastFetchedAt).toLocaleString()}`}
            </p>
          </div>
        ))}
        {sources.length === 0 && (
          <div className="border border-hairline py-16 text-center font-sans text-sm text-ink-soft">
            No Facebook sources yet. Add one above.
          </div>
        )}
      </div>
    </div>
  );
}
