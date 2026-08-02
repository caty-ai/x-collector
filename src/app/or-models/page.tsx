"use client";

import { useState, useEffect, useCallback } from "react";
import Nav from "../../components/Nav";

interface OrModel {
  id: string;
  name: string;
  pricingPrompt: number | null;
  pricingCompletion: number | null;
  contextLength: number | null;
  isFree: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  removedAt: string | null;
  description: string | null;
}

interface OrModelEvent {
  id: number;
  modelId: string;
  eventType: string;
  detail: string | null;
  detectedAt: string;
}

interface Stats {
  total: number;
  free: number;
  removed: number;
  recentEvents: number;
}

function pricePerM(perToken: number | null): string {
  if (perToken === null || perToken === 0) return "Free";
  return `$${(perToken * 1_000_000).toFixed(2)}/M`;
}

function formatCtx(n: number | null): string {
  if (!n) return "–";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function eventIcon(type: string): string {
  switch (type) {
    case "new": return "🆕";
    case "removed": return "❌";
    case "price_change": return "💰";
    case "context_change": return "📏";
    default: return "📋";
  }
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function OrModelsPage() {
  const [models, setModels] = useState<OrModel[]>([]);
  const [events, setEvents] = useState<OrModelEvent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"all" | "free">("all");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"models" | "events">("events");

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter === "free") params.set("free", "true");
    if (search) params.set("q", search);
    params.set("events", "50");
    const res = await fetch(`/api/or-models?${params}`);
    const data = await res.json();
    setModels(data.models || []);
    setEvents(data.events || []);
    setStats(data.stats || null);
    setLoading(false);
  }, [filter, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleFetch() {
    setFetchLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/or-fetch", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setMessage(
          `✅ ${data.total} models scanned: ${data.newModels} new, ${data.removed} removed, ${data.priceChanges} price changes, ${data.contextChanges} context changes`
        );
        fetchData();
      } else {
        setMessage(`❌ ${data.error}`);
      }
    } catch (e: any) {
      setMessage(`❌ ${e.message}`);
    }
    setFetchLoading(false);
  }

  return (
    <main className="min-h-screen bg-paper text-ink p-4 md:p-8">
      <Nav />

      <h1 className="text-2xl font-bold mb-2">🤖 OpenRouter Model Tracker</h1>
      <p className="text-muted-foreground mb-4">
        AI モデル一覧・新着・料金変更を自動追跡
      </p>

      {/* Stats */}
      {stats && (
        <div className="flex gap-4 mb-4 text-sm">
          <span className="border border-hairline bg-paper px-3 py-1">📊 Total: {stats.total}</span>
          <span className="border border-ink bg-paper px-3 py-1 text-ink">🆓 Free: {stats.free}</span>
          <span className="border border-hairline bg-paper px-3 py-1">📋 Events: {stats.recentEvents}</span>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={handleFetch}
          disabled={fetchLoading}
          className="border border-ink bg-ink px-4 py-2 font-sans text-sm font-bold uppercase text-paper disabled:opacity-50"
        >
          {fetchLoading ? "⏳ Scanning..." : "🔄 Scan Now"}
        </button>
        <input
          type="text"
          placeholder="Search models..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-60 border border-ink bg-paper px-3 py-2 text-sm text-ink"
        />
        <button
          onClick={() => setFilter(filter === "free" ? "all" : "free")}
          className={`border px-3 py-2 text-sm ${
            filter === "free" ? "border-ink bg-ink text-paper" : "border-hairline bg-paper text-ink"
          }`}
        >
          🆓 Free Only
        </button>
      </div>

      {message && <div className="mb-4 border border-hairline bg-paper p-2 text-sm">{message}</div>}

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-hairline">
        <button
          onClick={() => setTab("events")}
          className={`px-4 py-2 text-sm ${tab === "events" ? "border-b-2 border-ink text-ink" : "text-ink-soft"}`}
        >
          📋 Recent Changes ({events.length})
        </button>
        <button
          onClick={() => setTab("models")}
          className={`px-4 py-2 text-sm ${tab === "models" ? "border-b-2 border-ink text-ink" : "text-ink-soft"}`}
        >
          🤖 All Models ({models.length})
        </button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : tab === "events" ? (
        /* Events tab */
        <div className="space-y-2">
          {events.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No events yet. Click "Scan Now" to start tracking.
            </p>
          ) : (
            events.map((e) => (
              <div key={e.id} className="border border-hairline bg-paper p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span>{eventIcon(e.eventType)}</span>
                  <span className="font-mono text-xs text-muted-foreground">{e.modelId}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{relativeTime(e.detectedAt)}</span>
                </div>
                {e.detail && <p className="text-sm text-foreground/80">{e.detail}</p>}
              </div>
            ))
          )}
        </div>
      ) : (
        /* Models tab */
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-ink-soft text-left">
                <th className="py-2 px-2">Model</th>
                <th className="py-2 px-2">Prompt</th>
                <th className="py-2 px-2">Completion</th>
                <th className="py-2 px-2">Context</th>
                <th className="py-2 px-2">First Seen</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className="border-b border-hairline hover:bg-canvas-soft">
                  <td className="py-2 px-2">
                    <div className="font-medium">
                      {m.isFree && <span className="mr-1 text-ink">🆓</span>}
                      {m.name}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">{m.id}</div>
                  </td>
                  <td className="py-2 px-2">{pricePerM(m.pricingPrompt)}</td>
                  <td className="py-2 px-2">{pricePerM(m.pricingCompletion)}</td>
                  <td className="py-2 px-2">{formatCtx(m.contextLength)}</td>
                  <td className="py-2 px-2 text-xs text-muted-foreground">
                    {relativeTime(m.firstSeenAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
