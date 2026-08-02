"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchJsonOrError, HttpError } from "@/lib/bff/fetch-json-or-error";
import { FeedResponse, FeedResponseSchema } from "@/lib/contracts/feed";
import { formatUtcToJstDateTime } from "@/lib/date-formatter";
import { WiredButton } from "@/components/ui/WiredButton";

const DEFAULT_LIMIT = 200;

type ExplorerState = {
  loading: boolean;
  data: FeedResponse | null;
  error: string | null;
};

function buildErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 401) {
      return `401 Unauthorized: ${error.message}`;
    }

    if (error.status === 400) {
      return `400 Bad Request: ${error.message}`;
    }

    if (error.status >= 500) {
      return `${error.status} Server Error: ${error.message}`;
    }

    return `${error.status} Error: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

export default function ExplorerFeedPanel() {
  const [state, setState] = useState<ExplorerState>({
    loading: true,
    data: null,
    error: null,
  });

  const loadFeed = useCallback(async () => {
    setState({ loading: true, data: null, error: null });

    try {
      const params = new URLSearchParams({
        limit: String(DEFAULT_LIMIT),
      });
      const data = await fetchJsonOrError(`/api/bff/feed?${params.toString()}`, FeedResponseSchema, {
        cache: "no-store",
      });

      setState({ loading: false, data, error: null });
    } catch (error) {
      setState({ loading: false, data: null, error: buildErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  if (state.loading) {
    return (
      <div className="border border-hairline bg-paper p-4 font-sans text-sm text-ink-soft">
        Loading feed from BFF endpoint...
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-3 border border-ink bg-paper p-4 font-sans text-sm text-ink">
        <p className="font-bold">Feed API connection failed</p>
        <p>{state.error}</p>
        <WiredButton
          type="button"
          size="compact"
          onClick={loadFeed}
          className="text-wired-meta"
        >
          Retry
        </WiredButton>
      </div>
    );
  }

  if (!state.data || state.data.items.length === 0) {
    return (
      <div className="space-y-1 border border-hairline bg-paper p-4 font-sans text-sm text-ink-soft">
        <p className="font-bold text-ink">No feed items</p>
        <p>BFF connection succeeded, but the response returned 0 items.</p>
      </div>
    );
  }

  const previewItems = state.data.items.slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="border border-hairline bg-paper p-4 font-sans text-sm">
        <p className="font-bold text-ink">BFF connection OK</p>
        <p className="mt-1 tabular-nums text-ink-soft">
          /api/bff/feed?limit={DEFAULT_LIMIT} · total {state.data.meta.totalItems} items
        </p>
      </div>

      <div className="space-y-2">
        {previewItems.map((item) => (
          <article key={`${item.platform}-${item.id}`} className="border border-hairline bg-paper p-3 font-sans text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-hairline px-2 py-0.5 text-wired-meta font-bold uppercase tracking-widest text-ink">{item.platform}</span>
              <span className="text-wired-meta tabular-nums text-ink-soft">{formatUtcToJstDateTime(item.publishedAt)}</span>
            </div>

            <p className="mt-2 font-bold text-ink">{item.title || "(no title)"}</p>
            <p className="mt-1 line-clamp-2 text-ink-soft">{item.text || "(no text)"}</p>

            <div className="mt-2 text-wired-meta text-ink-soft">
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer" className="text-link underline decoration-link underline-offset-4">
                  {item.url}
                </a>
              ) : (
                <span>URL unavailable</span>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
