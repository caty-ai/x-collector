export const quietLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function classification(overrides: Record<string, unknown> = {}) {
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

export function decision(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    inputHash: "clean-input-hash",
    headlineCandidate: false,
    priorityScore: 50,
    createdAt: new Date("2026-03-10T12:00:00.000Z"),
    ...overrides,
  };
}

export function publishItem(id: string, overrides: Record<string, unknown> = {}) {
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

export function publishPrismaStub(options: PublishStubOptions = {}) {
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

export function crosslinkItem() {
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

export function existingCrosslinkDecision(inputHash: string) {
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

export function alertEntry(id: number, articleUrl: string) {
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
