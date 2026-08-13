import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { carryForwardClassificationFlags } from "../classify-llm";
import { clampPublishedAt, normalizePipelineItems } from "../normalize";
import { alertEntry, quietLogger } from "./helpers/fixtures";

async function normalizeAlertPermutation(entries: ReturnType<typeof alertEntry>[]) {
  const creates: Array<Record<string, any>> = [];
  const prisma = {
    alertEntry: {
      findMany: async (args: Record<string, any>) => (args.cursor ? [] : entries),
    },
    pipelineItem: {
      findUnique: async () => null,
      create: async (args: Record<string, any>) => {
        creates.push(args.data);
        return args.data;
      },
    },
  } as any;

  const result = await normalizePipelineItems(prisma, {
    platforms: ["alerts"],
    lookbackDays: 0,
    logger: quietLogger,
  });
  return { creates, result };
}

describe("normalize and classify invariants", () => {
  it("carries published and headline flags forward and keeps the pending-only floor load-bearing", async () => {
    expect(
      carryForwardClassificationFlags({
        isDup: true,
        isHeadlineCandidate: true,
        isPublished: true,
      }),
    ).toEqual({ isDup: true, isHeadlineCandidate: true, isPublished: true });

    const classifySource = await readFile(
      path.join(process.cwd(), "src/lib/pipeline/classify-llm.ts"),
      "utf8",
    );
    expect(classifySource).toMatch(/if \(pendingOnly\) \{[\s\S]{0,160}where\.ingestedAt = \{ gte:/);
    expect(classifySource).toMatch(
      /D1's isPublished bind guard depends on these flags surviving reclassification/,
    );
    expect(classifySource).toMatch(
      /const carriedFlags = carryForwardClassificationFlags\(item\.classifications\[0\]\)/,
    );
    expect(classifySource).toMatch(
      /pipelineClassification\.create\(\{[\s\S]{0,800}\.\.\.carriedFlags/,
    );
  });

  it("clamps future publishedAt values and keeps the clamp idempotent across normalize passes", async () => {
    const now = new Date("2026-03-10T00:00:00.000Z");
    expect(clampPublishedAt(new Date("2026-03-11T00:00:00.000Z"), now)?.toISOString()).toBe(
      now.toISOString(),
    );
    expect(clampPublishedAt(new Date("2026-03-09T00:00:00.000Z"), now)?.toISOString()).toBe(
      "2026-03-09T00:00:00.000Z",
    );
    expect(clampPublishedAt(new Date("2026-03-11T00:00:00.000Z"), null)?.toISOString()).toBe(
      "2026-03-11T00:00:00.000Z",
    );

    const publishedAt = new Date("2026-03-12T00:00:00.000Z");
    const ingestedAt = new Date("2026-03-10T00:00:00.000Z");
    const createdCandidates: Array<Record<string, any>> = [];
    const tweet = {
      tweetId: "future-tweet",
      provider: "proof",
      handle: "future",
      createdAt: publishedAt,
      fetchedAt: ingestedAt,
      text: "Future-dated normalization proof",
      textShort: null,
      isNote: false,
      url: "https://example.test/future-tweet",
      metrics: {},
      entities: {},
      media: {},
      rawEventId: null,
    };
    const prisma = {
      tweet: {
        findMany: async (args: Record<string, any>) => (args.cursor ? [] : [tweet]),
      },
      pipelineItem: {
        findUnique: async () => null,
        create: async (args: Record<string, any>) => {
          createdCandidates.push(args.data);
          return args.data;
        },
      },
    } as any;

    for (let pass = 0; pass < 2; pass += 1) {
      await normalizePipelineItems(prisma, {
        platforms: ["twitter"],
        lookbackDays: 0,
        logger: quietLogger,
      });
    }

    expect(createdCandidates).toHaveLength(2);
    expect(createdCandidates[0].publishedAt.toISOString()).toBe(ingestedAt.toISOString());
    expect(createdCandidates[0].publishedAt.toISOString()).toBe(
      createdCandidates[1].publishedAt.toISOString(),
    );
    expect(createdCandidates[0].raw.normalization.contentHash).toBe(
      createdCandidates[1].raw.normalization.contentHash,
    );
  });

  it("uses article URL identity for alerts and dedupes deterministically across permutations", async () => {
    const articleUrl = "https://alerts.example/article";
    const smaller = alertEntry(10, articleUrl);
    const larger = alertEntry(20, articleUrl);

    for (const permutation of [
      [smaller, larger],
      [larger, smaller],
    ]) {
      const { creates, result } = await normalizeAlertPermutation(permutation);
      expect(result.perPlatform.alerts.scanned).toBe(1);
      expect(creates).toHaveLength(1);
      expect(creates[0].externalId).toBe(articleUrl);
      expect(creates[0].url).toBe(articleUrl);
      expect(creates[0].raw.data.rawLink).toBe("raw-10");
    }

    const updates: Array<Record<string, any>> = [];
    const legacyEntry = alertEntry(9, articleUrl);
    const legacyPrisma = {
      alertEntry: {
        findMany: async (args: Record<string, any>) => (args.cursor ? [] : [legacyEntry]),
      },
      pipelineItem: {
        findUnique: async (args: Record<string, any>) =>
          args.where.platform_externalId
            ? null
            : {
                id: "legacy-alert",
                externalId: "9",
                sourceType: "alert_entry",
                sourceRef: legacyEntry.source.feedUrl,
                title: legacyEntry.title,
                body: legacyEntry.snippet,
                url: articleUrl,
                canonicalUrl: articleUrl,
                publishedAt: legacyEntry.publishedAt,
                language: null,
                raw: {},
              },
        update: async (args: Record<string, any>) => {
          updates.push(args);
          return args.data;
        },
      },
    } as any;

    await normalizePipelineItems(legacyPrisma, {
      platforms: ["alerts"],
      lookbackDays: 0,
      logger: quietLogger,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].where.id).toBe("legacy-alert");
    expect(updates[0].data.externalId).toBe(articleUrl);
  });
});
