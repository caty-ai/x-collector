"use client";

import React, { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  AI_SERVICES,
  buildAiServiceTarget,
  buildArticleQuestion,
  isSafeHttpUrl,
} from "@/components/reader/reader-links";

type ArticleAiMenuProps = {
  anchorId: string;
  title: string;
  sourceUrl: string | null;
  summary: string;
};

const ACTION_BUTTON_CLASS =
  "min-h-11 border px-2.5 py-1.5 font-sans text-wired-eyebrow font-bold uppercase md:min-h-9";
const SECONDARY_BUTTON_CLASS = `${ACTION_BUTTON_CLASS} border-hairline hover:border-ink`;

export function ArticleAiMenu({
  anchorId,
  title,
  sourceUrl,
  summary,
}: ArticleAiMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const menuId = `${anchorId}-ai-menu`;
  const question = useMemo(
    () => buildArticleQuestion({ title, sourceUrl, summary }),
    [sourceUrl, summary, title],
  );

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      toggleRef.current?.focus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen]);

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

  const handleAiService = (
    event: MouseEvent<HTMLButtonElement>,
    serviceId: (typeof AI_SERVICES)[number]["id"],
  ) => {
    stopAction(event);
    const target = buildAiServiceTarget(serviceId, question);
    if (!isSafeHttpUrl(target.url)) return;

    window.open(target.url, "_blank", "noopener,noreferrer");
    if (target.mode === "copy") {
      copyText(question, "質問文をコピーしました");
    }
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <div className="flex items-center">
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={isOpen}
          aria-controls={menuId}
          onClick={(event) => {
            stopAction(event);
            setIsOpen((current) => !current);
          }}
          className={`${ACTION_BUTTON_CLASS} shrink-0 whitespace-nowrap border-ink ${isOpen ? "bg-ink text-paper" : "bg-paper text-ink"}`}
        >
          AIに聞く <span aria-hidden="true">{isOpen ? "▴" : "▾"}</span>
        </button>
      </div>

      {isOpen && (
        <div
          id={menuId}
          className="absolute left-0 top-full z-20 mt-2 w-80 max-w-[calc(100vw-2.5rem)] border border-ink bg-paper p-3"
        >
          <p className="font-sans text-wired-eyebrow font-bold uppercase text-ink">
            この記事についてAIに聞く
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {AI_SERVICES.map((service) => (
              <button
                key={service.id}
                type="button"
                onClick={(event) => handleAiService(event, service.id)}
                className={`${SECONDARY_BUTTON_CLASS} text-left text-ink`}
              >
                {service.id === "gemini" ? "Gemini（コピー）" : service.name}
              </button>
            ))}
          </div>
          <div className="mt-2 max-h-24 overflow-y-auto break-words border border-hairline bg-paper/60 p-2 font-sans text-wired-meta text-ink/70">
            {question}
          </div>
        </div>
      )}

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
