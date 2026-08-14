import { describe, expect, it } from "vitest";
import { publishPipelineItems } from "../publish";
import { aggregateVoiceSignals } from "../voicesignal";
import { classification, publishItem, quietLogger } from "./helpers/fixtures";

describe("voice signal invariants", () => {
  it("resolves voice items against each item's edition key instead of the caller date", async () => {
    const itemTimestamp = new Date("2026-03-10T00:00:00.000Z");
    const editionQueries: Date[][] = [];
    const prisma = {
      newsletterEdition: {
        findUnique: async () => ({ id: "caller-edition" }),
        findMany: async (args: Record<string, any>) => {
          editionQueries.push(args.where.editionDate.in);
          return [{ id: "item-edition", editionDate: new Date("2026-03-11T00:00:00.000Z") }];
        },
      },
      pipelineItem: {
        findMany: async () => [
          {
            id: "voice-item",
            platform: "twitter",
            sourceRef: "@voice",
            title: "This is a sufficiently long voice signal candidate title",
            body: null,
            url: "https://example.test/voice",
            canonicalUrl: null,
            publishedAt: itemTimestamp,
            ingestedAt: itemTimestamp,
            raw: null,
            createdAt: itemTimestamp,
            updatedAt: itemTimestamp,
            classifications: [classification({ id: 30 })],
            runs: [],
          },
        ],
      },
      voiceSignal: {
        findMany: async () => [],
      },
    } as any;

    const result = await aggregateVoiceSignals(prisma, {
      dryRun: true,
      editionDate: new Date("2026-03-10T00:00:00.000Z"),
      logger: quietLogger,
    });

    expect(result.counter.selected).toBe(1);
    expect(result.previews[0]?.editionId).toBe("item-edition");
    expect(editionQueries[0].map((date) => date.toISOString())).toEqual([
      "2026-03-11T00:00:00.000Z",
    ]);

    const missingEditionPrisma = {
      ...prisma,
      newsletterEdition: {
        ...prisma.newsletterEdition,
        findMany: async () => [],
      },
    } as any;
    const missingEditionResult = await aggregateVoiceSignals(missingEditionPrisma, {
      dryRun: true,
      editionDate: new Date("2026-03-10T00:00:00.000Z"),
      logger: quietLogger,
    });
    expect(missingEditionResult.previews[0]?.editionId).toBeNull();

    const orphanBackfillCalls: Array<Record<string, any>> = [];
    let publishQueryIndex = 0;
    const publishPrisma = {
      pipelineItem: {
        findMany: async () => (
          publishQueryIndex++ === 0
            ? [publishItem("orphan-backfill-item")]
            : []
        ),
      },
      source: {
        findMany: async () => [],
      },
      newsletterEdition: {
        findUnique: async () => ({
          id: "publish-edition",
          slug: "ai-daily-news-20260311",
          title: "2026年03月11日 AI Daily News",
        }),
      },
      newsletterBinding: {
        findMany: async () => [],
        aggregate: async () => ({ _max: { position: null } }),
      },
      voiceSignal: {
        updateMany: async (args: Record<string, any>) => {
          orphanBackfillCalls.push(args);
          return { count: 2 };
        },
      },
      pipelineRun: {
        create: async () => ({ id: 1 }),
        update: async () => undefined,
      },
      $transaction: async (callback: (tx: Record<string, any>) => Promise<unknown>) =>
        callback({
          newsletterBinding: {
            upsert: async () => undefined,
          },
          pipelineClassification: {
            update: async () => undefined,
          },
          pipelineRun: {
            update: async () => undefined,
          },
        }),
    } as any;

    const publishResult = await publishPipelineItems(publishPrisma, {
      dryRun: false,
      editionDate: new Date("2026-03-11T00:00:00.000Z"),
      logger: quietLogger,
    });

    expect(publishResult.counter.orphansBackfilled).toBe(2);
    expect(orphanBackfillCalls).toHaveLength(1);
    expect(orphanBackfillCalls[0].where).toEqual({
      editionId: null,
      pipelineItem: {
        is: {
          OR: [
            {
              publishedAt: {
                gte: new Date("2026-03-09T21:00:00.000Z"),
                lt: new Date("2026-03-10T21:00:00.000Z"),
              },
            },
            {
              publishedAt: null,
              ingestedAt: {
                gte: new Date("2026-03-09T21:00:00.000Z"),
                lt: new Date("2026-03-10T21:00:00.000Z"),
              },
            },
          ],
        },
      },
    });
    expect(orphanBackfillCalls[0].where).not.toHaveProperty("signaledAt");
  });

  it("keeps published editions frozen for late voice signals", async () => {
    const itemTimestamp = new Date("2026-03-10T00:00:00.000Z");
    const voiceSignalUpdates: Array<Record<string, any>> = [];
    const voiceSignalCreates: Array<Record<string, any>> = [];
    const logs: string[] = [];
    let existingSignalQueries = 0;
    const prisma = {
      newsletterEdition: {
        findUnique: async () => ({ id: "caller-edition" }),
        findMany: async () => [
          {
            id: "published-edition",
            editionDate: new Date("2026-03-11T00:00:00.000Z"),
            status: "published",
          },
        ],
      },
      pipelineItem: {
        findMany: async () => [
          {
            id: "late-voice-item",
            platform: "twitter",
            sourceRef: "@late-voice",
            title: "This late voice signal must not mutate a published edition",
            body: null,
            url: "https://example.test/late-voice",
            canonicalUrl: null,
            publishedAt: itemTimestamp,
            ingestedAt: itemTimestamp,
            raw: null,
            createdAt: itemTimestamp,
            updatedAt: itemTimestamp,
            classifications: [classification({ id: 31 })],
            runs: [],
          },
        ],
      },
      voiceSignal: {
        findMany: async () => {
          existingSignalQueries += 1;
          return [
            {
              id: 118,
              pipelineItemId: "late-voice-item",
              editionId: "published-edition",
              edition: { status: "published" },
              topic: "Existing published topic",
              sentiment: "neutral",
              usageContext: "general",
              summary: "Existing published summary",
              model: "rule-based:v1",
              confidence: 0.5,
              sampleSize: 1,
              createdAt: itemTimestamp,
            },
          ];
        },
      },
      pipelineRun: {
        create: async () => ({ id: 1 }),
        update: async () => undefined,
      },
      $transaction: async (callback: (tx: Record<string, any>) => Promise<unknown>) =>
        callback({
          voiceSignal: {
            update: async (args: Record<string, any>) => {
              voiceSignalUpdates.push(args);
              return args;
            },
            create: async (args: Record<string, any>) => {
              voiceSignalCreates.push(args);
              return { id: 119, ...args.data };
            },
          },
        }),
    } as any;

    const result = await aggregateVoiceSignals(prisma, {
      dryRun: false,
      editionDate: new Date("2026-03-10T00:00:00.000Z"),
      logger: {
        ...quietLogger,
        log: (message: string) => logs.push(message),
      },
    });

    expect(result.counter.selected).toBe(1);
    expect(result.counter.skippedPublishedEdition).toBe(1);
    expect(result.counter.processed).toBe(0);
    expect(result.previews).toEqual([]);
    expect(existingSignalQueries).toBe(0);
    expect(voiceSignalUpdates).toEqual([]);
    expect(voiceSignalCreates).toEqual([]);
    expect(logs.at(-1) || "").toMatch(/skippedPublishedEdition=1/);
  });

  it("scans voice candidates from the 48-hour floor before the edition window", async () => {
    let candidateWhere: Record<string, any> | undefined;
    const prisma = {
      newsletterEdition: {
        findUnique: async () => ({ id: "caller-edition" }),
      },
      pipelineItem: {
        findMany: async (args: Record<string, any>) => {
          candidateWhere = args.where;
          return [];
        },
      },
      voiceSignal: {
        findMany: async () => [],
      },
    } as any;

    await aggregateVoiceSignals(prisma, {
      dryRun: true,
      editionDate: new Date("2026-03-11T00:00:00.000Z"),
      logger: quietLogger,
    });

    const floor = new Date("2026-03-07T21:00:00.000Z");
    expect(candidateWhere?.OR).toEqual([
      { publishedAt: { gte: floor } },
      { publishedAt: null, ingestedAt: { gte: floor } },
    ]);
  });
});
