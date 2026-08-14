import { afterEach, describe, expect, it, vi } from "vitest";
import { carryForwardClassificationFlags, classifyPipelineItemsByLlm } from "../classify-llm";
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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("carries published and headline flags forward and keeps the pending-only floor load-bearing", async () => {
    expect(
      carryForwardClassificationFlags({
        isDup: true,
        isHeadlineCandidate: true,
        isPublished: true,
      }),
    ).toEqual({ isDup: true, isHeadlineCandidate: true, isPublished: true });

    const queryPrisma = {
      pipelineItem: {
        findMany: vi.fn(async () => []),
      },
    } as any;

    await classifyPipelineItemsByLlm(queryPrisma, {
      apiKey: "stub-or-key",
      logger: quietLogger,
      model: "vitest-classify-model",
      promptVersion: "vitest-prompt-version",
    });

    expect(queryPrisma.pipelineItem.findMany).toHaveBeenCalledTimes(1);
    const queryArgs = queryPrisma.pipelineItem.findMany.mock.calls[0][0];
    expect(queryArgs.where.ingestedAt.gte).toBeInstanceOf(Date);
    expect(queryArgs.where.NOT).toEqual({
      runs: {
        some: {
          step: "step1_3_classify",
          status: "completed",
          output: {
            path: ["result", "promptVersion"],
            equals: "vitest-prompt-version",
          },
        },
      },
    });

    const classificationWrites: Array<Record<string, any>> = [];
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              noise: false,
              noiseReason: null,
              primaryTag: "TECH",
              subTag: null,
              actionTag: "INFO",
              titleJa: "分類タイトル",
              summaryJa: "分類要約",
              confidence: 0.8,
            }),
          },
        }],
      }),
    })));

    const timestamp = new Date("2026-03-10T00:00:00.000Z");
    const persistPrisma = {
      pipelineItem: {
        findMany: async () => [{
          id: "carry-forward-item",
          platform: "twitter",
          title: "Carry forward title",
          body: "Carry forward body",
          url: "https://example.test/carry-forward",
          canonicalUrl: null,
          sourceRef: "@carryforward",
          publishedAt: timestamp,
          updatedAt: timestamp,
          raw: {},
          runs: [],
          classifications: [{
            isDup: true,
            isHeadlineCandidate: true,
            isPublished: true,
          }],
        }],
      },
      pipelineRun: {
        create: async () => ({ id: 7 }),
        update: async () => undefined,
      },
      pipelineClassification: {
        create: async (args: Record<string, any>) => {
          classificationWrites.push(args.data);
          return args.data;
        },
      },
      $transaction: async (operations: unknown[]) => operations,
    } as any;

    await classifyPipelineItemsByLlm(persistPrisma, {
      apiKey: "stub-or-key",
      dryRun: false,
      fallbackToRules: false,
      logger: quietLogger,
      model: "vitest-classify-model",
      promptVersion: "vitest-prompt-version",
    });

    expect(classificationWrites).toHaveLength(1);
    expect(classificationWrites[0]).toMatchObject({
      pipelineItemId: "carry-forward-item",
      isDup: true,
      isHeadlineCandidate: true,
      isPublished: true,
    });
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
