export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ARTICLE_QUESTION_BUDGET = 1600;
const EDITION_QUESTION_BUDGET = 2000;
const TRAILING_BARE_URL_PUNCTUATION_RE = /[。、）」』】,.;:!?]+$/u;

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

export function buildArticleAnchorId(date: string, n: number): string {
  return `a-${date}-${n}`;
}

export function parseArticleAnchor(
  hash: string,
): { date: string; n: number } | null {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  const match = /^a-(\d{4}-\d{2}-\d{2})-([1-9]\d*)$/.exec(normalized);

  if (!match || !isIsoDate(match[1])) {
    return null;
  }

  return { date: match[1], n: Number(match[2]) };
}

export function resolveDeepLinkAnchor(
  hash: string,
  appliedDate: string,
): { date: string; n: number } | null {
  const anchor = parseArticleAnchor(hash);
  if (!anchor || anchor.date !== appliedDate) {
    return null;
  }

  return anchor;
}

export function buildEditionUrl(origin: string, date: string): string {
  return `${origin}/calendar?date=${date}`;
}

export function buildEditionMarkdownUrl(origin: string, date: string): string {
  return `${origin}/api/bff/newsletter-editions/latest?format=markdown&date=${date}`;
}

export function buildArticleUrl(
  origin: string,
  date: string,
  n: number,
): string {
  return `${buildEditionUrl(origin, date)}#${buildArticleAnchorId(date, n)}`;
}

export function buildArticlePath(date: string, id: string): string {
  return `/a/${date}/${id}`;
}

export function buildArticleCanonicalUrl(origin: string, date: string, id: string): string {
  return `${origin.replace(/\/$/, "")}${buildArticlePath(date, id)}`;
}

export function formatDateLabelJa(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;

  return `${match[1]}年${match[2]}月${match[3]}日`;
}

export function buildEditionQuestion({
  markdownUrl,
  pageUrl,
  dateLabel,
  masthead,
}: {
  markdownUrl: string;
  pageUrl: string;
  dateLabel: string;
  masthead: string;
}): string {
  const question = `${markdownUrl} は ${dateLabel} 発行のニュース紙面「${masthead}」の Markdown 版です。まずこの URL を開いて内容を読んでください。この URL が読めない場合だけ、HTML 紙面ページ ${pageUrl} を開いてください（どちらも読めない場合はその旨を伝えてください）。この紙面から、今日特に大事そうな記事と、私に合いそうな記事を理由つきで選んでください。選んだ各記事の見出しと引用元 URL を紙面のとおりに添えてください`;

  return fitToEncodedBudget(question, EDITION_QUESTION_BUDGET);
}

export function plainTextFromMarkdown(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:Why it matters:|引用元[:：])/i.test(line))
    .join("\n")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/(?:\*\*|__|~~|`)/g, "")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateText(text: string, max: number): string {
  const codePoints = Array.from(text);
  if (codePoints.length <= max) return text;
  if (max <= 0) return "…";

  return `${codePoints.slice(0, max).join("")}…`;
}

export function fitToEncodedBudget(text: string, budget: number): string {
  if (encodeURIComponent(text).length <= budget) return text;
  if (budget < encodeURIComponent("…").length) return "";

  const codePoints = Array.from(text);
  let low = 0;
  let high = codePoints.length;
  let best = "…";

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${codePoints.slice(0, middle).join("")}…`;

    if (encodeURIComponent(candidate).length <= budget) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best;
}

export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function buildArticleQuestion({
  title,
  sourceUrl,
  summary,
}: {
  title: string;
  sourceUrl: string | null;
  summary: string;
}): string {
  const plainTitle = plainTextFromMarkdown(title);
  const safeTitle = truncateText(plainTitle, 120);
  const safeSourceUrl = isSafeHttpUrl(sourceUrl) ? sourceUrl : "";
  const safeSummary = truncateText(dedupeLeadingTitleSentence(summary, plainTitle), 300);
  const sourceClause = safeSourceUrl
    ? `引用元 ${safeSourceUrl} を読んで、`
    : "";
  const summaryClause = safeSummary ? `。紙面の要約: ${safeSummary}` : "";
  const question = `「${safeTitle}」について、${sourceClause}要点と私にとっての意味を教えて${summaryClause}`;

  return fitToEncodedBudget(question, ARTICLE_QUESTION_BUDGET);
}

function dedupeLeadingTitleSentence(summary: string, title: string): string {
  const plainSummary = plainTextFromMarkdown(summary);
  const sentences = plainSummary.match(/[^。！？.!?]+[。！？.!?]*/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
  if (sentences.length < 2) return plainSummary;

  const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedTitle = normalize(title);
  const firstSentence = normalize(sentences[0].replace(/[。！？.!?]+$/, ""));
  if (normalizedTitle && (firstSentence === normalizedTitle ||
    (Array.from(normalizedTitle).length >= 12 && firstSentence.startsWith(normalizedTitle)))) {
    return sentences.slice(1).join(" ");
  }
  return plainSummary;
}

export type ShareTargets = { x: string; facebook: string; copy: string; canonical: string };

export function buildShareTargets({ canonicalUrl, title, masthead }: {
  canonicalUrl: string;
  title: string;
  masthead: string;
}): ShareTargets {
  const canonical = new URL(canonicalUrl);
  canonical.search = "";
  canonical.hash = "";
  const target = (source: string) => {
    const url = new URL(canonical);
    url.searchParams.set("utm_source", source);
    url.searchParams.set("utm_medium", "share");
    return url.toString();
  };
  return {
    x: `https://x.com/intent/post?text=${encodeURIComponent(`${title} | ${masthead}`)}&url=${encodeURIComponent(target("x"))}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(target("facebook"))}`,
    copy: target("copy"),
    canonical: canonical.toString(),
  };
}

export function buildShareUrls({
  url,
  title,
}: {
  url: string;
  title: string;
}): { x: string; facebook: string } {
  return {
    x: `https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  };
}

export const AI_SERVICES: ReadonlyArray<{
  id: "chatgpt" | "claude" | "perplexity" | "gemini";
  name: string;
  mode: "prefill" | "copy";
  baseUrl: string;
}> = Object.freeze([
  {
    id: "chatgpt",
    name: "ChatGPT",
    mode: "prefill",
    baseUrl: "https://chatgpt.com/?q=",
  },
  {
    id: "claude",
    name: "Claude",
    mode: "prefill",
    baseUrl: "https://claude.ai/new?q=",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    mode: "prefill",
    baseUrl: "https://www.perplexity.ai/search?q=",
  },
  {
    id: "gemini",
    name: "Gemini",
    mode: "copy",
    baseUrl: "https://gemini.google.com/app",
  },
]);

export function buildAiServiceTarget(
  id: (typeof AI_SERVICES)[number]["id"],
  question: string,
): { mode: "prefill" | "copy"; url: string } {
  const service = AI_SERVICES.find((candidate) => candidate.id === id);
  if (!service) {
    throw new Error(`Unknown AI service: ${id}`);
  }

  return {
    mode: service.mode,
    url:
      service.mode === "prefill"
        ? `${service.baseUrl}${encodeURIComponent(question)}`
        : service.baseUrl,
  };
}

export function extractFirstExternalUrl(...texts: string[]): string | null {
  for (const text of texts) {
    const markdownMatch = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i.exec(text);
    const bareMatch = /https?:\/\/[^\s)]+/i.exec(text);

    if (!markdownMatch && !bareMatch) continue;
    if (
      markdownMatch &&
      (!bareMatch || markdownMatch.index <= bareMatch.index)
    ) {
      return markdownMatch[1];
    }

    return bareMatch?.[0].replace(TRAILING_BARE_URL_PUNCTUATION_RE, "") ?? null;
  }

  return null;
}
