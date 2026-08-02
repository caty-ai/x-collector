import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const COLLECTOR_FETCH_TIMEOUT_MS = 30_000;

interface CollectorCounters {
  sources: number;
  errors: number;
  total: number;
}

interface FbRawPost {
  id?: string;
  url?: string;
  text?: string;
  author?: string | { name?: string; id?: string; url?: string; [key: string]: any };
  authorId?: string;
  authorUrl?: string;
  reactionCount?: number;
  commentCount?: number;
  publishTime?: string | number;
  image?: string;
  topComments?: any[];
}

/**
 * Extract slug from a Facebook URL.
 * e.g. "https://www.facebook.com/groups/example-ai-group" -> "example-ai-group"
 * e.g. "https://www.facebook.com/ExamplePage" -> "ExamplePage"
 */
export function extractSlug(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    // /groups/slug or /slug
    return parts[parts.length - 1] || "";
  } catch {
    return url;
  }
}

/**
 * Default max pages for routine collection (1 page = ~3 posts).
 * Deep fetch uses maxPages from FbSource or override.
 */
const DEFAULT_MAX_PAGES = 1;

function upsertPost(post: FbRawPost, sourceId: number) {
  const postId = post.id;
  if (!postId) return null;

  const rawAuthor = post.author as any;
  const authorName: string = typeof rawAuthor === "object" && rawAuthor?.name
    ? String(rawAuthor.name)
    : String(rawAuthor || "Unknown");
  const authorId: string | null = typeof rawAuthor === "object" && rawAuthor?.id
    ? String(rawAuthor.id)
    : (post.authorId || null);
  const authorUrl: string | null = typeof rawAuthor === "object" && rawAuthor?.url
    ? String(rawAuthor.url)
    : (post.authorUrl || null);

  return prisma.fbPost.upsert({
    where: { postId },
    create: {
      postId,
      sourceId,
      author: authorName,
      authorId,
      authorUrl,
      text: post.text || "",
      url: post.url || "",
      reactionCount: post.reactionCount || 0,
      commentCount: post.commentCount || 0,
      image: post.image || null,
      topComments: post.topComments || Prisma.JsonNull,
      publishedAt: post.publishTime
        ? new Date(typeof post.publishTime === "number" ? post.publishTime * 1000 : post.publishTime)
        : null,
    },
    update: {
      author: authorName,
      text: post.text || "",
      url: post.url || "",
      reactionCount: post.reactionCount || 0,
      commentCount: post.commentCount || 0,
      image: post.image || null,
      topComments: post.topComments || Prisma.JsonNull,
      fetchedAt: new Date(),
    },
  });
}

/**
 * Fetch posts for a single source with pagination.
 * Returns { upserted, pages, error? }
 */
export async function fetchSourcePosts(
  source: { id: number; name: string; type: string; url: string; slug: string; maxPages: number },
  maxPagesOverride?: number
): Promise<{ upserted: number; pages: number; error?: string }> {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) return { upserted: 0, pages: 0, error: "SCRAPECREATORS_API_KEY not set" };

  const maxPages = maxPagesOverride ?? source.maxPages ?? DEFAULT_MAX_PAGES;
  let cursor: string | null = null;
  let upserted = 0;
  let pages = 0;

  for (let page = 0; page < maxPages; page++) {
    const candidateUrls: string[] = [];

    if (source.type === "group") {
      candidateUrls.push(
        `https://api.scrapecreators.com/v1/facebook/group/posts?url=${encodeURIComponent(source.url)}`,
      );
    } else {
      // ScrapeCreators profile API currently expects url/pageId rather than handle.
      candidateUrls.push(
        `https://api.scrapecreators.com/v1/facebook/profile/posts?url=${encodeURIComponent(source.url)}`,
      );
      if (source.slug) {
        candidateUrls.push(
          `https://api.scrapecreators.com/v1/facebook/profile/posts?pageId=${encodeURIComponent(source.slug)}`,
        );
      }
    }

    if (cursor) {
      for (let i = 0; i < candidateUrls.length; i += 1) {
        candidateUrls[i] = `${candidateUrls[i]}&cursor=${encodeURIComponent(cursor)}`;
      }
    }

    let data: any = null;
    let lastError: string | null = null;

    for (const apiUrl of candidateUrls) {
      const res = await fetch(apiUrl, {
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(COLLECTOR_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        lastError = `API ${res.status}`;
        continue;
      }

      const body = await res.json();
      if (!body.success && body.success !== undefined) {
        lastError = body.message || "API error";
        continue;
      }

      data = body;
      lastError = null;
      break;
    }

    if (!data) {
      return { upserted, pages, error: lastError || "API error" };
    }

    const posts: FbRawPost[] = data.posts || [];
    pages++;

    for (const post of posts) {
      if (!post.id) continue;
      await upsertPost(post, source.id);
      upserted++;
    }

    cursor = data.cursor || null;
    if (!cursor || posts.length === 0) break; // No more pages
    console.log(`  [FB] Page ${page + 1}: ${posts.length} posts (total ${upserted})`);
  }

  await prisma.fbSource.update({
    where: { id: source.id },
    data: { lastFetchedAt: new Date() },
  });

  return { upserted, pages };
}

export async function collectFacebook(): Promise<CollectorCounters> {
  const sources = await prisma.fbSource.findMany({ where: { active: true } });
  console.log(`[FB] Found ${sources.length} active Facebook sources`);

  if (sources.length === 0) {
    console.log("[FB] No sources to collect");
    return { sources: 0, errors: 0, total: 0 };
  }

  const run = await prisma.run.create({ data: { kind: "fb_collect" } });
  let total = 0;
  let errors = 0;

  for (const source of sources) {
    try {
      console.log(`[FB] Fetching posts for "${source.name}" (${source.type}: ${source.slug}, maxPages: ${source.maxPages})...`);
      const result = await fetchSourcePosts(source);
      total += result.upserted;
      if (result.error) {
        console.error(`  [FB] Error: ${result.error}`);
        errors++;
      } else {
        console.log(`  [FB] Upserted ${result.upserted} posts in ${result.pages} pages for "${source.name}"`);
      }
    } catch (err) {
      console.error(`  [FB] Error for "${source.name}":`, err);
      errors++;
    }
  }

  await prisma.run.update({
    where: { id: run.id },
    data: {
      endedAt: new Date(),
      status: errors ? "partial" : "done",
      meta: { total, errors },
    },
  });

  console.log(`[FB] Run #${run.id} complete: ${total} posts, ${errors} errors`);
  await prisma.$disconnect();
  return { sources: sources.length, errors, total };
}

// CLI entry
if (require.main === module) {
  collectFacebook()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Fatal:", e);
      process.exit(1);
    });
}
