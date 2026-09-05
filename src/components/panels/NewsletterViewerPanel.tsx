"use client";

import { cloneElement, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { type Article, parseNewsletterMarkdown } from "@/lib/reader/newsletter-markdown";
import { articleIdFromSource } from "@/lib/reader/article-id";
import { renderMarkdown } from "@/lib/reader/markdown-render";

import { ArticleActions } from "@/components/reader/ArticleActions";
import { AskAiBanner } from "@/components/reader/AskAiBanner";
import {
  buildArticleAnchorId,
  buildArticlePath,
  buildEditionQuestion,
  buildEditionUrl,
  extractFirstExternalUrl,
  formatDateLabelJa,
  isIsoDate,
  resolveDeepLinkAnchor,
} from "@/components/reader/reader-links";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Headline } from "@/components/ui/Headline";
import { Rule } from "@/components/ui/Rule";
import { fetchJsonOrError, HttpError } from "@/lib/bff/fetch-json-or-error";
import {
  NewsletterEdition,
  NewsletterEditionItem,
  NewsletterLatestResponseSchema,
} from "@/lib/contracts/newsletter";
import { formatUtcToJstDate } from "@/lib/date-formatter";

type ViewerState = {
  loading: boolean;
  edition: NewsletterEdition | null;
  markdown: string | null;
  emptyDay: boolean;
  error: string | null;
};

type NewsletterViewerPanelProps = {
  masthead: string;
};

type DayIndicator = {
  known: boolean;
  hasData: boolean;
  bindingsCount: number;
};

type CalendarCell = {
  date: string;
  day: number;
  inCurrentMonth: boolean;
};

type OgImageState = { status: "idle" | "loading" | "loaded" | "none"; imageUrl?: string };

const STATUS_LABELS: Record<string, string> = {
  draft: "下書き",
  published: "公開済み",
};

const TRUST_BADGE_LABELS: Record<string, string> = {
  unknown: "未検証/単一ソース",
  low: "低信頼",
};

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
function parseIsoDateToUtcDate(date: string): Date {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid ISO date: ${date}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDateToIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthStartFromIso(date: string): Date {
  const parsed = parseIsoDateToUtcDate(date);
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(date: Date, delta: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1));
}

function formatMonthLabel(date: Date): string {
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月`;
}

function listMonthDates(date: Date): string[] {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return Array.from({ length: daysInMonth }, (_, index) => {
    return formatUtcDateToIso(new Date(Date.UTC(year, month, index + 1)));
  });
}

function buildCalendarCells(date: Date): CalendarCell[] {
  const firstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const start = new Date(firstOfMonth);
  start.setUTCDate(start.getUTCDate() - firstOfMonth.getUTCDay());

  const lastOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  const end = new Date(lastOfMonth);
  end.setUTCDate(end.getUTCDate() + (6 - lastOfMonth.getUTCDay()));

  const cells: CalendarCell[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    cells.push({
      date: formatUtcDateToIso(cursor),
      day: cursor.getUTCDate(),
      inCurrentMonth: cursor.getUTCMonth() === firstOfMonth.getUTCMonth(),
    });
  }

  return cells;
}

function formatDateLabel(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  return `${match[1]}年${match[2]}月${match[3]}日`;
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
      return `日付を確認してください: ${error.message}`;
    }

    return `${error.status}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "不明なエラーが発生しました";
}

async function fetchNewsletterMarkdown(date: string): Promise<string> {
  const params = new URLSearchParams({
    date,
    format: "markdown",
  });

  const response = await fetch(`/api/bff/newsletter-editions/latest?${params.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const bodyText = await response.text();
    let message = `HTTP ${response.status}`;

    try {
      const parsed = JSON.parse(bodyText) as { error?: unknown };
      if (typeof parsed.error === "string") {
        message = parsed.error;
      }
    } catch {
      if (bodyText.trim()) {
        message = bodyText.trim();
      }
    }

    throw new HttpError(message, response.status);
  }

  return response.text();
}

async function fetchDayIndicator(date: string): Promise<DayIndicator> {
  const jsonParams = new URLSearchParams({
    date,
    includeContent: "0",
    includeItems: "0",
  });

  const jsonData = await fetchJsonOrError(
    `/api/bff/newsletter-editions/latest?${jsonParams.toString()}`,
    NewsletterLatestResponseSchema,
    { cache: "no-store" },
  );

  const bindingsCount = jsonData.edition.bindingsCount;
  return {
    known: true,
    hasData: bindingsCount > 0,
    bindingsCount,
  };
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function extractFirstExternalArticleUrl(...texts: string[]): string | null {
  for (const text of texts) {
    const markdownMatch = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i.exec(text);
    const bareMatch = /https?:\/\/[^\s)]+/i.exec(text);

    if (!markdownMatch && !bareMatch) {
      continue;
    }

    if (markdownMatch && (!bareMatch || markdownMatch.index <= bareMatch.index)) {
      return markdownMatch[1];
    }

    return bareMatch?.[0] ?? null;
  }

  return null;
}

function normalizeArticleUrl(rawUrl: string | null | undefined): string | null {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLowerCase();
    const normalized = url.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  }
}

function trustBadgeLabelForArticle(
  article: Article,
  items: NewsletterEditionItem[] | undefined,
): string | null {
  if (!items || items.length === 0) return null;

  const badgeItems = items.filter((item) => item.trustLabel && TRUST_BADGE_LABELS[item.trustLabel]);
  if (badgeItems.length === 0) return null;

  const articleUrl = normalizeArticleUrl(extractFirstExternalArticleUrl(article.source));
  if (!articleUrl) return null;

  const matchedByUrl = badgeItems.find((item) => normalizeArticleUrl(item.url) === articleUrl);
  return matchedByUrl?.trustLabel ? TRUST_BADGE_LABELS[matchedByUrl.trustLabel] || null : null;
}

export default function NewsletterViewerPanel(props: NewsletterViewerPanelProps) {
  return (
    <Suspense fallback={<div className="border border-hairline bg-paper p-5 font-sans text-wired-meta text-ink/60">読み込み中...</div>}>
      <NewsletterViewerPanelContent {...props} />
    </Suspense>
  );
}

function NewsletterViewerPanelContent({ masthead }: NewsletterViewerPanelProps) {
  const searchParams = useSearchParams();
  const urlDate = searchParams.get("date");
  const prevUrlDateRef = useRef(urlDate);
  const today = formatUtcToJstDate(new Date());
  const initialDate = isIsoDate(urlDate) ? urlDate : today;
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [appliedDate, setAppliedDate] = useState(initialDate);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStartFromIso(initialDate));
  const [state, setState] = useState<ViewerState>({
    loading: true,
    edition: null,
    markdown: null,
    emptyDay: false,
    error: null,
  });

  const [dayIndicators, setDayIndicators] = useState<Record<string, DayIndicator>>({});
  const [indicatorLoading, setIndicatorLoading] = useState(false);
  const [indicatorError, setIndicatorError] = useState<string | null>(null);
  const [ogImages, setOgImages] = useState<Record<string, OgImageState>>({});
  const [origin, setOrigin] = useState("");
  const [locationHash, setLocationHash] = useState("");

  const monthIndicatorCache = useRef<Record<string, Record<string, DayIndicator>>>({});
  const indicatorRequestSeq = useRef(0);
  const editionRequestSeq = useRef(0);
  const ogImageRequestKeys = useRef<Set<string>>(new Set());
  const ogImageEpochRef = useRef(0);
  const previousMarkdownRef = useRef<string | null>(null);
  const renderedEditionDateRef = useRef<string | null>(null);
  const lastDeepLinkRef = useRef<string | null>(null);

  const applyDate = useCallback((date: string) => {
    setSelectedDate(date);
    setAppliedDate(date);
    setVisibleMonth(monthStartFromIso(date));
  }, []);

  const loadEdition = useCallback(async (date: string) => {
    const requestId = ++editionRequestSeq.current;
    if (editionRequestSeq.current !== requestId) return;
    renderedEditionDateRef.current = null;
    setState({ loading: true, edition: null, markdown: null, emptyDay: false, error: null });

    const jsonParams = new URLSearchParams({
      date,
      includeContent: "0",
      includeItems: "1",
    });

    try {
      const jsonData = await fetchJsonOrError(
        `/api/bff/newsletter-editions/latest?${jsonParams.toString()}`,
        NewsletterLatestResponseSchema,
        { cache: "no-store" },
      );

      try {
        const markdown = await fetchNewsletterMarkdown(date);
        if (editionRequestSeq.current !== requestId) return;
        renderedEditionDateRef.current = date;
        setState({
          loading: false,
          edition: jsonData.edition,
          markdown,
          emptyDay: false,
          error: null,
        });
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          if (editionRequestSeq.current !== requestId) return;
          setState({
            loading: false,
            edition: jsonData.edition,
            markdown: null,
            emptyDay: true,
            error: null,
          });
          return;
        }

        if (editionRequestSeq.current !== requestId) return;
        setState({
          loading: false,
          edition: null,
          markdown: null,
          emptyDay: false,
          error: buildErrorMessage(error),
        });
      }
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        if (editionRequestSeq.current !== requestId) return;
        setState({ loading: false, edition: null, markdown: null, emptyDay: true, error: null });
        return;
      }

      if (editionRequestSeq.current !== requestId) return;
      setState({ loading: false, edition: null, markdown: null, emptyDay: false, error: buildErrorMessage(error) });
    }
  }, []);

  const loadMonthIndicators = useCallback(async (monthDate: Date) => {
    const key = monthKey(monthDate);
    const cached = monthIndicatorCache.current[key];
    if (cached) {
      setDayIndicators(cached);
      setIndicatorError(null);
      setIndicatorLoading(false);
      return;
    }

    const requestId = ++indicatorRequestSeq.current;
    setIndicatorLoading(true);
    setIndicatorError(null);

    const dates = listMonthDates(monthDate);
    let firstNon404Error: string | null = null;

    const entries = await Promise.all(
      dates.map(async (date) => {
        try {
          const indicator = await fetchDayIndicator(date);
          return [date, indicator] as const;
        } catch (error) {
          if (error instanceof HttpError && error.status === 404) {
            return [date, { known: true, hasData: false, bindingsCount: 0 }] as const;
          }

          if (!firstNon404Error) {
            firstNon404Error = buildErrorMessage(error);
          }

          return [date, { known: false, hasData: false, bindingsCount: 0 }] as const;
        }
      }),
    );

    if (indicatorRequestSeq.current !== requestId) {
      return;
    }

    const indicatorMap = Object.fromEntries(entries);
    monthIndicatorCache.current[key] = indicatorMap;

    setDayIndicators(indicatorMap);
    setIndicatorLoading(false);
    if (firstNon404Error) {
      setIndicatorError(`一部の日付の取得に失敗しました（${firstNon404Error}）`);
    }
  }, []);

  const handleArticleOpen = useCallback(
    (sectionIdx: number, articleIdx: number, source: string, body: string) => {
      const key = `${sectionIdx}-${articleIdx}`;
      const existing = ogImages[key];
      if ((existing && existing.status !== "idle") || ogImageRequestKeys.current.has(key)) {
        return;
      }

      const requestEpoch = ogImageEpochRef.current;
      const url = extractFirstExternalArticleUrl(source, body);
      ogImageRequestKeys.current.add(key);

      if (!url) {
        if (requestEpoch === ogImageEpochRef.current) {
          setOgImages((current) => ({ ...current, [key]: { status: "none" } }));
        }
        return;
      }

      setOgImages((current) => ({ ...current, [key]: { status: "loading" } }));

      void fetch(`/api/bff/og-image?url=${encodeURIComponent(url)}`)
        .then(async (response) => {
          if (!response.ok) {
            return null;
          }

          const payload = (await response.json()) as { imageUrl?: unknown };
          return typeof payload.imageUrl === "string" && payload.imageUrl ? payload.imageUrl : null;
        })
        .then((imageUrl) => {
          if (requestEpoch !== ogImageEpochRef.current) {
            return;
          }

          setOgImages((current) => ({
            ...current,
            [key]: imageUrl ? { status: "loaded", imageUrl } : { status: "none" },
          }));
        })
        .catch(() => {
          if (requestEpoch !== ogImageEpochRef.current) {
            return;
          }

          setOgImages((current) => ({ ...current, [key]: { status: "none" } }));
        });
    },
    [ogImages],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentDate = params.get("date");
    const nextHash = resolveDeepLinkAnchor(window.location.hash, appliedDate) ? window.location.hash : "";
    params.set("date", appliedDate);

    if (currentDate !== appliedDate || nextHash !== window.location.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}${nextHash}`);
    }

    setLocationHash(nextHash);
  }, [appliedDate]);

  useEffect(() => {
    if (urlDate === prevUrlDateRef.current) return;
    prevUrlDateRef.current = urlDate;
    if (isIsoDate(urlDate) && urlDate !== appliedDate) applyDate(urlDate);
  }, [appliedDate, applyDate, urlDate]);

  useEffect(() => {
    const syncHash = () => setLocationHash(window.location.hash);
    setOrigin(window.location.origin);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useEffect(() => {
    loadEdition(appliedDate);
  }, [appliedDate, loadEdition]);

  useEffect(() => {
    loadMonthIndicators(visibleMonth);
  }, [visibleMonth, loadMonthIndicators]);

  useEffect(() => {
    if (previousMarkdownRef.current === state.markdown) {
      return;
    }

    previousMarkdownRef.current = state.markdown;
    ogImageEpochRef.current += 1;
    ogImageRequestKeys.current.clear();
    setOgImages({});
  }, [state.markdown]);

  const calendarCells = useMemo(() => buildCalendarCells(visibleMonth), [visibleMonth]);
  const parsedNewsletter = useMemo(() => (state.markdown ? parseNewsletterMarkdown(state.markdown) : null), [state.markdown]);

  useEffect(() => {
    if (!parsedNewsletter || !state.markdown || !locationHash || renderedEditionDateRef.current !== appliedDate) return;

    const deepLinkKey = `${locationHash}\u0000${state.markdown}`;
    if (lastDeepLinkRef.current === deepLinkKey) return;
    lastDeepLinkRef.current = deepLinkKey;

    const anchor = resolveDeepLinkAnchor(locationHash, appliedDate);
    if (!anchor) return;

    const element = document.getElementById(buildArticleAnchorId(anchor.date, anchor.n));
    if (!element) return;

    const categoryDetails = element.closest("details") as HTMLDetailsElement | null;
    const articleDetails = element.querySelector("details") as HTMLDetailsElement | null;
    if (!categoryDetails || !articleDetails) return;

    categoryDetails.open = true;
    articleDetails.open = true;
    document.querySelector(".is-target")?.classList.remove("is-target");
    element.classList.add("is-target");
    element.scrollIntoView({ block: "start" });
  }, [appliedDate, locationHash, parsedNewsletter, state.markdown]);

  let articleCounter = 0;
  const seenArticleIds = new Set<string>();

  return (
    <div className="flex flex-col gap-8 pb-28 lg:flex-row lg:items-start">
      <section id="reader-calendar" className="border border-hairline bg-paper p-4 lg:w-[320px] lg:shrink-0">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setVisibleMonth((current) => shiftMonth(current, -1))}
            className="border border-ink bg-paper px-3 py-2 font-sans text-wired-eyebrow font-bold uppercase text-ink hover:bg-ink hover:text-paper"
          >
            前月
          </button>

          <Eyebrow>{formatMonthLabel(visibleMonth)}</Eyebrow>

          <button
            type="button"
            onClick={() => setVisibleMonth((current) => shiftMonth(current, 1))}
            className="border border-ink bg-paper px-3 py-2 font-sans text-wired-eyebrow font-bold uppercase text-ink hover:bg-ink hover:text-paper"
          >
            次月
          </button>
        </div>

        <div className="mt-4 grid grid-cols-7 border-y border-hairline py-2 text-center font-sans text-wired-eyebrow font-bold uppercase text-ink">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-7">
          {calendarCells.map((cell) => {
            const indicator = dayIndicators[cell.date];
            const isSelected = selectedDate === cell.date;
            const isToday = today === cell.date;
            const isNoData = cell.inCurrentMonth && indicator?.known && !indicator.hasData;

            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => applyDate(cell.date)}
                className={`relative -ml-px -mt-px flex h-11 items-center justify-center border font-sans text-sm transition-colors ${
                  isSelected
                    ? "border-ink bg-ink font-bold text-paper"
                    : cell.inCurrentMonth
                      ? isNoData
                        ? "border-hairline bg-paper text-ink/35 hover:text-ink/60"
                        : "border-hairline bg-paper text-ink hover:bg-ink hover:text-paper"
                      : "border-hairline bg-paper text-ink/40 hover:text-ink/50"
                } ${isToday && !isSelected ? "z-10 border-ink" : ""}`}
                aria-label={`${formatDateLabel(cell.date)}を表示`}
              >
                <span>{cell.day}</span>

                {indicator?.known && indicator.hasData && (
                  <span
                    className={`absolute bottom-1 h-1.5 w-1.5 ${isSelected ? "bg-paper" : "bg-ink"}`}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-5 space-y-3">
          <label className="space-y-2 font-sans text-wired-eyebrow font-bold uppercase text-ink">
            <span>日付（JST）</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => {
                const nextDate = event.target.value;
                if (!nextDate) return;
                setSelectedDate(nextDate);
                setVisibleMonth(monthStartFromIso(nextDate));
              }}
              className="w-full border border-ink bg-paper px-3 py-2 font-sans text-sm font-normal text-ink"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAppliedDate(selectedDate)}
              className="border border-ink bg-ink px-3 py-2 font-sans text-wired-eyebrow font-bold uppercase text-paper hover:opacity-90"
            >
              この日を表示
            </button>
            <button
              type="button"
              onClick={() => applyDate(today)}
              className="border border-ink bg-paper px-3 py-2 font-sans text-wired-eyebrow font-bold uppercase text-ink hover:bg-ink hover:text-paper"
            >
              今日へ
            </button>
          </div>
        </div>

        <p className="mt-4 font-sans text-wired-meta text-ink/60">■ はデータあり日（bindingsCount &gt; 0）</p>
        {indicatorLoading && <p className="mt-1 font-sans text-wired-meta text-ink/60">日付インジケーター更新中...</p>}
        {indicatorError && <p className="mt-1 border border-ink p-2 font-sans text-wired-meta text-ink">{indicatorError}</p>}
      </section>

      <div className="min-w-0 flex-1 space-y-6">
        <section className="border-b-4 border-ink bg-paper pb-5">
          <Eyebrow>Issue Date</Eyebrow>
          <Headline level="md" as="h2" className="mt-2">
            {masthead}
          </Headline>
          <p className="mt-2 font-sans text-wired-meta text-ink/60">{formatDateLabel(appliedDate)}</p>
        </section>

        {state.loading && (
          <div className="border border-hairline bg-paper p-5 font-sans text-wired-meta text-ink/60">読み込み中...</div>
        )}

        {!state.loading && state.error && (
          <div className="border border-ink bg-paper p-5 font-sans text-wired-meta font-bold uppercase text-ink">
            {state.error}
          </div>
        )}

        {!state.loading && !state.error && state.emptyDay && (
          <div className="border border-hairline bg-paper p-6 font-wired-serif text-lg leading-8 text-ink/70">
            この日のニュースはまだ製本されていません
          </div>
        )}

        {!state.loading && !state.error && state.edition && state.markdown && (
          <>
            <section className="border border-hairline bg-paper p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`border px-3 py-1 font-sans text-wired-eyebrow font-bold uppercase ${
                    state.edition.status === "published"
                      ? "border-ink bg-ink text-paper"
                      : "border-ink bg-paper text-ink"
                  }`}
                >
                  {statusLabel(state.edition.status)}
                </span>
                <span className="font-sans text-wired-meta text-ink/60">記事数: {state.edition.bindingsCount}件</span>
                <span className="font-sans text-wired-meta text-ink/60">文字数: {state.edition.contentChars}字</span>
              </div>
            </section>

            <article className="bg-paper">
              {!parsedNewsletter || parsedNewsletter.sections.length === 0 ? (
                renderMarkdown(state.markdown)
              ) : (
                <div className="space-y-8">
                  {parsedNewsletter.title && (
                    <Headline level="lg" as="h1">
                      {parsedNewsletter.title}
                    </Headline>
                  )}

                  {parsedNewsletter.preamble && renderMarkdown(parsedNewsletter.preamble)}

                  <div className="space-y-5">
                    {parsedNewsletter.sections.map((section, sectionIdx) => (
                      <details
                        key={`${sectionIdx}-${section.title}`}
                        className="group/category border border-hairline bg-paper p-5"
                      >
                        <summary className="flex cursor-pointer select-none items-center gap-3 marker:hidden [&::-webkit-details-marker]:hidden">
                          <span
                            aria-hidden="true"
                            className="font-sans text-wired-meta text-ink/60 transition-transform group-open/category:rotate-90"
                          >
                            ▶
                          </span>
                          <Headline level="sm" as="span">
                            {section.title}
                          </Headline>
                        </summary>
                        <Rule className="mt-4" />

                        {section.intro && (
                          <div className="mt-4">
                            {renderMarkdown(section.intro)}
                          </div>
                        )}

                        {section.articles.length > 0 && (
                          <div className="mt-5 space-y-3">
                            {section.articles.map((article, articleIdx) => {
                              const trustBadgeLabel = trustBadgeLabelForArticle(article, state.edition?.items);
                              const articleNumber = ++articleCounter;
                              const anchorId = buildArticleAnchorId(appliedDate, articleNumber);
                              const sourceUrl = extractFirstExternalUrl(article.source, article.body);
                              const articleId = articleIdFromSource(article.source);
                              const articleUrl = articleId && !seenArticleIds.has(articleId)
                                ? buildArticlePath(appliedDate, articleId) : null;
                              if (articleId) seenArticleIds.add(articleId);

                              return (
                                <div
                                  key={`${sectionIdx}-${articleIdx}-${article.title}`}
                                  id={anchorId}
                                  className="scroll-mt-24 border-t border-hairline pt-4 [&.is-target]:outline [&.is-target]:outline-2 [&.is-target]:outline-ink [&.is-target]:outline-offset-[6px]"
                                >
                                  <details
                                    className="group/article"
                                    onToggle={(event) => {
                                      if ((event.target as HTMLDetailsElement).open) {
                                        handleArticleOpen(sectionIdx, articleIdx, article.source, article.body);
                                      }
                                    }}
                                  >
                                    <summary className="flex cursor-pointer select-none items-start gap-3 marker:hidden [&::-webkit-details-marker]:hidden">
                                      <span
                                        aria-hidden="true"
                                        className="mt-1 font-sans text-wired-meta text-ink/60 transition-transform group-open/article:rotate-90"
                                      >
                                        ▶
                                      </span>
                                      <span className="min-w-0">
                                        <span className="flex flex-wrap items-center gap-2">
                                          <span className="font-sans text-lg font-bold leading-6 text-ink">{article.title}</span>
                                          {trustBadgeLabel && (
                                            <span className="border border-ink bg-paper px-2 py-0.5 font-sans text-wired-eyebrow font-bold uppercase text-ink">
                                              {trustBadgeLabel}
                                            </span>
                                          )}
                                        </span>
                                        {article.source && (
                                          <span className="mt-2 block font-sans text-wired-meta text-ink/60">
                                            <Eyebrow className="mr-2">引用元</Eyebrow>
                                            {cloneElement(
                                              renderMarkdown(article.source, {
                                                p: ({ children }) => <>{children}</>,
                                              }),
                                              { className: undefined },
                                            )}
                                          </span>
                                        )}
                                      </span>
                                    </summary>

                                    {article.body && (
                                      <div className="mt-4 pl-6">
                                        {(() => {
                                          const articleOgImage = ogImages[`${sectionIdx}-${articleIdx}`];
                                          return articleOgImage?.status === "loaded" ? (
                                            <img
                                              src={articleOgImage.imageUrl}
                                              loading="lazy"
                                              alt=""
                                              className="mb-4 max-h-56 w-auto border border-hairline object-cover"
                                            />
                                          ) : null;
                                        })()}
                                        {renderMarkdown(article.body)}
                                      </div>
                                    )}
                                  </details>

                                  <ArticleActions
                                    anchorId={anchorId}
                                    articleUrl={articleUrl}
                                    editionUrl={buildEditionUrl(origin, appliedDate)}
                                    masthead={masthead}
                                    title={article.title}
                                    sourceUrl={sourceUrl}
                                    summary={article.body}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </details>
                    ))}
                  </div>
                </div>
              )}
            </article>

            {origin && (
              <AskAiBanner
                pageUrl={buildEditionUrl(origin, appliedDate)}
                question={buildEditionQuestion({
                  url: buildEditionUrl(origin, appliedDate),
                  dateLabel: formatDateLabelJa(appliedDate),
                  masthead,
                })}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
