import { PrismaClient } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import Parser from "rss-parser";
import { requireStudioSession } from "@/lib/auth/require-session";
import { userAgent } from "@/lib/branding";
import { validateSafeHttpUrl } from "@/lib/net/safe-fetch";

const prisma = new PrismaClient();
const parser = new Parser({
  timeout: 15_000,
  headers: { "User-Agent": userAgent() },
});

function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    if (parsed.hostname.includes("google.com") && parsed.pathname === "/url" && parsed.searchParams.has("url")) {
      raw = parsed.searchParams.get("url")!;
    }
    const url = new URL(raw);
    for (const p of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]) {
      url.searchParams.delete(p);
    }
    let out = url.toString();
    if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
    return out;
  } catch {
    return raw;
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireStudioSession();
  if (denied) return denied;
  const { sourceId } = await req.json().catch(() => ({ sourceId: undefined }));

  const where: any = { active: true };
  if (sourceId) where.id = sourceId;

  const sources = await prisma.alertSource.findMany({ where });
  if (sources.length === 0) {
    return NextResponse.json({ error: "No matching sources" }, { status: 404 });
  }

  const results: any[] = [];

  for (const source of sources) {
    try {
      // Best-effort SSRF pre-check only: rss-parser performs its own fetch, so DNS can change
      // after validation until parseURL is refactored to use pinned requests.
      await validateSafeHttpUrl(source.feedUrl, { timeoutMs: 15_000 });
      const feed = await parser.parseURL(source.feedUrl);
      const items = feed.items.slice(0, source.maxItemsPerFetch);
      let count = 0;

      for (const item of items) {
        const rawLink = item.link || item.guid || "";
        if (!rawLink) continue;

        const articleUrl = normalizeUrl(rawLink);
        const title = (item.title || "").replace(/<[^>]*>/g, "").trim();
        const snippet = (item.contentSnippet || item.content || "")
          .replace(/<[^>]*>/g, "").trim().slice(0, 1000);

        let publishedAt: Date | null = null;
        if (item.pubDate || item.isoDate) {
          const d = new Date(item.isoDate || item.pubDate!);
          if (!isNaN(d.getTime())) publishedAt = d;
        }

        try {
          await prisma.alertEntry.upsert({
            where: { sourceId_articleUrl: { sourceId: source.id, articleUrl } },
            create: {
              sourceId: source.id,
              title,
              snippet: snippet || null,
              articleUrl,
              rawLink: rawLink !== articleUrl ? rawLink : null,
              publishedAt,
              raw: item as any,
            },
            update: { title, snippet: snippet || null, publishedAt, raw: item as any },
          });
          count++;
        } catch {}
      }

      await prisma.alertSource.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date() },
      });

      results.push({
        sourceId: source.id,
        name: source.name,
        feedItems: items.length,
        upserted: count,
        ok: true,
      });
    } catch (err: any) {
      results.push({
        sourceId: source.id,
        name: source.name,
        error: err.message,
        ok: false,
      });
    }
  }

  const totalUpserted = results.reduce((sum, r) => sum + (r.upserted || 0), 0);
  const errors = results.filter((r) => !r.ok).length;

  return NextResponse.json({ ok: true, totalUpserted, errors, results });
}
