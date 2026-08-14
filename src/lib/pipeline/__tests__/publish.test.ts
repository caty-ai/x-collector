import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeNewsletterEdition } from "../compose-edition";
import { composeNewsletterEditionScript } from "../compose-edition-script";
import { publishPipelineItems } from "../publish";
import {
  classification,
  decision,
  publishItem,
  publishPrismaStub,
  quietLogger,
} from "./helpers/fixtures";

function composeEditionStub() {
  const editionDate = new Date("2026-03-11T00:00:00.000Z");
  const editionUpdates: Array<Record<string, any>> = [];

  const prisma = {
    newsletterEdition: {
      findUnique: async () => ({
        id: "edition-1",
        editionDate,
        slug: "ai-daily-news-20260311",
        title: "2026年03月11日 AI Daily News",
        status: "draft",
      }),
      update: async (args: Record<string, any>) => {
        editionUpdates.push(args);
        return args;
      },
    },
    newsletterBinding: {
      findMany: async () => [{
        id: 1,
        editionId: "edition-1",
        pipelineItemId: "item-1",
        section: "2_update",
        subsection: null,
        position: 1,
        blurb: "Community summary",
        pipelineItem: {
          id: "item-1",
          title: "Community title",
          body: "Community body",
          url: "https://example.test/item-1",
          canonicalUrl: null,
          platform: "twitter",
          sourceRef: "@community",
          publishedAt: editionDate,
        },
        classification: {
          primaryTag: "UPDATE",
          subTag: null,
          actionTag: "INFO",
          score: 0.9,
          isHeadlineCandidate: false,
          titleJa: "コミュニティタイトル",
          summaryJa: "コミュニティ要約",
        },
      }],
      aggregate: async () => ({ _max: { position: 1 } }),
    },
    pipelineCrosslinkLlmDecision: {
      findMany: async () => [],
    },
    voiceSignal: {
      findMany: async () => [],
    },
    source: {
      findMany: async () => [],
    },
    pipelineRun: {
      findFirst: async () => null,
      create: async () => ({ id: 1 }),
      update: async () => undefined,
    },
  };

  return { editionUpdates, prisma: prisma as any };
}

describe("publish invariants", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("rescues late ingests and delayed classifications with bounded queries", async () => {
    const ingestRescue = publishItem("ingest-rescue", {
      publishedAt: new Date("2026-03-09T20:00:00.000Z"),
      ingestedAt: new Date("2026-03-10T00:00:00.000Z"),
    });
    const classifyRescue = publishItem("classify-rescue", {
      publishedAt: new Date("2026-03-08T22:00:00.000Z"),
      ingestedAt: new Date("2026-03-08T22:00:00.000Z"),
      classifications: [
        classification({ id: 2, classifiedAt: new Date("2026-03-10T03:00:00.000Z") }),
      ],
    });
    const boundRescue = publishItem("bound-rescue", {
      publishedAt: new Date("2026-03-09T20:00:00.000Z"),
      ingestedAt: new Date("2026-03-10T00:00:00.000Z"),
    });
    const { prisma, queries } = publishPrismaStub({
      rescueRows: [ingestRescue, classifyRescue, boundRescue],
      boundIds: new Set(["bound-rescue"]),
    });

    const result = await publishPipelineItems(prisma, {
      dryRun: true,
      editionDate: new Date("2026-03-11T00:00:00.000Z"),
      logger: quietLogger,
    });

    expect(result.previews.map((item) => item.pipelineItemId).sort()).toEqual([
      "classify-rescue",
      "ingest-rescue",
    ]);
    expect(queries).toHaveLength(2);
    expect(queries[0].take).toBe(2001);
    expect(queries[0].where.newsletterBindings).toEqual({ none: {} });
    expect(queries[0].orderBy[0]).toEqual({
      publishedAt: { sort: "desc", nulls: "last" },
    });
    expect(queries[1].take).toBe(500);
    expect(queries[1].where.newsletterBindings).toEqual({ none: {} });
    expect(queries[1].where.publishedAt.gte.toISOString()).toBe("2026-03-07T21:00:00.000Z");
    expect(queries[1].where.publishedAt.lt.toISOString()).toBe("2026-03-09T21:00:00.000Z");
    expect(queries[1].where.OR[0].ingestedAt.gte.toISOString()).toBe("2026-03-09T21:00:00.000Z");
    expect(queries[1].where.OR[1].classifications.some.classifiedAt.lt.toISOString()).toBe(
      "2026-03-10T21:00:00.000Z",
    );
  });

  it("keeps both the row guard and isPublished guard active across editions", async () => {
    const item = publishItem("same-item");
    const first = publishPrismaStub({ mainRows: [item] });
    const firstResult = await publishPipelineItems(first.prisma, {
      dryRun: true,
      editionDate: new Date("2026-03-11T00:00:00.000Z"),
      logger: quietLogger,
    });
    expect(firstResult.counter.selected).toBe(1);

    const second = publishPrismaStub({
      mainRows: [item],
      boundIds: new Set(["same-item"]),
    });
    const secondResult = await publishPipelineItems(second.prisma, {
      dryRun: true,
      editionDate: new Date("2026-03-12T00:00:00.000Z"),
      logger: quietLogger,
    });
    expect(secondResult.counter.selected).toBe(0);

    const publishedFlag = publishPrismaStub({
      mainRows: [publishItem("flagged", { classifications: [classification({ isPublished: true })] })],
    });
    const flagResult = await publishPipelineItems(publishedFlag.prisma, {
      dryRun: true,
      editionDate: new Date("2026-03-11T00:00:00.000Z"),
      logger: quietLogger,
    });
    expect(flagResult.counter.selected).toBe(0);
  });

  it("never replans already bound items or rewrites their bindings", async () => {
    const boundItemId = "already-bound-item";
    const { prisma, queries, bindingWrites } = publishPrismaStub({
      mainRows: [publishItem(boundItemId)],
      boundIds: new Set([boundItemId]),
      edition: {
        id: "existing-edition",
        slug: "ai-daily-news-20260311",
        title: "2026年03月11日 AI Daily News",
      },
    });

    const result = await publishPipelineItems(prisma, {
      dryRun: false,
      editionDate: new Date("2026-03-11T00:00:00.000Z"),
      logger: quietLogger,
    });

    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.where.newsletterBindings).toEqual({ none: {} });
    }
    expect(result.previews.some((plan) => plan.pipelineItemId === boundItemId)).toBe(false);
    expect(result.counter.selected).toBe(0);
    expect(bindingWrites).toHaveLength(0);
  });

  it("keeps latest edition filtering and both compose paths publish-atomic", async () => {
    const findFirstCalls: Array<Record<string, any>> = [];
    const prismaForRoute = {
      newsletterEdition: {
        findFirst: vi.fn(async (args: Record<string, any>) => {
          findFirstCalls.push(args);
          return {
            id: "published-edition",
            slug: "ai-daily-news-20260311",
            title: "2026年03月11日 AI Daily News",
            status: "published",
            contentMd: "# Published edition",
            editionDate: new Date("2026-03-11T00:00:00.000Z"),
            createdAt: new Date("2026-03-11T00:00:00.000Z"),
            generatedAt: new Date("2026-03-11T00:30:00.000Z"),
            publishedAt: new Date("2026-03-11T01:00:00.000Z"),
            updatedAt: new Date("2026-03-11T01:00:00.000Z"),
            _count: { bindings: 1, voiceSignals: 0 },
          };
        }),
      },
    };

    vi.doMock("@prisma/client", () => ({
      PrismaClient: vi.fn(() => prismaForRoute),
    }));

    const { GET } = await import("../../../app/api/newsletter-editions/latest/route");
    const latestResponse = await GET({
      headers: new Headers(),
      nextUrl: new URL("https://example.test/api/newsletter-editions/latest"),
    } as any);
    const latestPayload = await latestResponse.json();

    expect(findFirstCalls[0].where).toEqual({
      status: "published",
      contentMd: { not: null },
    });
    expect(latestPayload.edition.status).toBe("published");
    expect(latestPayload.edition.slug).toBe("ai-daily-news-20260311");

    const composeLlm = composeEditionStub();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: "# 2026-03-11\n\n## アップデート情報\n\n- Community title",
          },
        }],
      }),
    })));

    await composeNewsletterEdition(composeLlm.prisma, {
      dryRun: false,
      editionId: "edition-1",
      logger: quietLogger,
      model: "vitest-compose-model",
    });

    expect(composeLlm.editionUpdates).toHaveLength(1);
    expect(composeLlm.editionUpdates[0].data).toMatchObject({
      status: "published",
      model: "vitest-compose-model",
    });
    expect(composeLlm.editionUpdates[0].data.publishedAt).toBeInstanceOf(Date);

    const composeScript = composeEditionStub();
    await composeNewsletterEditionScript(composeScript.prisma, {
      dryRun: false,
      editionId: "edition-1",
      logger: quietLogger,
    });

    expect(composeScript.editionUpdates).toHaveLength(1);
    expect(composeScript.editionUpdates[0].data).toMatchObject({
      status: "published",
      model: "step5_compose:script:v1",
    });
    expect(composeScript.editionUpdates[0].data.publishedAt).toBeInstanceOf(Date);
  });

  it("surfaces clamp state and keeps the main query sliced before union", async () => {
    const mainRows = Array.from({ length: 2001 }, (_, index) =>
      publishItem(`clamp-${index}`, { classifications: [] }),
    );
    const { prisma } = publishPrismaStub({ mainRows });
    const result = await publishPipelineItems(prisma, {
      dryRun: true,
      editionDate: new Date("2026-03-11T00:00:00.000Z"),
      logger: quietLogger,
    });

    expect(result.counter.clamped).toBe(true);
    expect(result.counter.scanned).toBe(2000);
    expect(JSON.parse(JSON.stringify(result)).counter.clamped).toBe(true);

    const prodStep5 = await readFile(
      path.join(process.cwd(), "src/collector/run-prod-step5.ts"),
      "utf8",
    );
    // kept deliberately: this guards a non-exported CLI wiring to sendOpsAlert when publish clamping occurs.
    expect(prodStep5).toMatch(
      /if \(!options\.dryRun && step5\.counter\.clamped\) \{[\s\S]{0,200}sendOpsAlert\(/,
    );
  });

  it("ranks by decision and trust while keeping section placement consistent", async () => {
    const rows = [
      publishItem("headline", {
        classifications: [classification({ id: 10 })],
        crosslinkLlmDecisions: [decision({ id: 10, headlineCandidate: true, priorityScore: 1 })],
      }),
      publishItem("sentinel", {
        classifications: [classification({ id: 11, primaryTag: "OTHER", isHeadlineCandidate: true })],
        crosslinkLlmDecisions: [
          decision({
            id: 11,
            inputHash: "llm_error_fallback::timeout",
            headlineCandidate: true,
            priorityScore: 100,
          }),
        ],
      }),
      publishItem("missing-decision", {
        platform: "github",
        classifications: [
          classification({ id: 12, primaryTag: null, isHeadlineCandidate: true, score: 0.9 }),
        ],
        crosslinkLlmDecisions: [],
      }),
      publishItem("high-trust", {
        sourceRef: "@high",
        crosslinkLlmDecisions: [decision({ id: 13, priorityScore: 80 })],
      }),
      publishItem("low-trust", {
        sourceRef: "@low",
        crosslinkLlmDecisions: [decision({ id: 14, priorityScore: 100 })],
      }),
      publishItem("decision-false", {
        classifications: [classification({ id: 15, isHeadlineCandidate: true, primaryTag: "TECH" })],
        crosslinkLlmDecisions: [decision({ id: 15, headlineCandidate: false, priorityScore: 50 })],
      }),
      publishItem("null-priority", {
        classifications: [classification({ id: 16, score: 1 })],
        crosslinkLlmDecisions: [decision({ id: 16, priorityScore: null })],
      }),
      publishItem("blocked", {
        sourceRef: "@blocked",
        crosslinkLlmDecisions: [decision({ id: 17, headlineCandidate: true, priorityScore: 100 })],
      }),
    ];
    const { prisma } = publishPrismaStub({
      mainRows: rows,
      sources: [
        { handle: "high", trustLabel: "high" },
        { handle: "low", trustLabel: "low" },
        { handle: "blocked", trustLabel: "blocked" },
      ],
    });

    const result = await publishPipelineItems(prisma, {
      dryRun: true,
      editionDate: new Date("2026-03-11T00:00:00.000Z"),
      logger: quietLogger,
    });
    const previewById = new Map(result.previews.map((item) => [item.pipelineItemId, item]));
    const orderedIds = result.previews.map((item) => item.pipelineItemId);

    expect(orderedIds[0]).toBe("headline");
    expect(orderedIds.indexOf("missing-decision")).toBeLessThan(orderedIds.indexOf("high-trust"));
    expect(orderedIds.indexOf("high-trust")).toBeLessThan(orderedIds.indexOf("low-trust"));
    expect(orderedIds.indexOf("decision-false")).toBeLessThan(orderedIds.indexOf("null-priority"));
    expect(previewById.has("blocked")).toBe(false);
    expect(previewById.get("sentinel")?.isHeadlineCandidate).toBe(false);
    expect(previewById.get("sentinel")?.section).toBe("9_other");
    expect(previewById.get("decision-false")?.section).toBe("4_tech");
    expect(previewById.get("missing-decision")?.section).toBe("1_latest_ai_news");
  });

  it("appends republish positions after the existing maximum and logs the effective limit", async () => {
    const logs: string[] = [];
    const { prisma } = publishPrismaStub({
      mainRows: [publishItem("new-after-partial")],
      edition: {
        id: "existing-edition",
        slug: "ai-daily-news-20260311",
        title: "2026年03月11日 AI Daily News",
      },
      maxPosition: 120,
    });

    const result = await publishPipelineItems(prisma, {
      dryRun: true,
      editionDate: new Date("2026-03-11T00:00:00.000Z"),
      limit: 999,
      logger: {
        ...quietLogger,
        log: (message: string) => logs.push(message),
      },
    });

    expect(result.previews[0]?.position).toBe(121);
    expect(result.limit).toBe(120);
    expect(logs[0] || "").toMatch(/ limit=120 /);
  });
});
