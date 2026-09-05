import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Article, ParsedNewsletter } from "./newsletter-markdown";

export const ARTICLE_ID_RE = /^[0-9a-f]{12}$/;

/** Extract only from a parsed source field; never pass an article body. */
export function extractSourceUrl(source: string): string | null {
  const markdownMatch = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i.exec(source);
  if (markdownMatch) return markdownMatch[1];
  const bareMatch = /https?:\/\/[^\s)]+/i.exec(source);
  return bareMatch?.[0].replace(/[。、）」』】,.;:!?]+$/u, "") ?? null;
}

/**
 * Frozen article identity rules: accept http(s) only, reject userinfo, lowercase
 * scheme and host, remove default ports and fragments. Drop query keys matching
 * utm_* or fbclid, gclid, mc_cid, mc_eid, igshid, ref_src (case-insensitively).
 * Keep every other key (including s), sorting pairs by key then value using
 * code-unit order. Strip trailing slashes on non-root paths; retain the root /.
 * URL serialization canonicalizes escaping. Normalization is idempotent.
 * Never unify mobile hosts or follow redirects. Changing these rules changes IDs.
 */
export function normalizeSourceUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null;
    parsed.hash = "";
    const pairs = Array.from(parsed.searchParams.entries()).filter(
      ([key]) => !/^(?:utm_.*|fbclid|gclid|mc_cid|mc_eid|igshid|ref_src)$/i.test(key),
    );
    const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    pairs.sort(([ak, av], [bk, bv]) => compare(ak, bk) || compare(av, bv));
    parsed.search = "";
    for (const [key, value] of pairs) parsed.searchParams.append(key, value);
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function articleIdFromSource(source: string): string | null {
  const extracted = extractSourceUrl(source);
  const normalized = extracted === null ? null : normalizeSourceUrl(extracted);
  return normalized === null ? null : bytesToHex(sha256(new TextEncoder().encode(normalized))).slice(0, 12);
}

/** Index in document order: first ID wins; total includes source-less duplicates. */
export function indexArticles(parsed: ParsedNewsletter): {
  byId: Map<string, { sectionIndex: number; articleIndex: number; article: Article; sectionTitle: string }>;
  total: number;
} {
  const byId = new Map<string, { sectionIndex: number; articleIndex: number; article: Article; sectionTitle: string }>();
  let total = 0;
  parsed.sections.forEach((section, sectionIndex) => {
    section.articles.forEach((article, articleIndex) => {
      total += 1;
      const id = articleIdFromSource(article.source);
      if (id !== null && !byId.has(id)) {
        byId.set(id, { sectionIndex, articleIndex, article, sectionTitle: section.title });
      }
    });
  });
  return { byId, total };
}
