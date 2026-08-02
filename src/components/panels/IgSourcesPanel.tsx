"use client";

import { useState, useEffect, useCallback } from "react";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { Headline } from "@/components/ui/Headline";
import { WiredButton } from "@/components/ui/WiredButton";

interface IgSource {
  id: number;
  name: string;
  handle: string;
  active: boolean;
  tags: string[];
  lastFetchedAt: string | null;
  createdAt: string;
  _count?: { posts: number };
}

export default function IgSourcesPanel() {
  const [sources, setSources] = useState<IgSource[]>([]);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [tags, setTags] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchAllLoading, setFetchAllLoading] = useState(false);
  const [message, setMessage] = useState("");

  const fetchSources = useCallback(async () => {
    const res = await fetch("/api/ig-sources");
    const data = await res.json();
    setSources(data.sources || []);
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!handle.trim()) return;
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/ig-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || undefined,
        handle: handle.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    });
    if (res.ok) {
      setName("");
      setHandle("");
      setTags("");
      setMessage("✅ Added!");
      fetchSources();
    } else {
      const data = await res.json();
      setMessage(`❌ ${data.error || "Failed"}`);
    }
    setLoading(false);
  }

  async function handleFetchAll() {
    setFetchAllLoading(true);
    setMessage("");
    const res = await fetch("/api/ig-fetch", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setMessage("✅ Instagram fetch complete!");
    } else {
      setMessage(`❌ ${data.error || "Failed"}`);
    }
    setFetchAllLoading(false);
    fetchSources();
  }

  async function handleToggle(id: number, active: boolean) {
    await fetch("/api/ig-sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active: !active }),
    });
    fetchSources();
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete "${name}"? This removes all collected posts too.`)) return;
    await fetch("/api/ig-sources", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchSources();
  }

  return (
    <div>
<div className="mb-8 border-b border-hairline pb-4">
        <Headline level="sm" as="h2">Instagram Sources</Headline>
        <p className="mt-1 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">
          Manage Instagram accounts to collect posts from (via ScrapeCreators API)
        </p>
      </div>

      {/* Fetch all button */}
      <div className="mb-6 flex items-center gap-3">
        <WiredButton
          onClick={handleFetchAll}
          disabled={fetchAllLoading}
          className="disabled:opacity-50"
        >
          {fetchAllLoading ? "⏳ Fetching..." : "📸 Fetch All Now"}
        </WiredButton>
        {message && <span className="font-sans text-sm text-ink-soft">{message}</span>}
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="mb-8 space-y-4 border border-hairline bg-paper p-5">
        <h3><Eyebrow>Add New Instagram Account</Eyebrow></h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">Name (optional)</label>
            <input
              type="text"
              placeholder='e.g. "OpenAI"'
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm text-ink"
            />
          </div>
          <div>
            <label className="mb-1 block font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">Tags (comma-separated)</label>
            <input
              type="text"
              placeholder="e.g. ai, official"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm text-ink"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">Instagram Handle</label>
          <input
            type="text"
            placeholder='e.g. "openai" or "@openai"'
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm text-ink"
            required
          />
          <p className="mt-1 font-sans text-wired-meta text-ink-soft">
            Username (with or without @). Each fetch returns the latest 12 posts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <WiredButton
            type="submit"
            disabled={loading}
            className="disabled:opacity-50"
          >
            {loading ? "Adding..." : "Add Account"}
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
                <span className="text-sm">📸</span>
                <span className="font-sans text-sm font-bold text-ink">{s.name}</span>
                <span className="border border-hairline px-1.5 py-0.5 font-mono text-wired-meta uppercase tracking-widest text-ink-soft">
                  @{s.handle}
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
              Added {new Date(s.createdAt).toISOString().slice(0, 10)}
              {s.lastFetchedAt && ` · Last fetched: ${new Date(s.lastFetchedAt).toLocaleString()}`}
            </p>
          </div>
        ))}
        {sources.length === 0 && (
          <div className="border border-hairline py-16 text-center font-sans text-sm text-ink-soft">
            No Instagram sources yet. Add one above.
          </div>
        )}
      </div>
    </div>
  );
}
