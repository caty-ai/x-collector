import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  PUBLIC_EDITION_FIELDS,
  PUBLIC_ITEM_FIELDS,
} from "@/lib/pipeline/edition-public";

const mocks = vi.hoisted(() => ({
  editionFindFirst: vi.fn(),
  editionFindUnique: vi.fn(),
  bindingFindMany: vi.fn(),
  sourceFindMany: vi.fn(),
}));

vi.mock("@prisma/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@prisma/client")>()),
  PrismaClient: class {
    newsletterEdition = {
      findFirst: mocks.editionFindFirst,
      findUnique: mocks.editionFindUnique,
    };
    newsletterBinding = { findMany: mocks.bindingFindMany };
    source = { findMany: mocks.sourceFindMany };
  },
}));

import { GET } from "@/app/api/newsletter-editions/latest/route";

const edition = {
  id: "edition-1",
  editionDate: new Date("2026-09-07T15:00:00.000Z"),
  title: "Daily News",
  slug: "daily-news-20260908",
  status: "published",
  summary: null,
  model: "model",
  generatedAt: new Date("2026-09-08T00:00:00.000Z"),
  publishedAt: new Date("2026-09-08T01:00:00.000Z"),
  createdAt: new Date("2026-09-08T00:00:00.000Z"),
  updatedAt: new Date("2026-09-08T01:00:00.000Z"),
  contentMd: "# Published",
  _count: { bindings: 1, voiceSignals: 2 },
};

const binding = {
  pipelineItemId: "pipeline-1",
  section: "Top stories",
  position: 1,
  pipelineItem: {
    id: "pipeline-1",
    title: "Title",
    url: "https://example.com/article",
    canonicalUrl: null,
    platform: "twitter",
    sourceRef: "@example",
  },
  classification: { titleJa: "タイトル" },
};

function req(query = ""): NextRequest {
  return new NextRequest(`https://api.example/api/newsletter-editions/latest${query}`, {
    headers: { Authorization: "Bearer test-key" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEWSLETTER_API_KEY", "test-key");
  mocks.editionFindFirst.mockResolvedValue(edition);
  mocks.editionFindUnique.mockResolvedValue(edition);
  mocks.bindingFindMany.mockResolvedValue([binding]);
  mocks.sourceFindMany.mockResolvedValue([{ handle: "example", trustLabel: "high" }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("newsletter latest upstream route", () => {
  it("adds published status to an explicit date lookup", async () => {
    const response = await GET(req("?status=published&date=2026-09-08"));

    expect(response.status).toBe(200);
    expect(mocks.editionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "published" }),
      }),
    );
  });

  it("does not execute the latest fallback for published-only lookup", async () => {
    mocks.editionFindFirst.mockResolvedValue(null);

    const response = await GET(req("?status=published"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Edition not found" });
    expect(mocks.editionFindFirst).toHaveBeenCalledTimes(1);
  });

  it("keeps the latest fallback when status is absent", async () => {
    mocks.editionFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(edition);

    const response = await GET(req());

    expect(response.status).toBe(200);
    expect(mocks.editionFindFirst).toHaveBeenCalledTimes(2);
    expect(mocks.editionFindFirst.mock.calls[1]?.[0]).toMatchObject({
      where: { contentMd: { not: null } },
    });
  });

  it("rejects unsupported status values before querying", async () => {
    const response = await GET(req("?status=draft"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid status. Use status=published" });
    expect(mocks.editionFindFirst).not.toHaveBeenCalled();
    expect(mocks.editionFindUnique).not.toHaveBeenCalled();
  });

  it("rejects unsupported projection values before querying", async () => {
    const response = await GET(req("?projection=private"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid projection. Use projection=public",
    });
    expect(mocks.editionFindFirst).not.toHaveBeenCalled();
    expect(mocks.editionFindUnique).not.toHaveBeenCalled();
  });

  it("uses a published findFirst slug lookup without fallback", async () => {
    mocks.editionFindFirst.mockResolvedValue(null);

    const response = await GET(req("?slug=daily-news-20260908&status=published"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Edition not found" });
    expect(mocks.editionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: "daily-news-20260908", status: "published" },
      }),
    );
    expect(mocks.editionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.editionFindUnique).not.toHaveBeenCalled();
  });

  it("keeps findUnique for a slug lookup without status", async () => {
    const response = await GET(req("?slug=daily-news-20260908"));

    expect(response.status).toBe(200);
    expect(mocks.editionFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "daily-news-20260908" } }),
    );
    expect(mocks.editionFindFirst).not.toHaveBeenCalled();
  });

  it("projects JSON editions and items through exact allow-lists", async () => {
    const response = await GET(req("?projection=public&includeItems=1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body.edition).sort()).toEqual([...PUBLIC_EDITION_FIELDS].sort());
    expect(Object.keys(body.edition.items[0]).sort()).toEqual([...PUBLIC_ITEM_FIELDS].sort());
    expect(body.edition).not.toHaveProperty("id");
    expect(body.edition.items[0]).not.toHaveProperty("pipelineItemId");
  });

  it("uses the reduced markdown header set for public projection", async () => {
    const response = await GET(req("?projection=public&format=markdown"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-edition-status")).toBe("published");
    expect(response.headers.has("x-edition-id")).toBe(false);
    expect(response.headers.has("x-edition-slug")).toBe(false);
  });

  it("preserves the complete legacy JSON response without projection", async () => {
    const response = await GET(req("?includeItems=1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body)).toEqual(["meta", "edition"]);
    expect(body).toEqual({
      meta: {
        dateBasis: "latest",
        timeZoneForDateParam: "Asia/Tokyo",
        requestedDate: null,
        requestedSlug: null,
      },
      edition: {
        id: "edition-1",
        editionDate: "2026-09-07",
        title: "Daily News",
        slug: "daily-news-20260908",
        status: "published",
        summary: null,
        model: "model",
        generatedAt: "2026-09-08T00:00:00.000Z",
        publishedAt: "2026-09-08T01:00:00.000Z",
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T01:00:00.000Z",
        bindingsCount: 1,
        voiceSignalCount: 2,
        contentChars: 11,
        contentMd: "# Published",
        items: [
          {
            pipelineItemId: "pipeline-1",
            section: "Top stories",
            position: 1,
            title: "Title",
            titleJa: "タイトル",
            url: "https://example.com/article",
            platform: "twitter",
            sourceRef: "@example",
            trustLabel: "high",
          },
        ],
      },
    });
  });

  it("locks the exact legacy JSON bytes without projection", async () => {
    const expectedLegacyBody = {
      meta: {
        dateBasis: "latest",
        timeZoneForDateParam: "Asia/Tokyo",
        requestedDate: null,
        requestedSlug: null,
      },
      edition: {
        id: "edition-1",
        editionDate: "2026-09-07",
        title: "Daily News",
        slug: "daily-news-20260908",
        status: "published",
        summary: null,
        model: "model",
        generatedAt: "2026-09-08T00:00:00.000Z",
        publishedAt: "2026-09-08T01:00:00.000Z",
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T01:00:00.000Z",
        bindingsCount: 1,
        voiceSignalCount: 2,
        contentChars: 11,
        contentMd: "# Published",
        items: [
          {
            pipelineItemId: "pipeline-1",
            section: "Top stories",
            position: 1,
            title: "Title",
            titleJa: "タイトル",
            url: "https://example.com/article",
            platform: "twitter",
            sourceRef: "@example",
            trustLabel: "high",
          },
        ],
      },
    };
    const response = await GET(req("?includeItems=1&includeContent=1"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(JSON.stringify(expectedLegacyBody));
  });

  it("preserves legacy markdown response headers without projection", async () => {
    const response = await GET(req("?format=markdown"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-edition-id")).toBe("edition-1");
    expect(response.headers.get("x-edition-slug")).toBe("daily-news-20260908");
    expect(response.headers.get("x-edition-status")).toBe("published");
  });
});
