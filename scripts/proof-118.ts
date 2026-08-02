/**
 * Issue #118 durable proof (PR-A + PR-B + PR-C).
 * Run: npx tsx scripts/proof-118.ts
 * Offline fallback with the repo's installed dependencies: npx ts-node scripts/proof-118.ts
 *
 * Uses in-memory Prisma stubs; exits non-zero on the first failed invariant.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { carryForwardClassificationFlags } from "../src/lib/pipeline/classify-llm";
import {
  buildInputHash as buildCrosslinkInputHash,
  crosslinkPipelineItemsByLlm,
  FAILED_FALLBACK_INPUT_HASH_PREFIX,
} from "../src/lib/pipeline/crosslink-llm";
import { buildEditionWindow, editionKey } from "../src/lib/pipeline/edition";
import { clampPublishedAt, normalizePipelineItems } from "../src/lib/pipeline/normalize";
import { publishPipelineItems } from "../src/lib/pipeline/publish";
import {
  evaluateStep4RepairGate,
  runStep4RepairBeforePublish,
} from "../src/lib/pipeline/step5-repair";
import { aggregateVoiceSignals } from "../src/lib/pipeline/voicesignal";

const quietLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function classification(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-03-10T12:00:00.000Z");
  return {
    id: 1,
    noise: false,
    primaryTag: "TECH",
    subTag: null,
    actionTag: "INFO",
    isHeadlineCandidate: false,
    isDup: false,
    isPublished: false,
    score: 0.5,
    updatedAt: now,
    classifiedAt: now,
    ...overrides,
  };
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    inputHash: "clean-input-hash",
    headlineCandidate: false,
    priorityScore: 50,
    createdAt: new Date("2026-03-10T12:00:00.000Z"),
    ...overrides,
  };
}

function publishItem(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const publishedAt = new Date("2026-03-10T00:00:00.000Z");
  return {
    id,
    platform: "twitter",
    sourceRef: `@${id}`,
    title: `Title ${id}`,
    body: `Body ${id}`,
    url: `https://example.test/${id}`,
    canonicalUrl: null,
    publishedAt,
    ingestedAt: publishedAt,
    createdAt: publishedAt,
    updatedAt: publishedAt,
    classifications: [classification()],
    crosslinkLlmDecisions: [],
    runs: [],
    ...overrides,
  };
}

interface PublishStubOptions {
  mainRows?: Array<Record<string, unknown>>;
  rescueRows?: Array<Record<string, unknown>>;
  boundIds?: Set<string>;
  sources?: Array<{ handle: string; trustLabel: string }>;
  edition?: { id: string; slug: string; title: string };
  maxPosition?: number | null;
}

function publishPrismaStub(options: PublishStubOptions = {}) {
  const queries: Array<Record<string, any>> = [];
  const bindingWrites: Array<Record<string, any>> = [];
  let itemQueryIndex = 0;
  const boundIds = options.boundIds || new Set<string>();

  const prisma = {
    pipelineItem: {
      findMany: async (args: Record<string, any>) => {
        queries.push(args);
        const rows = itemQueryIndex++ === 0 ? options.mainRows || [] : options.rescueRows || [];
        const hasRowBasedGuard = args.where?.newsletterBindings?.none !== undefined;
        return rows.filter((row) => !hasRowBasedGuard || !boundIds.has(String(row.id)));
      },
    },
    source: {
      findMany: async () => options.sources || [],
    },
    newsletterEdition: {
      findUnique: async () => options.edition || null,
    },
    newsletterBinding: {
      findMany: async () => [],
      aggregate: async () => ({ _max: { position: options.maxPosition ?? null } }),
    },
    voiceSignal: {
      updateMany: async () => ({ count: 0 }),
    },
    pipelineRun: {
      create: async () => ({ id: 1 }),
      update: async () => undefined,
    },
    $transaction: async (callback: (tx: Record<string, any>) => Promise<unknown>) =>
      callback({
        newsletterBinding: {
          upsert: async (args: Record<string, any>) => {
            bindingWrites.push(args);
            return args;
          },
        },
        pipelineClassification: {
          update: async () => undefined,
        },
        pipelineRun: {
          update: async () => undefined,
        },
      }),
  };

  return { prisma: prisma as any, queries, bindingWrites };
}

async function proofWindowIdentity() {
  const editionDate = new Date("2026-03-11T00:00:00.000Z");
  const window = buildEditionWindow(editionDate);
  assert.equal(window.startUtc.toISOString(), "2026-03-09T21:00:00.000Z");
  assert.equal(window.endUtcExclusive.toISOString(), "2026-03-10T21:00:00.000Z");

  const probes = [
    ["2026-03-09T20:59:59.999Z", "2026-03-10"],
    ["2026-03-09T21:00:00.000Z", "2026-03-11"],
    ["2026-03-10T20:59:59.999Z", "2026-03-11"],
    ["2026-03-10T21:00:00.000Z", "2026-03-12"],
    ["2026-04-30T20:59:59.999Z", "2026-05-01"],
    ["2026-04-30T21:00:00.000Z", "2026-05-02"],
  ] as const;

  for (const [iso, expected] of probes) {
    assert.equal(editionKey(new Date(iso)), expected, iso);
  }

  for (let offset = -72; offset <= 72; offset += 3) {
    const timestamp = new Date(window.startUtc.getTime() + offset * 60 * 60 * 1000);
    const within = timestamp >= window.startUtc && timestamp < window.endUtcExclusive;
    assert.equal(editionKey(timestamp) === "2026-03-11", within, timestamp.toISOString());
  }
}

async function proofRescueAndQueryBounds() {
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

  assert.deepEqual(
    result.previews.map((item) => item.pipelineItemId).sort(),
    ["classify-rescue", "ingest-rescue"],
  );
  assert.equal(queries.length, 2);
  assert.equal(queries[0].take, 2001);
  assert.deepEqual(queries[0].where.newsletterBindings, { none: {} });
  assert.deepEqual(queries[0].orderBy[0], {
    publishedAt: { sort: "desc", nulls: "last" },
  });
  assert.equal(queries[1].take, 500);
  assert.deepEqual(queries[1].where.newsletterBindings, { none: {} });
  assert.equal(queries[1].where.publishedAt.gte.toISOString(), "2026-03-07T21:00:00.000Z");
  assert.equal(queries[1].where.publishedAt.lt.toISOString(), "2026-03-09T21:00:00.000Z");
  assert.equal(queries[1].where.OR[0].ingestedAt.gte.toISOString(), "2026-03-09T21:00:00.000Z");
  assert.equal(
    queries[1].where.OR[1].classifications.some.classifiedAt.lt.toISOString(),
    "2026-03-10T21:00:00.000Z",
  );
}

async function proofDoubleBindGuards() {
  const item = publishItem("same-item");
  const first = publishPrismaStub({ mainRows: [item] });
  const firstResult = await publishPipelineItems(first.prisma, {
    dryRun: true,
    editionDate: new Date("2026-03-11T00:00:00.000Z"),
    logger: quietLogger,
  });
  assert.equal(firstResult.counter.selected, 1);

  const second = publishPrismaStub({
    mainRows: [item],
    boundIds: new Set(["same-item"]),
  });
  const secondResult = await publishPipelineItems(second.prisma, {
    dryRun: true,
    editionDate: new Date("2026-03-12T00:00:00.000Z"),
    logger: quietLogger,
  });
  assert.equal(secondResult.counter.selected, 0, "row-based net must reject a second edition");

  const publishedFlag = publishPrismaStub({
    mainRows: [publishItem("flagged", { classifications: [classification({ isPublished: true })] })],
  });
  const flagResult = await publishPipelineItems(publishedFlag.prisma, {
    dryRun: true,
    editionDate: new Date("2026-03-11T00:00:00.000Z"),
    logger: quietLogger,
  });
  assert.equal(flagResult.counter.selected, 0, "isPublished selection net must remain active");
}

async function proofBoundItemsCannotBeReplanned() {
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

  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.deepEqual(query.where.newsletterBindings, { none: {} });
  }
  assert.equal(
    result.previews.some((plan) => plan.pipelineItemId === boundItemId),
    false,
    "a bound item must be absent from publish plans",
  );
  assert.equal(result.counter.selected, 0);
  assert.equal(bindingWrites.length, 0, "a bound item's binding must never be written again");
}

async function proofPrAStatusAndLatest() {
  const root = process.cwd();
  const [latestRoute, composeLlm, composeScript] = await Promise.all([
    readFile(path.join(root, "src/app/api/newsletter-editions/latest/route.ts"), "utf8"),
    readFile(path.join(root, "src/lib/pipeline/compose-edition.ts"), "utf8"),
    readFile(path.join(root, "src/lib/pipeline/compose-edition-script.ts"), "utf8"),
  ]);

  assert.match(
    latestRoute,
    /status:\s*"published"[\s\S]{0,160}contentMd:\s*\{\s*not:\s*null\s*\}/,
    "/latest primary lookup must reject drafts and empty contentMd",
  );
  for (const [name, source] of [
    ["LLM compose", composeLlm],
    ["script compose", composeScript],
  ] as const) {
    assert.match(
      source,
      /data:\s*\{[\s\S]{0,500}status:\s*"published",[\s\S]{0,100}publishedAt:\s*new Date\(\)/,
      `${name} must atomically flip the edition after contentMd is written`,
    );
  }
}

async function proofClamp() {
  const mainRows = Array.from({ length: 2001 }, (_, index) =>
    publishItem(`clamp-${index}`, { classifications: [] }),
  );
  const { prisma } = publishPrismaStub({ mainRows });
  const result = await publishPipelineItems(prisma, {
    dryRun: true,
    editionDate: new Date("2026-03-11T00:00:00.000Z"),
    logger: quietLogger,
  });
  assert.equal(result.counter.clamped, true);
  assert.equal(result.counter.scanned, 2000, "limit-plus-one probe must be sliced before union");
  assert.equal(JSON.parse(JSON.stringify(result)).counter.clamped, true);

  const prodStep5 = await readFile(
    path.join(process.cwd(), "src/collector/run-prod-step5.ts"),
    "utf8",
  );
  assert.match(
    prodStep5,
    /if \(!options\.dryRun && step5\.counter\.clamped\) \{[\s\S]{0,200}sendOpsAlert\(/,
    "production Step5 must alert when the bounded main query clamps",
  );
}

async function proofRankingAndPlacement() {
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
      classifications: [classification({ id: 12, primaryTag: null, isHeadlineCandidate: true, score: 0.9 })],
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

  assert.equal(orderedIds[0], "headline");
  assert.ok(
    orderedIds.indexOf("missing-decision") < orderedIds.indexOf("high-trust"),
    "missing decisions must rank by classifier score (90 > trust-weighted 86.4)",
  );
  assert.ok(orderedIds.indexOf("high-trust") < orderedIds.indexOf("low-trust"));
  assert.ok(orderedIds.indexOf("decision-false") < orderedIds.indexOf("null-priority"));
  assert.equal(previewById.has("blocked"), false);
  assert.equal(previewById.get("sentinel")?.isHeadlineCandidate, false);
  assert.equal(previewById.get("sentinel")?.section, "9_other");
  assert.equal(previewById.get("decision-false")?.section, "4_tech");
  assert.equal(previewById.get("missing-decision")?.section, "1_latest_ai_news");
}

async function proofVoiceClosedForm() {
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

  assert.equal(result.counter.selected, 1, "caller date must not gate item attachment");
  assert.equal(result.previews[0]?.editionId, "item-edition");
  assert.deepEqual(
    editionQueries[0].map((date) => date.toISOString()),
    ["2026-03-11T00:00:00.000Z"],
  );

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
  assert.equal(missingEditionResult.previews[0]?.editionId, null);

  const publishSource = await readFile(
    path.join(process.cwd(), "src/lib/pipeline/publish.ts"),
    "utf8",
  );
  const orphanBlock = publishSource.match(
    /const orphanBackfill = await prisma\.voiceSignal\.updateMany\(\{([\s\S]*?)\n\s*\}\);/,
  )?.[1];
  assert.ok(orphanBlock, "orphan backfill block must exist");
  assert.match(orphanBlock, /pipelineItem:\s*\{[\s\S]*?is:\s*buildWindowWhere\(window\)/);
  assert.doesNotMatch(orphanBlock, /signaledAt/);
}

async function proofPublishedVoiceEditionIsFrozen() {
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

  assert.equal(result.counter.selected, 1, "the late item must reach edition resolution");
  assert.equal(result.counter.skippedPublishedEdition, 1);
  assert.equal(result.counter.processed, 0);
  assert.deepEqual(result.previews, [], "published-window items must never become plans/previews");
  assert.equal(existingSignalQueries, 0, "planning skip must happen before existing-signal loading");
  assert.deepEqual(voiceSignalUpdates, [], "the published-attached row must not be rewritten");
  assert.deepEqual(voiceSignalCreates, [], "the late item must not create another signal row");
  assert.match(logs.at(-1) || "", /skippedPublishedEdition=1/);
}

async function proofVoiceCandidateFloor() {
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
  assert.deepEqual(candidateWhere?.OR, [
    { publishedAt: { gte: floor } },
    { publishedAt: null, ingestedAt: { gte: floor } },
  ]);
}

async function proofNormalizeClampIdempotency() {
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

  assert.equal(createdCandidates.length, 2);
  assert.equal(createdCandidates[0].publishedAt.toISOString(), ingestedAt.toISOString());
  assert.equal(
    createdCandidates[0].publishedAt.toISOString(),
    createdCandidates[1].publishedAt.toISOString(),
  );
  assert.equal(
    createdCandidates[0].raw.normalization.contentHash,
    createdCandidates[1].raw.normalization.contentHash,
  );
}

async function proofRepublishPositionOffset() {
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

  assert.equal(result.previews[0]?.position, 121);
  assert.equal(result.limit, 120);
  assert.match(logs[0] || "", / limit=120 /);
}

async function proofCarryForwardFloorAndNormalizeClamp() {
  assert.deepEqual(
    carryForwardClassificationFlags({
      isDup: true,
      isHeadlineCandidate: true,
      isPublished: true,
    }),
    { isDup: true, isHeadlineCandidate: true, isPublished: true },
  );

  const classifySource = await readFile(
    path.join(process.cwd(), "src/lib/pipeline/classify-llm.ts"),
    "utf8",
  );
  assert.match(classifySource, /if \(pendingOnly\) \{[\s\S]{0,160}where\.ingestedAt = \{ gte:/);
  assert.match(classifySource, /D1's isPublished bind guard depends on these flags surviving reclassification/);
  assert.match(
    classifySource,
    /const carriedFlags = carryForwardClassificationFlags\(item\.classifications\[0\]\)/,
  );
  assert.match(
    classifySource,
    /pipelineClassification\.create\(\{[\s\S]{0,800}\.\.\.carriedFlags/,
    "the carried flags must be part of the actual classification create data",
  );

  const now = new Date("2026-03-10T00:00:00.000Z");
  assert.equal(
    clampPublishedAt(new Date("2026-03-11T00:00:00.000Z"), now)?.toISOString(),
    now.toISOString(),
  );
  assert.equal(
    clampPublishedAt(new Date("2026-03-09T00:00:00.000Z"), now)?.toISOString(),
    "2026-03-09T00:00:00.000Z",
  );
  assert.equal(
    clampPublishedAt(new Date("2026-03-11T00:00:00.000Z"), null)?.toISOString(),
    "2026-03-11T00:00:00.000Z",
  );
}

function crosslinkItem() {
  const timestamp = new Date("2026-03-10T00:00:00.000Z");
  return {
    id: "hash-item",
    platform: "twitter",
    title: "Stable title",
    body: "Stable summary",
    url: "https://example.test/hash-item",
    canonicalUrl: null,
    publishedAt: timestamp,
    ingestedAt: timestamp,
    raw: {},
    createdAt: timestamp,
    classifications: [
      {
        ...classification({ id: 80, primaryTag: "TECH", score: 0.8 }),
      },
    ],
    runs: [],
  };
}

function existingCrosslinkDecision(inputHash: string) {
  return {
    pipelineItemId: "hash-item",
    inputHash,
    headlineCandidate: true,
    headlineScore: 80,
    dupCluster: "old-cluster",
    canonicalItemId: null,
    dupScore: null,
    priorityReason: "existing",
    priorityScore: 80,
    llmPayload: null,
  };
}

async function proofContentOnlyHashAndReuse() {
  const content = {
    title: "Stable title",
    shortSummary: "Stable summary",
    tags: { primary: "TECH", sub: null, action: "INFO", score: 0.8 },
    keyLinks: ["https://example.test/hash-item"],
    model: "proof-model",
    promptVersion: "proof-prompt",
  };
  const baseHash = buildCrosslinkInputHash(content);
  const metadataVariants = [
    { dateJst: "2026-03-11" },
    { clusterId: "different-cluster" },
    { canonicalItemId: "different-canonical" },
    { seedScore: 0.999 },
    { seedReason: "different-reason" },
    { isPrunedByRule: true },
  ];
  for (const metadata of metadataVariants) {
    assert.equal(
      buildCrosslinkInputHash({ ...content, ...metadata } as typeof content),
      baseHash,
      `row metadata must not affect inputHash: ${Object.keys(metadata)[0]}`,
    );
  }

  for (const changed of [
    { title: "Changed title" },
    { shortSummary: "Changed summary" },
    { tags: { ...content.tags, primary: "BUSINESS" } },
    { keyLinks: ["https://example.test/changed"] },
    { model: "changed-model" },
    { promptVersion: "changed-prompt" },
  ]) {
    assert.notEqual(buildCrosslinkInputHash({ ...content, ...changed }), baseHash);
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
    assert.equal(unchanged.counter.skippedUnchanged, 1);
    assert.equal(unchanged.counter.llmCalls, 0);
    assert.equal(unchanged.counter.processed, 0);
    assert.equal(unchanged.counter.persisted, 0, "unchanged content must not create a decision row");
    assert.equal(llmCalls, 0, "unchanged content must not call the LLM");
    assert.equal(decisionQueries[0].where.targetDateJst, undefined);
    assert.equal(decisionQueries[0].where.model, undefined);
    assert.equal(decisionQueries[0].where.promptVersion, undefined);
    assert.deepEqual(decisionQueries[0].orderBy, [
      { createdAt: "desc" },
      { id: "desc" },
    ]);

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
    assert.equal(sentinel.counter.skippedUnchanged, 0);
    assert.equal(sentinel.counter.llmCalls, 1);
    assert.equal(llmCalls, 1, "sentinel decisions must always be re-sent");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function alertEntry(id: number, articleUrl: string) {
  const timestamp = new Date("2026-03-10T00:00:00.000Z");
  return {
    id,
    sourceId: `source-${id}`,
    title: `Alert ${id}`,
    snippet: `Snippet ${id}`,
    articleUrl,
    rawLink: `raw-${id}`,
    publishedAt: timestamp,
    fetchedAt: timestamp,
    raw: {},
    source: {
      id: `source-${id}`,
      name: `Source ${id}`,
      feedUrl: `https://feed.example/${id}`,
      tags: [],
    },
  };
}

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

async function proofAlertIdentityAndDedupe() {
  const articleUrl = "https://alerts.example/article";
  const smaller = alertEntry(10, articleUrl);
  const larger = alertEntry(20, articleUrl);
  for (const permutation of [
    [smaller, larger],
    [larger, smaller],
  ]) {
    const { creates, result } = await normalizeAlertPermutation(permutation);
    assert.equal(result.perPlatform.alerts.scanned, 1);
    assert.equal(creates.length, 1, "one platform pass must emit one candidate per raw URL");
    assert.equal(creates[0].externalId, articleUrl);
    assert.equal(creates[0].url, articleUrl);
    assert.equal(creates[0].raw.data.rawLink, "raw-10", "smallest AlertEntry.id must win");
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
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, "legacy-alert");
  assert.equal(updates[0].data.externalId, articleUrl, "byUrl matches must migrate externalId");
}

async function proofStep4RepairGateAndFailSoft() {
  const clean = { crosslinkLlmDecisions: [{ inputHash: "clean" }] };
  const sentinel = {
    crosslinkLlmDecisions: [{ inputHash: `${FAILED_FALLBACK_INPUT_HASH_PREFIX}timeout` }],
  };
  const missing = { crosslinkLlmDecisions: [] };

  assert.equal(evaluateStep4RepairGate([sentinel, clean]).shouldRepair, true);
  assert.equal(evaluateStep4RepairGate([missing, missing]).shouldRepair, true);
  assert.equal(evaluateStep4RepairGate([]).shouldRepair, false, "an empty edition window is healthy");
  assert.equal(
    evaluateStep4RepairGate([clean, missing]).shouldRepair,
    false,
    "partial missing rows are the bounded-limit over-capture tail, not a repair trigger",
  );
  assert.equal(evaluateStep4RepairGate([clean, clean]).shouldRepair, false);

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
  assert.equal(missingKeyResult.status, "skipped_missing_api_key");
  assert.equal(crosslinkCalls, 0);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /OPENROUTER_API_KEY is missing/);
  assert.equal(continued, true, "missing repair credentials must resolve and let Step5 continue");
  assert.equal(queries[0].where.OR[0].publishedAt.gte.toISOString(), "2026-03-09T21:00:00.000Z");
  assert.equal(queries[0].where.OR[0].publishedAt.lt.toISOString(), "2026-03-10T21:00:00.000Z");

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
  assert.equal(repaired.status, "repaired");
  assert.equal(crosslinkOptions.length, 1);
  assert.equal(crosslinkOptions[0].limit, 600);
  assert.equal(crosslinkOptions[0].maxBatches, 3);
  assert.equal(crosslinkOptions[0].pendingOnly, true);
  assert.equal("dateJst" in crosslinkOptions[0], false, "repair must use the full rolling window");
  assert.equal(repaired.after?.shouldRepair, false);
}

async function run() {
  const proofs: Array<[string, () => Promise<void>]> = [
    ["① window tiling + editionKey closed-form identity", proofWindowIdentity],
    ["② late-ingest and delayed-classification rescue", proofRescueAndQueryBounds],
    ["③ cross-edition row guard + isPublished guard", proofDoubleBindGuards],
    ["D1b bound items can never be re-planned (position/inputHash refutation)", proofBoundItemsCannotBeReplanned],
    ["④ PR-A /latest filtering + both compose flips", proofPrAStatusAndLatest],
    ["⑤ limit-plus-one clamp is loud in summary JSON", proofClamp],
    ["⑥ decision/trust ranking + section agreement", proofRankingAndPlacement],
    ["D3 voice attribution uses each item's editionKey", proofVoiceClosedForm],
    ["D5 carry-forward + seven-day floor; normalize clamp", proofCarryForwardFloorAndNormalizeClamp],
    ["D3a published editions stay frozen for new voice signals", proofPublishedVoiceEditionIsFrozen],
    ["D3b voice candidate scan has a 48-hour floor", proofVoiceCandidateFloor],
    ["D5a future-date normalization clamp is idempotent", proofNormalizeClampIdempotency],
    ["D1a re-publish positions append after the existing max", proofRepublishPositionOffset],
    ["⑥ PR-C D6 content-only hash + sentinel/unchanged behavior", proofContentOnlyHashAndReuse],
    ["⑦ PR-C D7 alert identity + pass-wide deterministic dedupe", proofAlertIdentityAndDedupe],
    ["⑧ PR-C D8 repair fire gate + fail-soft credentials", proofStep4RepairGateAndFailSoft],
  ];

  for (const [name, proof] of proofs) {
    await proof();
    console.log(`PASS ${name}`);
  }

  console.log("All Issue #118 PR-A/PR-B/PR-C proofs passed.");
}

run().catch((error) => {
  console.error("Issue #118 proof failed:", error);
  process.exitCode = 1;
});
