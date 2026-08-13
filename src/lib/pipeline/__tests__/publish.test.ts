import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { publishPipelineItems } from "../publish";
import {
  classification,
  decision,
  publishItem,
  publishPrismaStub,
  quietLogger,
} from "./helpers/fixtures";

describe("publish invariants", () => {
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
    const root = process.cwd();
    const [latestRoute, composeLlm, composeScript] = await Promise.all([
      readFile(path.join(root, "src/app/api/newsletter-editions/latest/route.ts"), "utf8"),
      readFile(path.join(root, "src/lib/pipeline/compose-edition.ts"), "utf8"),
      readFile(path.join(root, "src/lib/pipeline/compose-edition-script.ts"), "utf8"),
    ]);

    expect(latestRoute).toMatch(/status:\s*"published"[\s\S]{0,160}contentMd:\s*\{\s*not:\s*null\s*\}/);
    expect(composeLlm).toMatch(
      /data:\s*\{[\s\S]{0,500}status:\s*"published",[\s\S]{0,100}publishedAt:\s*new Date\(\)/,
    );
    expect(composeScript).toMatch(
      /data:\s*\{[\s\S]{0,500}status:\s*"published",[\s\S]{0,100}publishedAt:\s*new Date\(\)/,
    );
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
