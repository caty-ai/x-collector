import { describe, expect, it } from "vitest";
import {
  buildInputHash as buildCrosslinkInputHash,
  crosslinkPipelineItemsByLlm,
  FAILED_FALLBACK_INPUT_HASH_PREFIX,
} from "../crosslink-llm";
import {
  evaluateStep4RepairGate,
  runStep4RepairBeforePublish,
} from "../step5-repair";
import {
  crosslinkItem,
  existingCrosslinkDecision,
  quietLogger,
} from "./helpers/fixtures";

describe("crosslink and repair invariants", () => {
  it("hashes only content fields and re-sends failed sentinel hashes", async () => {
    const content = {
      title: "Stable title",
      shortSummary: "Stable summary",
      tags: { primary: "TECH", sub: null, action: "INFO", score: 0.8 },
      keyLinks: ["https://example.test/hash-item"],
      model: "proof-model",
      promptVersion: "proof-prompt",
    };
    const baseHash = buildCrosslinkInputHash(content);

    for (const metadata of [
      { dateJst: "2026-03-11" },
      { clusterId: "different-cluster" },
      { canonicalItemId: "different-canonical" },
      { seedScore: 0.999 },
      { seedReason: "different-reason" },
      { isPrunedByRule: true },
    ]) {
      expect(
        buildCrosslinkInputHash({ ...content, ...metadata } as typeof content),
        `row metadata must not affect inputHash: ${Object.keys(metadata)[0]}`,
      ).toBe(baseHash);
    }

    for (const changed of [
      { title: "Changed title" },
      { shortSummary: "Changed summary" },
      { tags: { ...content.tags, primary: "BUSINESS" } },
      { keyLinks: ["https://example.test/changed"] },
      { model: "changed-model" },
      { promptVersion: "changed-prompt" },
    ]) {
      expect(buildCrosslinkInputHash({ ...content, ...changed })).not.toBe(baseHash);
    }

    const decisionQueries: Array<Record<string, any>> = [];
    let existingInputHash = baseHash;
    const prisma = {
      pipelineItem: {
        findMany: async () => [crosslinkItem()],
      },
      pipelineCrosslinkLlmDecision: {
        findMany: async (args: Record<string, any>) => {
          decisionQueries.push(args);
          return [existingCrosslinkDecision(existingInputHash)];
        },
      },
    } as any;

    const originalFetch = globalThis.fetch;
    let llmCalls = 0;
    globalThis.fetch = async () => {
      llmCalls += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      id: "hash-item",
                      headlineCandidate: true,
                      headlineScore: 80,
                      dupCluster: null,
                      canonicalId: null,
                      dupScore: null,
                      priorityReason: "proof",
                      priorityScore: 80,
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    try {
      const unchanged = await crosslinkPipelineItemsByLlm(prisma, {
        dryRun: false,
        dateJst: new Date("2026-03-11T00:00:00.000+09:00"),
        model: content.model,
        promptVersion: content.promptVersion,
        maxSummaryChars: 280,
        logger: quietLogger,
      });
      expect(unchanged.counter.skippedUnchanged).toBe(1);
      expect(unchanged.counter.llmCalls).toBe(0);
      expect(unchanged.counter.processed).toBe(0);
      expect(unchanged.counter.persisted).toBe(0);
      expect(llmCalls).toBe(0);
      expect(decisionQueries[0].where.targetDateJst).toBeUndefined();
      expect(decisionQueries[0].where.model).toBeUndefined();
      expect(decisionQueries[0].where.promptVersion).toBeUndefined();
      expect(decisionQueries[0].orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);

      existingInputHash = `${FAILED_FALLBACK_INPUT_HASH_PREFIX}${baseHash}`;
      const sentinel = await crosslinkPipelineItemsByLlm(prisma, {
        dryRun: true,
        dateJst: new Date("2026-03-12T00:00:00.000+09:00"),
        model: content.model,
        promptVersion: content.promptVersion,
        apiKey: "proof-key",
        maxRetries: 1,
        logger: quietLogger,
      });
      expect(sentinel.counter.skippedUnchanged).toBe(0);
      expect(sentinel.counter.llmCalls).toBe(1);
      expect(llmCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("repairs only on sentinels or total decision absence and fails soft without credentials", async () => {
    const clean = { crosslinkLlmDecisions: [{ inputHash: "clean" }] };
    const sentinel = {
      crosslinkLlmDecisions: [{ inputHash: `${FAILED_FALLBACK_INPUT_HASH_PREFIX}timeout` }],
    };
    const missing = { crosslinkLlmDecisions: [] };

    expect(evaluateStep4RepairGate([sentinel, clean]).shouldRepair).toBe(true);
    expect(evaluateStep4RepairGate([missing, missing]).shouldRepair).toBe(true);
    expect(evaluateStep4RepairGate([]).shouldRepair).toBe(false);
    expect(evaluateStep4RepairGate([clean, missing]).shouldRepair).toBe(false);
    expect(evaluateStep4RepairGate([clean, clean]).shouldRepair).toBe(false);

    const queries: Array<Record<string, any>> = [];
    let crosslinkCalls = 0;
    const alerts: string[] = [];
    let continued = false;
    const prisma = {
      pipelineItem: {
        findMany: async (args: Record<string, any>) => {
          queries.push(args);
          return [sentinel];
        },
      },
    } as any;

    const missingKeyResult = await runStep4RepairBeforePublish(prisma, {
      editionDate: new Date("2026-03-11T00:00:00.000Z"),
      apiKey: "",
      crosslink: (async () => {
        crosslinkCalls += 1;
        throw new Error("must not run");
      }) as typeof crosslinkPipelineItemsByLlm,
      alert: (async (message: string) => {
        alerts.push(message);
        return true;
      }) as any,
      logger: quietLogger,
    });
    continued = true;

    expect(missingKeyResult.status).toBe("skipped_missing_api_key");
    expect(crosslinkCalls).toBe(0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/OPENROUTER_API_KEY is missing/);
    expect(continued).toBe(true);
    expect(queries[0].where.OR[0].publishedAt.gte.toISOString()).toBe("2026-03-09T21:00:00.000Z");
    expect(queries[0].where.OR[0].publishedAt.lt.toISOString()).toBe("2026-03-10T21:00:00.000Z");

    let inspection = 0;
    const repairedPrisma = {
      pipelineItem: {
        findMany: async () => (inspection++ === 0 ? [sentinel] : [clean]),
      },
    } as any;
    const crosslinkOptions: Array<Record<string, any>> = [];
    const repaired = await runStep4RepairBeforePublish(repairedPrisma, {
      editionDate: new Date("2026-03-11T00:00:00.000Z"),
      apiKey: "proof-key",
      limit: 600,
      maxBatches: 3,
      crosslink: (async (_prisma: unknown, options: Record<string, any>) => {
        crosslinkOptions.push(options);
        return {} as any;
      }) as typeof crosslinkPipelineItemsByLlm,
      alert: (async () => true) as any,
      logger: quietLogger,
    });

    expect(repaired.status).toBe("repaired");
    expect(crosslinkOptions).toHaveLength(1);
    expect(crosslinkOptions[0].limit).toBe(600);
    expect(crosslinkOptions[0].maxBatches).toBe(3);
    expect(crosslinkOptions[0].pendingOnly).toBe(true);
    expect("dateJst" in crosslinkOptions[0]).toBe(false);
    expect(repaired.after?.shouldRepair).toBe(false);
  });
});
