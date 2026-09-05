import type { NextRequest } from "next/server";
import { getMasthead, getTagline } from "@/lib/masthead";
import { resolveSiteUrl } from "@/lib/reader/edition-meta";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = resolveSiteUrl() ?? req.nextUrl.origin;
  const body = `# ${getMasthead()}

> ${getTagline()}

This is a daily AI-news edition compiled by x-collector. Each edition is a curated set of articles with Japanese summaries and source links. Assistants should read the markdown edition rather than the HTML page.

## Editions

- [Latest edition (markdown)](${origin}/api/bff/newsletter-editions/latest?format=markdown): the most recent published edition
- [Edition by date (markdown)](${origin}/api/bff/newsletter-editions/latest?format=markdown&date=YYYY-MM-DD): replace YYYY-MM-DD with a JST calendar day
- [Reader page (HTML)](${origin}/calendar?date=YYYY-MM-DD): the human-facing page; prefer the markdown form when summarising

## Edition format

- \`## <section name>\` starts a section of the paper, optionally followed by an intro paragraph.
- \`### <article title>\` starts one article.
- One or more plain lines contain the Japanese summary.
- \`Why it matters: ...\` is an optional one-line relevance note.
- \`引用元: [label](https://...)\` or \`引用元: https://...\` gives the source URL; when several appear, the last one is the source.
- Article order within a section is the editorial priority: first is most important.

## Access

- Anonymous reads work only when the site's public reader mode is enabled; otherwise the edition endpoint returns 401 and the reader page redirects to a login page.
- Anonymous traffic is rate-limited: on 429, back off and retry according to the Retry-After header.
- Unknown or unpublished dates return 404; only published editions are served.
- A malformed \`date\` or unknown \`format\` returns 400.
- Content is Japanese-first.
`;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
