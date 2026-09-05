"use client";

import React, { type MouseEvent, useEffect, useRef, useState } from "react";

import {
  buildShareTargets,
  isSafeHttpUrl,
} from "@/components/reader/reader-links";

import { ArticleAiMenu } from "@/components/reader/ArticleAiMenu";

type ArticleActionsProps = {
  anchorId: string;
  articleUrl: string | null;
  editionUrl: string;
  masthead: string;
  title: string;
  sourceUrl: string | null;
  summary: string;
};

const ACTION_BUTTON_CLASS =
  "min-h-11 border px-2.5 py-1.5 font-sans text-wired-eyebrow font-bold uppercase md:min-h-9";
const SECONDARY_BUTTON_CLASS = `${ACTION_BUTTON_CLASS} border-hairline hover:border-ink`;

export function ArticleActions({
  anchorId,
  articleUrl,
  editionUrl,
  masthead,
  title,
  sourceUrl,
  summary,
}: ArticleActionsProps) {
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!fallbackText) return;
    fallbackRef.current?.focus();
    fallbackRef.current?.select();
  }, [fallbackText]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = (message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2000);
  };

  const copyText = (text: string, successMessage: string) => {
    setFallbackText(null);

    if (
      !navigator.clipboard ||
      typeof navigator.clipboard.writeText !== "function"
    ) {
      setFallbackText(text);
      return;
    }

    try {
      void Promise.resolve(navigator.clipboard.writeText(text)).then(
        () => showToast(successMessage),
        () => setFallbackText(text),
      );
    } catch {
      setFallbackText(text);
    }
  };

  const stopAction = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const shareTargets = () => articleUrl
    ? buildShareTargets({ canonicalUrl: new URL(articleUrl, window.location.origin).toString(), title, masthead })
    : null;

  const openExternal = (event: MouseEvent<HTMLButtonElement>, url: string) => {
    stopAction(event);
    if (!isSafeHttpUrl(url)) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="relative">
      <div className="mt-3 flex flex-nowrap items-center gap-1.5 pl-0 md:gap-2 md:pl-6">
        <ArticleAiMenu
          key={anchorId}
          anchorId={anchorId}
          title={title}
          sourceUrl={sourceUrl}
          summary={summary}
        />

        <span aria-hidden="true" className="h-4 w-px shrink-0 bg-hairline" />

        {articleUrl && (
          <>
            <button
              type="button"
              aria-label="Xでシェア"
              title="Xでシェア"
              onClick={(event) => {
                const targets = shareTargets();
                if (targets) openExternal(event, targets.x);
              }}
              className={`${SECONDARY_BUTTON_CLASS} shrink-0`}
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817-5.967 6.817H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
              </svg>
            </button>

            <button
              type="button"
              aria-label="Facebookでシェア"
              title="Facebookでシェア"
              onClick={(event) => {
                const targets = shareTargets();
                if (targets) openExternal(event, targets.facebook);
              }}
              className={`${SECONDARY_BUTTON_CLASS} shrink-0`}
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M13.5 22v-9h3l.5-3.5h-3.5V7.25c0-1 .28-1.75 1.75-1.75H17V2.38A23.7 23.7 0 0 0 14.44 2C11.9 2 10 3.55 10 6.4v3.1H7V13h3v9h3.5Z" />
              </svg>
            </button>

          </>
        )}

        <button
          type="button"
          aria-label="リンクをコピー"
          onClick={(event) => {
            stopAction(event);
            copyText(shareTargets()?.copy ?? new URL(editionUrl, window.location.origin).toString(), "リンクをコピーしました");
          }}
          className={`${SECONDARY_BUTTON_CLASS} flex shrink-0 items-center gap-1 whitespace-nowrap`}
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          コピー
        </button>
      </div>

      {fallbackText && (
        <>
          <p className="mt-2 font-sans text-wired-meta text-ink/70 md:ml-6">
            自動コピーできませんでした。下のテキストをコピーしてください
          </p>
          <textarea
            ref={fallbackRef}
            readOnly
            value={fallbackText}
            aria-label="コピーするテキスト"
            className="mt-2 min-h-24 w-full break-words border border-ink bg-paper p-2 font-sans text-wired-meta text-ink md:ml-6"
          />
        </>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="absolute left-0 top-full z-10 mt-1 bg-ink px-3 py-1.5 font-sans text-wired-meta text-paper md:left-6"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
