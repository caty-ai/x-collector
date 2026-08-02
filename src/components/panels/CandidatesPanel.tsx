"use client";

import { useState, useEffect, useCallback } from "react";

import { Headline } from "@/components/ui/Headline";

interface Candidate {
  id: number;
  handle: string;
  mentionCount: number;
  mentionedBy: string[];
  profileFetched: boolean;
  displayName: string | null;
  description: string | null;
  followersCount: number | null;
  tweetCount: number | null;
  sampleTweets: any[] | null;
  aiScore: number | null;
  aiReason: string | null;
  aiEvaluatedAt: string | null;
  status: string;
  createdAt: string;
}

interface Stats {
  total: number;
  pending: number;
  watch: number;
  needs_review: number;
  approved: number;
  rejected: number;
  promoted: number;
}

interface UnhealthySource {
  id: number;
  handle: string;
  active: boolean;
  trustScore: number | null;
  trustLabel: string | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  cooldownUntil: string | null;
  reason: string;
  latestEvent: {
    action: string;
    reason: string;
    at: string;
  };
}

function fmt(n: number | null): string {
  if (n === null || n === undefined) return "–";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

const statusColors: Record<string, string> = {
  pending: "border-hairline text-ink-soft",
  watch: "border-hairline text-ink-soft",
  needs_review: "border-ink text-ink",
  approved: "border-ink text-ink",
  rejected: "border-hairline text-ink-soft",
  promoted: "border-ink text-ink",
};

export default function CandidatesPanel() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [unhealthySources, setUnhealthySources] = useState<UnhealthySource[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    pending: 0,
    watch: 0,
    needs_review: 0,
    approved: 0,
    rejected: 0,
    promoted: 0,
  });
  const [filter, setFilter] = useState<string>("");
  const [view, setView] = useState<"weekly" | "list">("weekly");
  const [autoFallbackChecked, setAutoFallbackChecked] = useState(false);

  const fetchData = useCallback(async () => {
    const url = view === "weekly" ? "/api/candidates?view=weekly" : filter ? `/api/candidates?status=${filter}` : "/api/candidates";
    const res = await fetch(url);
    const data = await res.json();
    const nextCandidates = data.candidates || [];
    const nextSources = data.unhealthySources || [];

    if (view === "weekly" && !autoFallbackChecked && nextCandidates.length === 0 && nextSources.length === 0) {
      setAutoFallbackChecked(true);
      setView("list");
      return;
    }

    setCandidates(data.candidates || []);
    setUnhealthySources(nextSources);
    setStats(data.stats || {});
  }, [autoFallbackChecked, filter, view]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleStatus(id: number, status: string) {
    await fetch("/api/candidates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    fetchData();
  }

  async function handleRestore(sourceId: number) {
    await fetch("/api/candidates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId, action: "restore" }),
    });
    fetchData();
  }

  const filterOpts = [
    { key: "", label: "All", count: stats.total },
    { key: "pending", label: "Pending", count: stats.pending },
    { key: "watch", label: "Watch", count: stats.watch },
    { key: "needs_review", label: "Needs Review", count: stats.needs_review },
    { key: "approved", label: "Approved", count: stats.approved },
    { key: "rejected", label: "Rejected", count: stats.rejected },
    { key: "promoted", label: "Promoted", count: stats.promoted },
  ];

  const renderCandidate = (c: Candidate) => (
    <div
      key={c.id}
      className={`border border-hairline bg-paper p-5 ${
        c.status === "rejected" ? "opacity-50" : ""
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`https://x.com/${c.handle}`}
            target="_blank"
            rel="noopener"
            className="font-sans text-sm font-bold text-link underline decoration-link underline-offset-4"
          >
            @{c.handle}
          </a>
          {c.displayName && (
            <span className="font-sans text-wired-meta text-ink-soft">{c.displayName}</span>
          )}
          <span className={`border px-1.5 py-0.5 font-sans text-wired-meta font-bold uppercase tracking-widest ${statusColors[c.status] || ""}`}>
            {c.status}
          </span>
          {c.aiScore !== null && (
            <span className="border border-hairline px-1.5 py-0.5 font-sans text-wired-meta font-bold uppercase tracking-widest text-ink">
              Score: {c.aiScore}/100
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {c.status !== "approved" && c.status !== "promoted" && (
            <button
              onClick={() => handleStatus(c.id, "approved")}
              className="border border-hairline bg-paper px-2 py-1 font-sans text-wired-meta font-bold uppercase text-ink"
            >
              ✓ Approve
            </button>
          )}
          {c.status !== "rejected" && c.status !== "promoted" && (
            <button
              onClick={() => handleStatus(c.id, "rejected")}
              className="border border-hairline bg-paper px-2 py-1 font-sans text-wired-meta font-bold uppercase text-ink"
            >
              ✗ Reject
            </button>
          )}
        </div>
      </div>

      {c.description && (
        <p className="mb-2 line-clamp-2 font-sans text-sm text-ink-soft">{c.description}</p>
      )}

      <div className="mb-2 flex flex-wrap gap-4 font-sans text-wired-meta tabular-nums text-ink-soft">
        <span>👥 {fmt(c.followersCount)} followers</span>
        <span>📝 {fmt(c.tweetCount)} tweets</span>
        <span>📣 {c.mentionCount}x mentioned</span>
        <span>by: {c.mentionedBy.map((h) => `@${h}`).join(", ")}</span>
      </div>

      {c.aiReason && (
        <p className="mt-2 border border-hairline p-2 font-sans text-wired-meta text-ink-soft">
          🤖 {c.aiReason}
        </p>
      )}
    </div>
  );

  return (
    <div>
      <div className="mb-8 border-b border-hairline pb-4">
        <Headline level="sm" as="h2">Account Discovery</Headline>
        <p className="mt-1 font-sans text-wired-meta uppercase tracking-widest text-ink-soft">
          VIPのツイートから発見された候補アカウント。AIが精査してVIPリストに自動追加。
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setView("weekly")}
          className={`border px-3 py-2 font-sans text-wired-meta font-bold uppercase tracking-widest ${
            view === "weekly" ? "border-ink bg-ink text-paper" : "border-hairline bg-paper text-ink"
          }`}
        >
          Weekly Review
        </button>
        <button
          onClick={() => setView("list")}
          className={`border px-3 py-2 font-sans text-wired-meta font-bold uppercase tracking-widest ${
            view === "list" ? "border-ink bg-ink text-paper" : "border-hairline bg-paper text-ink"
          }`}
        >
          Candidate List
        </button>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-7">
        {filterOpts.map((o) => (
          <button
            key={o.key}
            onClick={() => {
              setView("list");
              setFilter(o.key);
            }}
            className={`border p-3 text-center ${
              view === "list" && filter === o.key
                ? "border-ink bg-ink text-paper"
                : "border-hairline bg-paper text-ink"
            }`}
          >
            <div className="font-sans text-lg font-bold tabular-nums">{o.count}</div>
            <div className="font-sans text-wired-meta font-bold uppercase tracking-widest">{o.label}</div>
          </button>
        ))}
      </div>

      {view === "weekly" && (
        <div className="mb-8 space-y-6">
          <section>
            <div className="mb-3 flex items-end justify-between gap-4 border-b border-hairline pb-2">
              <h3 className="font-sans text-sm font-bold uppercase tracking-widest text-ink">
                Needs Review
              </h3>
              <span className="font-sans text-wired-meta uppercase tracking-widest text-ink-soft">
                {candidates.length}/10
              </span>
            </div>
            <div className="space-y-3">
              {candidates.map(renderCandidate)}
              {candidates.length === 0 && (
                <div className="border border-hairline py-10 text-center font-sans text-sm text-ink-soft">
                  No candidate reviews queued.
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-end justify-between gap-4 border-b border-hairline pb-2">
              <h3 className="font-sans text-sm font-bold uppercase tracking-widest text-ink">
                Source Health
              </h3>
              <span className="font-sans text-wired-meta uppercase tracking-widest text-ink-soft">
                {unhealthySources.length}/5
              </span>
            </div>
            <div className="space-y-3">
              {unhealthySources.map((source) => (
                <div key={source.id} className="border border-hairline bg-paper p-5">
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`https://x.com/${source.handle}`}
                        target="_blank"
                        rel="noopener"
                        className="font-sans text-sm font-bold text-link underline decoration-link underline-offset-4"
                      >
                        @{source.handle}
                      </a>
                      <span className="border border-hairline px-1.5 py-0.5 font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">
                        {source.active ? "flagged" : "deactivated"}
                      </span>
                      {source.trustScore !== null && (
                        <span className="border border-hairline px-1.5 py-0.5 font-sans text-wired-meta font-bold uppercase tracking-widest text-ink">
                          Trust: {source.trustScore}/100
                        </span>
                      )}
                      {source.trustLabel && (
                        <span className="border border-hairline px-1.5 py-0.5 font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">
                          {source.trustLabel}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleRestore(source.id)}
                      className="border border-hairline bg-paper px-2 py-1 font-sans text-wired-meta font-bold uppercase text-ink"
                    >
                      Restore
                    </button>
                  </div>
                  <p className="font-sans text-sm text-ink-soft">{source.reason}</p>
                </div>
              ))}
              {unhealthySources.length === 0 && (
                <div className="border border-hairline py-10 text-center font-sans text-sm text-ink-soft">
                  No unhealthy sources flagged.
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Candidate list */}
      {view === "list" && <div className="space-y-3">{candidates.map(renderCandidate)}</div>}

      {view === "list" && candidates.length === 0 && (
        <div className="border border-hairline py-16 text-center font-sans text-sm text-ink-soft">
          No candidates found. Run discovery to extract mentions from tweets.
        </div>
      )}
    </div>
  );
}
