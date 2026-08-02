import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const COLLECTOR_FETCH_TIMEOUT_MS = 30_000;

interface CollectorCounters {
  sources: number;
  errors: number;
  total: number;
}

interface IgEdgeNode {
  __typename?: string;
  id?: string;
  shortcode?: string;
  display_url?: string;
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] };
  edge_liked_by?: { count?: number };
  edge_media_to_comment?: { count?: number };
  taken_at_timestamp?: number;
  is_video?: boolean;
}

export async function collectInstagram(): Promise<CollectorCounters> {
  const sources = await prisma.igSource.findMany({ where: { active: true } });
  console.log(`\n--- Instagram: ${sources.length} active sources ---`);

  if (!sources.length) {
    console.log("  No active Instagram sources, skipping.");
    await prisma.$disconnect();
    return { sources: 0, errors: 0, total: 0 };
  }

  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) {
    console.error("  SCRAPECREATORS_API_KEY not set, skipping Instagram.");
    await prisma.$disconnect();
    return { sources: sources.length, errors: sources.length, total: 0 };
  }

  const run = await prisma.run.create({ data: { kind: "instagram" } });
  let total = 0;
  let errors = 0;

  for (const source of sources) {
    try {
      console.log(`  Fetching Instagram @${source.handle}...`);
      const res = await fetch(
        `https://api.scrapecreators.com/v1/instagram/profile?handle=${source.handle}`,
        {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(COLLECTOR_FETCH_TIMEOUT_MS),
        }
      );

      if (!res.ok) {
        console.error(`    API error ${res.status} for @${source.handle}`);
        errors++;
        continue;
      }

      const data = await res.json();
      if (!data.success && !data.data) {
        console.warn(`    No data for @${source.handle}`);
        errors++;
        continue;
      }

      const user = data.data?.user || data;
      const timelineEdges: IgEdgeNode[] =
        user.edge_owner_to_timeline_media?.edges?.map((e: any) => e.node) || [];

      if (!timelineEdges.length) {
        console.log(`    No posts found for @${source.handle}`);
        continue;
      }

      let count = 0;
      for (const node of timelineEdges) {
        const shortcode = node.shortcode;
        if (!shortcode) continue;

        const caption =
          node.edge_media_to_caption?.edges?.[0]?.node?.text || null;
        const mediaType = node.__typename || (node.is_video ? "GraphVideo" : "GraphImage");

        await prisma.igPost.upsert({
          where: { id: shortcode },
          create: {
            id: shortcode,
            sourceId: source.id,
            caption,
            url: `https://www.instagram.com/p/${shortcode}/`,
            imageUrl: node.display_url || null,
            mediaType,
            likeCount: node.edge_liked_by?.count || 0,
            commentCount: node.edge_media_to_comment?.count || 0,
            publishedAt: node.taken_at_timestamp
              ? new Date(node.taken_at_timestamp * 1000)
              : null,
          },
          update: {
            caption,
            imageUrl: node.display_url || null,
            likeCount: node.edge_liked_by?.count || 0,
            commentCount: node.edge_media_to_comment?.count || 0,
            fetchedAt: new Date(),
          },
        });
        count++;
      }

      await prisma.igSource.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date() },
      });

      console.log(`    Upserted ${count} posts for @${source.handle}`);
      total += count;
    } catch (err: any) {
      console.error(`    Error for @${source.handle}:`, err.message);
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

  console.log(`  Instagram run #${run.id} complete: ${total} posts, ${errors} errors`);
  await prisma.$disconnect();
  return { sources: sources.length, errors, total };
}

// CLI entry
if (require.main === module) {
  collectInstagram()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Fatal:", e);
      process.exit(1);
    });
}
// trigger deploy Wed Mar  4 23:48:10 +07 2026
