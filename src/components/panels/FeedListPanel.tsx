"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchJsonOrError, HttpError } from "@/lib/bff/fetch-json-or-error";
import { FeedResponse, FeedResponseSchema } from "@/lib/contracts/feed";
import { formatUtcToJstDate, formatUtcToJstDateTime } from "@/lib/date-formatter";
import { WiredButton } from "@/components/ui/WiredButton";

type PlatformFilter =
  | "all"
  | "twitter"
  | "facebook"
  | "reddit"
  | "qiita"
  | "github"
  | "alerts"
  | "instagram";

type FeedFilters = {
  platform: PlatformFilter;
  keyword: string;
  date: string;
};

type FeedListState = {
  loading: boolean;
  data: FeedResponse | null;
  error: string | null;
};

const DEFAULT_LIMIT = 200; // API契約注記: 暗黙デフォルトに依存しない
const PAGE_SIZE = 20;

const PLATFORM_OPTIONS: Array<{ value: PlatformFilter; label: string }> = [
  { value: "all", label: "すべて" },
  { value: "twitter", label: "Twitter" },
  { value: "facebook", label: "Facebook" },
  { value: "reddit", label: "Reddit" },
  { value: "qiita", label: "Qiita" },
  { value: "github", label: "GitHub" },
  { value: "alerts", label: "Alerts" },
  { value: "instagram", label: "Instagram" },
];

const PLATFORM_BADGE_LABEL: Record<Exclude<PlatformFilter, "all">, string> = {
  twitter: "Twitter",
  facebook: "Facebook",
  reddit: "Reddit",
  qiita: "Qiita",
  github: "GitHub",
  alerts: "Alerts",
  instagram: "Instagram",
};

function normalizePlatform(value: string | null): PlatformFilter {
  if (!value) return "all";

  return PLATFORM_OPTIONS.some((option) => option.value === value) ? (value as PlatformFilter) : "all";
}

function buildErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 401) {
      return "認証エラー — 再ログインしてください";
    }

    if (error.status >= 500) {
      return "データの取得に失敗しました。しばらく待ってから再試行してください";
    }

    if (error.status === 400) {
      return `入力条件を確認してください: ${error.message}`;
    }

    return `${error.status}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "不明なエラーが発生しました";
}

type FeedListPanelProps = {
  initialPlatform?: string;
};

export default function FeedListPanel({ initialPlatform }: FeedListPanelProps) {
  const platformFromQuery = normalizePlatform(initialPlatform ?? null);

  const [filters, setFilters] = useState<FeedFilters>(() => ({
    platform: platformFromQuery,
    keyword: "",
    date: formatUtcToJstDate(new Date()),
  }));
  const [appliedFilters, setAppliedFilters] = useState<FeedFilters>(filters);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<FeedListState>({
    loading: true,
    data: null,
    error: null,
  });

  useEffect(() => {
    if (platformFromQuery === filters.platform && platformFromQuery === appliedFilters.platform) {
      return;
    }

    const nextFilters: FeedFilters = {
      platform: platformFromQuery,
      keyword: "",
      date: formatUtcToJstDate(new Date()),
    };

    setFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setPage(1);
  }, [appliedFilters.platform, filters.platform, platformFromQuery]);

  const loadFeed = useCallback(async (nextFilters: FeedFilters) => {
    setState({ loading: true, data: null, error: null });

    try {
      const params = new URLSearchParams({
        limit: String(DEFAULT_LIMIT),
      });

      if (nextFilters.platform !== "all") {
        params.set("platform", nextFilters.platform);
      }

      if (nextFilters.keyword.trim()) {
        params.set("keyword", nextFilters.keyword.trim());
      }

      if (nextFilters.date) {
        params.set("date", nextFilters.date);
      }

      const data = await fetchJsonOrError(`/api/bff/feed?${params.toString()}`, FeedResponseSchema, {
        cache: "no-store",
      });

      setState({ loading: false, data, error: null });
    } catch (error) {
      setState({ loading: false, data: null, error: buildErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    loadFeed(appliedFilters);
  }, [appliedFilters, loadFeed]);

  const totalPages = useMemo(() => {
    if (!state.data) return 1;
    return Math.max(1, Math.ceil(state.data.items.length / PAGE_SIZE));
  }, [state.data]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pagedItems = useMemo(() => {
    if (!state.data) return [];
    const start = (page - 1) * PAGE_SIZE;
    return state.data.items.slice(start, start + PAGE_SIZE);
  }, [page, state.data]);

  function handleApplyFilters() {
    setAppliedFilters(filters);
    setPage(1);
  }

  return (
    <div className="space-y-5">
      <section className="border border-hairline bg-paper p-4">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1 font-sans text-sm">
            <span className="font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">プラットフォーム</span>
            <select
              value={filters.platform}
              onChange={(event) => setFilters((prev) => ({ ...prev, platform: event.target.value as PlatformFilter }))}
              className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm text-ink"
            >
              {PLATFORM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 font-sans text-sm">
            <span className="font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">キーワード検索</span>
            <input
              value={filters.keyword}
              onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleApplyFilters();
                }
              }}
              placeholder="例: OpenAI"
              className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm text-ink"
            />
          </label>

          <label className="space-y-1 font-sans text-sm">
            <span className="font-sans text-wired-meta font-bold uppercase tracking-widest text-ink-soft">日付（JST）</span>
            <input
              type="date"
              value={filters.date}
              onChange={(event) => setFilters((prev) => ({ ...prev, date: event.target.value }))}
              className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm text-ink"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <WiredButton
            type="button"
            size="compact"
            onClick={handleApplyFilters}
            className="text-wired-meta"
          >
            絞り込む
          </WiredButton>
          <button
            type="button"
            onClick={() => {
              const resetFilters: FeedFilters = {
                platform: "all",
                keyword: "",
                date: formatUtcToJstDate(new Date()),
              };
              setFilters(resetFilters);
              setAppliedFilters(resetFilters);
              setPage(1);
            }}
            className="border border-hairline bg-paper px-3 py-2 font-sans text-wired-meta font-bold uppercase text-ink"
          >
            今日にリセット
          </button>
        </div>
      </section>

      {state.loading && (
        <div className="border border-hairline bg-paper p-4 font-sans text-sm text-ink-soft">読み込み中...</div>
      )}

      {!state.loading && state.error && (
        <div className="border border-ink bg-paper p-4 font-sans text-sm text-ink">
          {state.error}
        </div>
      )}

      {!state.loading && !state.error && state.data && (
        <>
          <div className="border border-hairline bg-paper p-4 font-sans text-sm tabular-nums text-ink-soft">
            {state.data.meta.totalItems} 件（limit={DEFAULT_LIMIT} を明示指定）
          </div>

          {state.data.items.length === 0 ? (
            <div className="border border-hairline bg-paper p-5 font-sans text-sm text-ink-soft">
              この期間のデータはまだありません
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {pagedItems.map((item) => {
                  const hasUrl = item.url.trim().length > 0;
                  const badgeLabel =
                    PLATFORM_BADGE_LABEL[item.platform as Exclude<PlatformFilter, "all">] ?? item.platform;

                  return (
                    <article
                      key={`${item.platform}-${item.id}`}
                      className="border border-hairline bg-paper p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2 font-sans text-wired-meta">
                        <span className="border border-hairline px-2 py-1 font-bold uppercase tracking-widest text-ink">{badgeLabel}</span>
                        <span className="tabular-nums text-ink-soft">{formatUtcToJstDateTime(item.publishedAt)}</span>
                      </div>

                      <h3 className="mt-2 font-sans text-sm font-bold text-ink">{item.title || "（タイトルなし）"}</h3>
                      <p className="mt-1 line-clamp-3 font-sans text-sm text-ink-soft">{item.text || "（本文なし）"}</p>

                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-wired-meta text-ink-soft">
                        <span>author: {item.author || "不明"}</span>
                        {item.sourceName && <span>source: {item.sourceName}</span>}
                      </div>

                      <div className="mt-2 font-sans text-wired-meta text-ink-soft">
                        {hasUrl ? (
                          <a href={item.url} target="_blank" rel="noreferrer" className="text-link underline decoration-link underline-offset-4">
                            {item.url}
                          </a>
                        ) : (
                          <span>URLなし</span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page === 1}
                  className="border border-hairline bg-paper px-3 py-1 font-sans text-wired-meta font-bold uppercase text-ink disabled:opacity-40"
                >
                  前へ
                </button>
                <span className="font-sans text-wired-meta tabular-nums text-ink-soft">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={page >= totalPages}
                  className="border border-hairline bg-paper px-3 py-1 font-sans text-wired-meta font-bold uppercase text-ink disabled:opacity-40"
                >
                  次へ
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
