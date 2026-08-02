import { Prisma, PrismaClient } from "@prisma/client";
import { selectPendingCandidatesForEvaluation } from "./evaluate-candidates";

const prisma = new PrismaClient();

type DiscoveryLogger = Pick<Console, "log" | "warn" | "error">;

interface DiscoveryOptions {
  dryRun?: boolean;
  logger?: DiscoveryLogger;
}

type CandidateSignals = {
  count: number;
  mentionedBy: Set<string>;
};

type StoredTweet = {
  tweetId: string;
  text: string;
  handle: string;
  entities: unknown;
};

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const MENTION_RE = /@([A-Za-z0-9_]{1,15})\b/g;
const STATUS_LINK_RE = /(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/\d+/gi;
const RESERVED_X_PATH_SEGMENTS = new Set(["i", "intent", "hashtag", "search", "home", "explore", "share"]);
const SCRAPECREATORS_TIMEOUT_MS = 30_000;
const DEFAULT_DISCOVER_EXTRACT_LOOKBACK_DAYS = 7;
const DISCOVER_EXTRACT_BATCH_SIZE = 500;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getDiscoverExtractLookbackDays(): number {
  return parsePositiveInt(
    process.env.DISCOVER_EXTRACT_LOOKBACK_DAYS,
    DEFAULT_DISCOVER_EXTRACT_LOOKBACK_DAYS,
  );
}

function normalizeHandle(raw: unknown) {
  if (typeof raw !== "string") return null;
  const handle = raw.trim().replace(/^@/, "");
  if (!HANDLE_RE.test(handle)) return null;
  const normalized = handle.toLowerCase();
  if (RESERVED_X_PATH_SEGMENTS.has(normalized)) return null;
  return normalized;
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getPath(root: unknown, path: string[]) {
  let current: unknown = root;
  for (const key of path) {
    const obj = getObject(current);
    if (!obj || !(key in obj)) return undefined;
    current = obj[key];
  }
  return current;
}

function addSignal(
  signals: Record<string, CandidateSignals>,
  handle: string | null,
  surfacedBy: string,
) {
  if (!handle) return;
  if (handle === surfacedBy) return;
  if (!signals[handle]) signals[handle] = { count: 0, mentionedBy: new Set() };
  signals[handle].count++;
  signals[handle].mentionedBy.add(surfacedBy);
}

function extractMentionHandles(text: string) {
  return Array.from(text.matchAll(MENTION_RE), (match) => normalizeHandle(match[1])).filter(
    (handle): handle is string => !!handle
  );
}

function extractStatusLinkHandles(text: string) {
  return Array.from(text.matchAll(STATUS_LINK_RE), (match) => normalizeHandle(match[1])).filter(
    (handle): handle is string => !!handle
  );
}

function extractAuthorHandleFromTweetLike(value: unknown) {
  const paths = [
    ["user", "screen_name"],
    ["user", "username"],
    ["user", "legacy", "screen_name"],
    ["author", "screen_name"],
    ["author", "username"],
    ["author", "handle"],
    ["core", "user_results", "result", "legacy", "screen_name"],
    ["core", "user_results", "result", "username"],
    ["user_results", "result", "legacy", "screen_name"],
    ["user_results", "result", "username"],
    ["author_results", "result", "legacy", "screen_name"],
    ["author_results", "result", "username"],
    ["legacy", "user", "screen_name"],
  ];

  for (const path of paths) {
    const handle = normalizeHandle(getPath(value, path));
    if (handle) return handle;
  }
  return null;
}

function extractReferencedOriginHandles(stored: unknown) {
  const handles = new Set<string>();

  for (const path of [
    ["legacy", "in_reply_to_screen_name"],
    ["in_reply_to_screen_name"],
    ["reply_to", "screen_name"],
    ["reply_to", "username"],
  ]) {
    const handle = normalizeHandle(getPath(stored, path));
    if (handle) handles.add(handle);
  }

  for (const path of [
    ["retweeted_status"],
    ["quoted_status"],
    ["retweeted_tweet"],
    ["quoted_tweet"],
    ["replied_to_tweet"],
    ["retweeted_status_result", "result"],
    ["quoted_status_result", "result"],
    ["replied_to_status_result", "result"],
  ]) {
    const handle = extractAuthorHandleFromTweetLike(getPath(stored, path));
    if (handle) handles.add(handle);
  }

  for (const path of [
    ["referenced_tweets"],
    ["referencedTweets"],
    ["includes", "tweets"],
  ]) {
    const entries = getPath(stored, path);
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const handle = extractAuthorHandleFromTweetLike(entry);
      if (handle) handles.add(handle);
    }
  }

  return [...handles];
}

function recordTweetCandidates(tweet: StoredTweet, signals: Record<string, CandidateSignals>) {
  const surfacedBy = normalizeHandle(tweet.handle);
  if (!surfacedBy) return;

  const surfacedHandles = new Set<string>();
  for (const handle of extractMentionHandles(tweet.text)) {
    surfacedHandles.add(handle);
  }

  for (const handle of extractStatusLinkHandles(tweet.text)) {
    surfacedHandles.add(handle);
  }

  for (const handle of extractReferencedOriginHandles(tweet.entities)) {
    surfacedHandles.add(handle);
  }

  for (const handle of surfacedHandles) {
    addSignal(signals, handle, surfacedBy);
  }
}

function sameStringArray(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function collectCandidateSignals(
  db: PrismaClient,
  since: Date,
): Promise<{ mentionMap: Record<string, CandidateSignals>; scannedTweets: number }> {
  const mentionMap: Record<string, CandidateSignals> = {};
  let scannedTweets = 0;
  let cursor: string | undefined;

  for (;;) {
    const tweets = await db.tweet.findMany({
      where: { fetchedAt: { gte: since } },
      select: { tweetId: true, text: true, handle: true, entities: true },
      orderBy: { tweetId: "asc" },
      take: DISCOVER_EXTRACT_BATCH_SIZE,
      ...(cursor ? { cursor: { tweetId: cursor }, skip: 1 } : {}),
    });

    if (tweets.length === 0) {
      break;
    }

    scannedTweets += tweets.length;

    for (const tweet of tweets) {
      recordTweetCandidates(tweet, mentionMap);
    }

    if (tweets.length < DISCOVER_EXTRACT_BATCH_SIZE) {
      break;
    }

    cursor = tweets[tweets.length - 1]?.tweetId;
    if (!cursor) {
      break;
    }
  }

  return { mentionMap, scannedTweets };
}

async function removeKnownSourceSignals(
  db: PrismaClient,
  mentionMap: Record<string, CandidateSignals>,
): Promise<void> {
  const handles = Object.keys(mentionMap);

  for (let index = 0; index < handles.length; index += DISCOVER_EXTRACT_BATCH_SIZE) {
    const batchHandles = handles.slice(index, index + DISCOVER_EXTRACT_BATCH_SIZE);
    if (batchHandles.length === 0) {
      continue;
    }

    const sources = await db.$queryRaw<Array<{ normalizedHandle: string }>>(Prisma.sql`
      SELECT lower(trim(leading '@' from btrim("handle"))) AS "normalizedHandle"
      FROM "Source"
      WHERE lower(trim(leading '@' from btrim("handle"))) IN (${Prisma.join(batchHandles)})
    `);

    for (const source of sources) {
      const handle = normalizeHandle(source.normalizedHandle);
      if (handle) {
        delete mentionMap[handle];
      }
    }
  }
}

/**
 * Phase 1: Extract X-internal handle candidates from existing tweets → CandidateAccount
 */
export async function extractCandidates(options: DiscoveryOptions = {}, db: PrismaClient = prisma) {
  const logger = options.logger || console;
  const dryRun = Boolean(options.dryRun);
  const lookbackDays = getDiscoverExtractLookbackDays();
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  logger.log("\n--- Phase 1: Extracting X-internal candidates ---");
  logger.log(
    `  Using lookback window: fetchedAt >= ${since.toISOString()} (${lookbackDays} day${lookbackDays === 1 ? "" : "s"})`,
  );

  const { mentionMap, scannedTweets } = await collectCandidateSignals(db, since);
  await removeKnownSourceSignals(db, mentionMap);
  logger.log(`  Scanned ${scannedTweets} recent tweet${scannedTweets === 1 ? "" : "s"} in cursor batches`);

  const qualifiedToCreate = new Map(
    Object.entries(mentionMap)
      .filter(([_, v]) => v.count >= 2 || v.mentionedBy.size >= 2)
      .map(([handle, data]) => [
        handle,
        {
          mentionCount: data.count,
          mentionedBy: [...data.mentionedBy].sort(),
        },
      ]),
  );
  const qualifiedCount = qualifiedToCreate.size;

  let created = 0;
  let updated = 0;
  let cursor: number | undefined;
  for (;;) {
    const candidates = await db.candidateAccount.findMany({
      select: { id: true, handle: true, mentionCount: true, mentionedBy: true },
      orderBy: { id: "asc" },
      take: DISCOVER_EXTRACT_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (candidates.length === 0) {
      break;
    }

    for (const candidate of candidates) {
      const windowSignals = mentionMap[candidate.handle];
      const nextMentionCount = windowSignals?.count ?? 0;
      const nextMentionedBy = windowSignals ? [...windowSignals.mentionedBy].sort() : [];

      if (
        candidate.mentionCount !== nextMentionCount ||
        !sameStringArray(candidate.mentionedBy, nextMentionedBy)
      ) {
        if (!dryRun) {
          await db.candidateAccount.update({
            where: { handle: candidate.handle },
            data: {
              mentionCount: nextMentionCount,
              mentionedBy: nextMentionedBy,
            },
          });
        }
        updated++;
      }

      qualifiedToCreate.delete(candidate.handle);
    }

    if (candidates.length < DISCOVER_EXTRACT_BATCH_SIZE) {
      break;
    }

    cursor = candidates[candidates.length - 1]?.id;
    if (!cursor) {
      break;
    }
  }

  for (const [handle, data] of qualifiedToCreate) {
    if (!dryRun) {
      await db.candidateAccount.create({
        data: {
          handle,
          mentionCount: data.mentionCount,
          mentionedBy: data.mentionedBy,
        },
      });
    }
    created++;
  }

  logger.log(
    `  Candidates: ${created} ${dryRun ? "would be created" : "created"}, ${updated} ${
      dryRun ? "would be updated" : "updated"
    } (${qualifiedCount} total qualified)`,
  );
  if (qualifiedCount === 0) {
    logger.warn("  Warning: extraction completed with 0 qualified candidates");
  }
  return qualifiedCount;
}

/**
 * Phase 2: Fetch profile + sample tweets for unfetched candidates
 */
export async function fetchCandidateProfiles(
  limit: number = 20,
  options: DiscoveryOptions = {},
  db: PrismaClient = prisma,
) {
  const logger = options.logger || console;
  const dryRun = Boolean(options.dryRun);
  logger.log(`\n--- Phase 2: Fetching candidate profiles (limit: ${limit}) ---`);

  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) {
    logger.error("  SCRAPECREATORS_API_KEY not set");
    return 0;
  }

  const candidates = await db.candidateAccount.findMany({
    where: { profileFetched: false, status: "pending" },
    orderBy: { mentionCount: "desc" },
    take: limit,
  });

  logger.log(`  ${candidates.length} candidates to fetch`);
  if (dryRun) {
    for (const candidate of candidates) {
      logger.log(`  dry-run: would fetch @${candidate.handle}`);
    }
    return candidates.length;
  }

  let fetched = 0;

  for (const c of candidates) {
    try {
      // Fetch profile
      const profileRes = await fetch(
        `https://api.scrapecreators.com/v1/twitter/profile?handle=${c.handle}`,
        {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(SCRAPECREATORS_TIMEOUT_MS),
        }
      );
      if (!profileRes.ok) {
        logger.warn(`  Profile fetch failed for @${c.handle}: ${profileRes.status}`);
        // Mark as rejected if 404 (account doesn't exist)
        if (profileRes.status === 404) {
          await db.candidateAccount.update({
            where: { handle: c.handle },
            data: { status: "rejected", aiReason: "Account not found (404)" },
          });
        }
        continue;
      }

      const profile = await profileRes.json();
      const legacy = profile.legacy || {};

      // Fetch sample tweets (1 credit)
      let sampleTweets: any[] = [];
      try {
        const tweetsRes = await fetch(
          `https://api.scrapecreators.com/v1/twitter/user-tweets?handle=${c.handle}`,
          {
            headers: { "x-api-key": apiKey },
            signal: AbortSignal.timeout(SCRAPECREATORS_TIMEOUT_MS),
          }
        );
        if (tweetsRes.ok) {
          const tweetsData = await tweetsRes.json();
          const rawTweets = tweetsData.tweets || tweetsData.data || tweetsData || [];
          if (Array.isArray(rawTweets)) {
            sampleTweets = rawTweets.slice(0, 10).map((t: any) => ({
              text: t.note_tweet?.note_tweet_results?.result?.text || t.legacy?.full_text || "",
              createdAt: t.legacy?.created_at,
              likes: t.legacy?.favorite_count || 0,
              retweets: t.legacy?.retweet_count || 0,
              views: t.views?.count ? parseInt(t.views.count, 10) : 0,
            }));
          }
        }
      } catch (e) {
        logger.warn(`  Tweet fetch failed for @${c.handle}, continuing with profile only`);
      }

      await db.candidateAccount.update({
        where: { handle: c.handle },
        data: {
          profileFetched: true,
          displayName: legacy.name || null,
          description: legacy.description || null,
          followersCount: legacy.followers_count ?? null,
          followingCount: legacy.friends_count ?? null,
          tweetCount: legacy.statuses_count ?? null,
          profileImageUrl: legacy.profile_image_url_https || null,
          sampleTweets: sampleTweets.length > 0 ? sampleTweets : undefined,
        },
      });

      logger.log(`  ✓ @${c.handle} (${legacy.followers_count} followers, ${sampleTweets.length} sample tweets)`);
      fetched++;

      // Small delay to be nice to the API
      await new Promise((r) => setTimeout(r, 500));
    } catch (err: any) {
      logger.error(`  Error for @${c.handle}:`, err.message);
    }
  }

  logger.log(`  Fetched ${fetched}/${candidates.length} profiles`);
  return fetched;
}

/**
 * Phase 3: AI evaluation of candidates (stub - to be called externally by agent)
 * Returns candidates ready for AI evaluation
 */
export async function getCandidatesForEvaluation(limit: number = 20) {
  return selectPendingCandidatesForEvaluation(prisma, limit);
}

/**
 * Phase 4: Promote approved candidates to Source (VIP list)
 */
export async function promoteCandidates() {
  console.log("\n--- Phase 4: Promoting approved candidates ---");

  let promoted = 0;
  let cursor: number | undefined;

  for (;;) {
    const approved = await prisma.candidateAccount.findMany({
      where: { status: "approved", promotedAt: null },
      select: { id: true, handle: true },
      orderBy: { id: "asc" },
      take: DISCOVER_EXTRACT_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (approved.length === 0) {
      break;
    }

    for (const c of approved) {
      try {
        const existing = await prisma.source.findUnique({ where: { handle: c.handle } });
        if (existing) {
          console.log(`  @${c.handle} already in Sources, skipping`);
        } else {
          await prisma.source.create({
            data: {
              handle: c.handle,
              type: "discovered",
              tags: ["ai-discovered"],
              active: true,
            },
          });
          console.log(`  ✓ Promoted @${c.handle} to Sources`);
          promoted++;
        }

        await prisma.candidateAccount.update({
          where: { handle: c.handle },
          data: { promotedAt: new Date(), status: "promoted" },
        });
      } catch (err: any) {
        console.error(`  Error promoting @${c.handle}:`, err.message);
      }
    }

    if (approved.length < DISCOVER_EXTRACT_BATCH_SIZE) {
      break;
    }

    cursor = approved[approved.length - 1]?.id;
    if (!cursor) {
      break;
    }
  }

  console.log(`  Promoted ${promoted} candidates to Sources`);
  return promoted;
}

// CLI entry
if (require.main === module) {
  const cmd = process.argv[2] || "extract";
  (async () => {
    switch (cmd) {
      case "extract":
        await extractCandidates();
        break;
      case "fetch":
        await fetchCandidateProfiles(parseInt(process.argv[3] || "20", 10));
        break;
      case "promote":
        await promoteCandidates();
        break;
      case "full":
        await extractCandidates();
        await fetchCandidateProfiles(20);
        await promoteCandidates();
        break;
      default:
        console.log("Usage: discover.ts [extract|fetch|promote|full]");
    }
    await prisma.$disconnect();
  })().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
}
