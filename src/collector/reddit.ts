import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const COLLECTOR_FETCH_TIMEOUT_MS = 30_000;

interface CollectorCounters {
  sources: number;
  errors: number;
  total: number;
}

interface RedditRawPost {
  id?: string;
  title?: string;
  selftext?: string | null;
  url?: string;
  author?: string;
  score?: number;
  upvote_ratio?: number | null;
  num_comments?: number;
  created_utc?: number;
}

interface ScrapeCreatorsRedditResponse {
  posts?: RedditRawPost[];
  after?: string | null;
}

/**
 * Extract subreddit name from a Reddit URL.
 * e.g. "https://www.reddit.com/r/LocalLLaMA" -> "LocalLLaMA"
 * e.g. "/r/LocalLLaMA" -> "LocalLLaMA"
 */
export function extractSubreddit(url: string): string {
  try {
    const match = url.match(/(?:reddit\.com\/)?r\/([a-zA-Z0-9_]+)/);
    return match ? match[1] : url;
  } catch {
    return url;
  }
}

const DEFAULT_MAX_POSTS = 25;

async function upsertPost(post: RedditRawPost, sourceId: number) {
  const postId = post.id;
  if (!postId) return null;

  return prisma.redditPost.upsert({
    where: { id: postId },
    create: {
      id: postId,
      sourceId,
      title: post.title || "",
      text: post.selftext || null,
      url: post.url || "",
      author: post.author || null,
      score: post.score || 0,
      upvoteRatio: post.upvote_ratio || null,
      commentCount: post.num_comments || 0,
      publishedAt: post.created_utc
        ? new Date(post.created_utc * 1000)
        : null,
    },
    update: {
      score: post.score || 0,
      upvoteRatio: post.upvote_ratio || null,
      commentCount: post.num_comments || 0,
      fetchedAt: new Date(),
    },
  });
}

/**
 * Fetch posts for a single source.
 * Returns { upserted, error? }
 */
export async function fetchSourcePosts(
  source: { id: number; name: string; subreddit: string; maxPosts: number },
  maxPostsOverride?: number
): Promise<{ upserted: number; error?: string }> {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) return { upserted: 0, error: "SCRAPECREATORS_API_KEY not set" };

  const maxPosts = maxPostsOverride ?? source.maxPosts ?? DEFAULT_MAX_POSTS;

  try {
    const apiUrl = new URL("https://api.scrapecreators.com/v1/reddit/subreddit");
    apiUrl.searchParams.set("subreddit", source.subreddit);
    apiUrl.searchParams.set("sort", "hot");

    const res = await fetch(apiUrl.toString(), {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(COLLECTOR_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { upserted: 0, error: `API ${res.status}` };
    }

    const data = await res.json() as ScrapeCreatorsRedditResponse;
    if (!Array.isArray(data.posts)) {
      return { upserted: 0, error: "API response missing posts array" };
    }

    let upserted = 0;

    for (const post of data.posts.slice(0, maxPosts)) {
      if (!post.id) continue;

      try {
        await upsertPost(post, source.id);
        upserted++;
      } catch (err) {
        console.error(`  [Reddit] Error upserting post ${post.id}:`, err);
      }
    }

    // Update lastFetchedAt
    await prisma.redditSource.update({
      where: { id: source.id },
      data: { lastFetchedAt: new Date() },
    });

    return { upserted };
  } catch (err: any) {
    return { upserted: 0, error: err.message || "Unknown error" };
  }
}

export async function collectReddit(): Promise<CollectorCounters> {
  const sources = await prisma.redditSource.findMany({ where: { active: true } });
  console.log(`[Reddit] Found ${sources.length} active Reddit sources`);

  if (sources.length === 0) {
    console.log("[Reddit] No sources to collect");
    return { sources: 0, errors: 0, total: 0 };
  }

  const run = await prisma.run.create({ data: { kind: "reddit_collect" } });
  let total = 0;
  let errors = 0;
  let successes = 0;
  const sourceErrors: { subreddit: string; error: string }[] = [];

  for (const source of sources) {
    try {
      console.log(`[Reddit] Fetching posts for "${source.name}" (r/${source.subreddit}, maxPosts: ${source.maxPosts})...`);
      const result = await fetchSourcePosts(source);
      total += result.upserted;
      if (result.error) {
        console.error(`  [Reddit] Error: ${result.error}`);
        errors++;
        sourceErrors.push({ subreddit: source.subreddit, error: result.error });
      } else {
        successes++;
        console.log(`  [Reddit] Upserted ${result.upserted} posts for "${source.name}"`);
      }
    } catch (err: any) {
      const message = err.message || "Unknown error";
      console.error(`  [Reddit] Error for "${source.name}":`, message);
      errors++;
      sourceErrors.push({ subreddit: source.subreddit, error: message });
    }
  }

  const status = errors
    ? successes > 0
      ? "partial"
      : "failed"
    : "done";

  await prisma.run.update({
    where: { id: run.id },
    data: {
      endedAt: new Date(),
      status,
      meta: { total, errors, sourceErrors },
    },
  });

  console.log(`[Reddit] Run #${run.id} complete: ${total} posts, ${errors} errors`);
  await prisma.$disconnect();
  return { sources: sources.length, errors, total };
}

// CLI entry
if (require.main === module) {
  collectReddit()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Fatal:", e);
      process.exit(1);
    });
}
