import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const COLLECTOR_FETCH_TIMEOUT_MS = 30_000;

interface CollectorCounters {
  sources: number;
  errors: number;
  total: number;
}

interface RawTweet {
  legacy?: {
    full_text?: string;
    id_str?: string;
    created_at?: string;
    extended_entities?: { media?: any[] };
    favorite_count?: number;
    retweet_count?: number;
    reply_count?: number;
    quote_count?: number;
    bookmark_count?: number;
  };
  note_tweet?: {
    note_tweet_results?: { result?: { text?: string } };
  };
  views?: { count?: string };
  rest_id?: string;
}

function parseMedia(raw: any[] | undefined) {
  if (!raw?.length) return [];
  return raw.map((m: any) => {
    if (m.type === "photo") {
      return { type: "photo", url: m.media_url_https, width: m.original_info?.width, height: m.original_info?.height };
    }
    if (m.type === "video" || m.type === "animated_gif") {
      const mp4s = (m.video_info?.variants || [])
        .filter((v: any) => v.content_type === "video/mp4")
        .map((v: any) => v.url);
      return { type: m.type, thumbnail: m.media_url_https, duration_ms: m.video_info?.duration_millis, mp4_urls: mp4s };
    }
    return { type: m.type };
  });
}

function parseMetrics(tweet: RawTweet) {
  const l = tweet.legacy;
  return {
    like: l?.favorite_count ?? 0,
    retweet: l?.retweet_count ?? 0,
    reply: l?.reply_count ?? 0,
    quote: l?.quote_count ?? 0,
    view: tweet.views?.count ? parseInt(tweet.views.count, 10) : 0,
    bookmark: l?.bookmark_count ?? 0,
  };
}

export async function collect(): Promise<CollectorCounters> {
  const sources = await prisma.source.findMany({ where: { active: true } });
  console.log(`Found ${sources.length} active sources`);

  const run = await prisma.run.create({ data: { kind: "collect" } });
  let total = 0;
  let errors = 0;

  for (const source of sources) {
    try {
      console.log(`Fetching tweets for @${source.handle}...`);
      const apiKey = process.env.SCRAPECREATORS_API_KEY;
      if (!apiKey) throw new Error("SCRAPECREATORS_API_KEY not set");

      const res = await fetch(
        `https://api.scrapecreators.com/v1/twitter/user-tweets?handle=${source.handle}`,
        {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(COLLECTOR_FETCH_TIMEOUT_MS),
        }
      );
      if (!res.ok) {
        console.error(`  API error ${res.status} for @${source.handle}`);
        errors++;
        continue;
      }

      const data = await res.json();
      const tweets: RawTweet[] = data.tweets || data.data || data || [];
      if (!Array.isArray(tweets)) {
        console.warn(`  Unexpected response shape for @${source.handle}`);
        errors++;
        continue;
      }

      for (const tweet of tweets) {
        const tweetId = tweet.legacy?.id_str || tweet.rest_id;
        if (!tweetId) continue;

        const noteText = tweet.note_tweet?.note_tweet_results?.result?.text;
        const fullText = tweet.legacy?.full_text || "";
        const text = noteText || fullText;
        const isNote = !!noteText;

        await prisma.tweet.upsert({
          where: { tweetId },
          create: {
            tweetId,
            handle: source.handle,
            createdAt: tweet.legacy?.created_at ? new Date(tweet.legacy.created_at) : new Date(),
            text,
            textShort: fullText,
            isNote,
            url: `https://x.com/${source.handle}/status/${tweetId}`,
            media: parseMedia(tweet.legacy?.extended_entities?.media),
            metrics: parseMetrics(tweet),
          },
          update: {
            text,
            textShort: fullText,
            isNote,
            media: parseMedia(tweet.legacy?.extended_entities?.media),
            metrics: parseMetrics(tweet),
            fetchedAt: new Date(),
          },
        });
        total++;
      }
      console.log(`  Upserted ${tweets.length} tweets for @${source.handle}`);
    } catch (err) {
      console.error(`  Error for @${source.handle}:`, err);
      errors++;
    }
  }

  await prisma.run.update({
    where: { id: run.id },
    data: { endedAt: new Date(), status: errors ? "partial" : "done", meta: { total, errors } },
  });
  console.log(`Run #${run.id} complete: ${total} tweets, ${errors} errors`);
  await prisma.$disconnect();
  return { sources: sources.length, errors, total };
}
