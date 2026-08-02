"use client";

import { useEffect, useState } from "react";

import { Headline } from "@/components/ui/Headline";
import { WiredButton } from "@/components/ui/WiredButton";

interface Source {
  id: number;
  handle: string;
  type: string;
  active: boolean;
  tags: string[];
  createdAt: string;
}

export default function XTwitterPanel() {
  const [sources, setSources] = useState<Source[]>([]);
  const [newHandle, setNewHandle] = useState("");
  const [newTags, setNewTags] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTags, setEditTags] = useState("");

  const fetchSources = async () => {
    const res = await fetch("/api/sources");
    const data = await res.json();
    setSources(data.sources || []);
  };

  useEffect(() => { fetchSources(); }, []);

  const addSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHandle.trim()) return;
    setLoading(true);
    setMessage("");
    const handle = newHandle.trim().replace(/^@/, "");
    const tags = newTags.split(",").map(t => t.trim()).filter(Boolean);
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle, tags }),
    });
    const data = await res.json();
    if (data.error) {
      setMessage(`❌ ${data.error}`);
    } else {
      setMessage(`✅ @${handle} added`);
      setNewHandle("");
      setNewTags("");
      fetchSources();
    }
    setLoading(false);
  };

  const toggleSource = async (id: number, active: boolean) => {
    await fetch("/api/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active: !active }),
    });
    fetchSources();
  };

  const saveTags = async (id: number) => {
    const tags = editTags.split(",").map(t => t.trim()).filter(Boolean);
    await fetch("/api/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, tags }),
    });
    setEditingId(null);
    fetchSources();
  };

  const deleteSource = async (id: number, handle: string) => {
    if (!confirm(`Remove @${handle}?`)) return;
    await fetch("/api/sources", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchSources();
  };

  const allTags = [...new Set(sources.flatMap(s => s.tags || []))].sort();

  return (
    <div>
<div className="mb-8 border-b border-hairline pb-4">
        <Headline level="sm" as="h2">VIP Sources</Headline>
        <p className="mt-1 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">
          Manage X accounts for tweet collection. Added accounts are collected daily at 0:00 (Thailand time).
        </p>
        {allTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="font-sans text-wired-meta uppercase tracking-widest text-ink-soft">Tags in use:</span>
            {allTags.map(t => (
              <span key={t} className="border border-hairline px-2 py-0.5 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">{t}</span>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={addSource} className="mb-6 space-y-2 border border-hairline bg-paper p-5">
        <div className="flex gap-2">
          <input
            type="text"
            value={newHandle}
            onChange={(e) => setNewHandle(e.target.value)}
            placeholder="Handle (e.g. elonmusk)"
            className="flex-1 border border-ink bg-paper px-4 py-2.5 font-sans text-sm text-ink outline-none placeholder:text-ink-soft"
          />
          <WiredButton
            type="submit"
            disabled={loading || !newHandle.trim()}
            className="disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Adding..." : "Add"}
          </WiredButton>
        </div>
        <input
          type="text"
          value={newTags}
          onChange={(e) => setNewTags(e.target.value)}
          placeholder="Tags (comma separated, e.g. ai, mcp, design)"
          className="w-full border border-ink bg-paper px-4 py-2 font-sans text-sm text-ink outline-none placeholder:text-ink-soft"
        />
      </form>

      {message && (
        <div className={`mb-6 border px-4 py-2.5 font-sans text-sm ${
          message.startsWith("✅") ? "border-hairline text-ink" : "border-ink text-ink"
        }`}>
          {message}
        </div>
      )}

      <div className="space-y-2">
        {sources.map((s) => (
          <div
            key={s.id}
            className={`border border-hairline px-5 py-3.5 ${
              s.active ? "bg-paper" : "bg-paper opacity-60"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`h-2 w-2 ${s.active ? "bg-ink" : "bg-hairline"}`}
                  title={s.active ? "Active" : "Paused"}
                  aria-label={s.active ? "Active" : "Paused"}
                />
                <span className="font-sans text-sm font-bold text-ink">@{s.handle}</span>
                <span className="font-sans text-wired-meta tabular-nums text-ink-soft">
                  {new Date(s.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    if (editingId === s.id) { setEditingId(null); }
                    else { setEditingId(s.id); setEditTags((s.tags || []).join(", ")); }
                  }}
                  className="border border-hairline bg-paper px-3 py-1.5 font-sans text-wired-meta font-bold uppercase text-ink"
                >
                  🏷 Tags
                </button>
                <button
                  onClick={() => toggleSource(s.id, s.active)}
                  className="border border-hairline bg-paper px-3 py-1.5 font-sans text-wired-meta font-bold uppercase text-ink"
                >
                  {s.active ? "Pause" : "Resume"}
                </button>
                <button
                  onClick={() => deleteSource(s.id, s.handle)}
                  className="border border-ink bg-paper px-3 py-1.5 font-sans text-wired-meta font-bold uppercase text-ink"
                >
                  Remove
                </button>
              </div>
            </div>

            {/* Tags display */}
            {(s.tags || []).length > 0 && editingId !== s.id && (
              <div className="ml-5 mt-2 flex gap-1.5">
                {s.tags.map(t => (
                  <span key={t} className="border border-hairline px-2 py-0.5 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">{t}</span>
                ))}
              </div>
            )}

            {/* Tags editor */}
            {editingId === s.id && (
              <div className="ml-5 mt-3 flex gap-2">
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="ai, mcp, design"
                  className="flex-1 border border-ink bg-paper px-3 py-1.5 font-sans text-sm text-ink outline-none"
                />
                <button
                  onClick={() => saveTags(s.id)}
                  className="border border-ink bg-ink px-3 py-1.5 font-sans text-wired-meta font-bold uppercase text-paper"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="border border-hairline bg-paper px-3 py-1.5 font-sans text-wired-meta font-bold uppercase text-ink"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {sources.length === 0 && (
        <div className="border border-hairline py-16 text-center font-sans text-sm text-ink-soft">
          No sources yet. Add an X handle above to start collecting.
        </div>
      )}
    </div>
  );
}
