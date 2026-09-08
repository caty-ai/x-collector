import { describe, expect, it } from "vitest";

import {
  PUBLIC_EDITION_FIELDS,
  PUBLIC_ITEM_FIELDS,
  buildEditionLookup,
  parseEditionProjectionParam,
  parseEditionStatusParam,
  projectPublicEdition,
  projectPublicItem,
  publicMarkdownHeaders,
  type FullEditionJson,
  type FullItemJson,
} from "../edition-public";

const item: FullItemJson = {
  pipelineItemId: "pipeline-1",
  section: "Top stories",
  position: 1,
  title: "Title",
  titleJa: "タイトル",
  url: "https://example.com/article",
  platform: "twitter",
  sourceRef: "@example",
  trustLabel: "high",
};

const edition: FullEditionJson = {
  id: "edition-1",
  editionDate: "2026-09-08",
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
  contentChars: 10,
  contentMd: "# News",
  items: [item],
};

describe("edition public query parameters", () => {
  it("accepts only a missing status or published", () => {
    expect(parseEditionStatusParam(null)).toEqual({ ok: true, status: null });
    expect(parseEditionStatusParam("published")).toEqual({ ok: true, status: "published" });
    for (const value of ["", "draft", "PUBLISHED"]) {
      expect(parseEditionStatusParam(value)).toEqual({ ok: false });
    }
  });

  it("accepts only a missing projection or public", () => {
    expect(parseEditionProjectionParam(null)).toEqual({ ok: true, projection: null });
    expect(parseEditionProjectionParam("public")).toEqual({ ok: true, projection: "public" });
    for (const value of ["", "private", "PUBLIC"]) {
      expect(parseEditionProjectionParam(value)).toEqual({ ok: false });
    }
  });
});

describe("buildEditionLookup", () => {
  const dateRange = {
    start: new Date("2026-09-07T15:00:00.000Z"),
    end: new Date("2026-09-08T14:59:59.999Z"),
  };

  it.each([
    ["slug", { slug: "daily-news", dateRange: null }, "findUnique", false, false, false],
    ["slug published", { slug: "daily-news", dateRange: null }, "findFirst", true, true, false],
    ["date", { slug: null, dateRange }, "findFirst", false, false, false],
    ["date published", { slug: null, dateRange }, "findFirst", true, true, false],
    ["latest", { slug: null, dateRange: null }, "findFirst", false, true, true],
    ["latest published", { slug: null, dateRange: null }, "findFirst", true, true, false],
  ] as const)(
    "builds the %s primary query",
    (_label, input, method, publishedOnly, primaryHasStatus, hasFallback) => {
      const lookup = buildEditionLookup({ ...input, publishedOnly });

      expect(lookup.method).toBe(method);
      expect(
        "status" in lookup.primary.where && lookup.primary.where.status === "published",
      ).toBe(primaryHasStatus);
      if (hasFallback) expect(lookup.fallback).not.toBeNull();
      else expect(lookup.fallback).toBeNull();
    },
  );

  it("keeps the legacy latest fallback only when publishedOnly is false", () => {
    const lookup = buildEditionLookup({ slug: null, dateRange: null, publishedOnly: false });

    expect(lookup.primary).toEqual({
      where: { status: "published", contentMd: { not: null } },
      orderBy: [{ editionDate: "desc" }, { updatedAt: "desc" }],
    });
    expect(lookup.fallback).toEqual({
      where: { contentMd: { not: null } },
      orderBy: [{ editionDate: "desc" }, { updatedAt: "desc" }],
    });
  });
});

describe("public edition projection", () => {
  it("picks exactly the public edition and item fields", () => {
    const projectedEdition = projectPublicEdition({
      ...edition,
      internalNote: "must not leak",
    } as FullEditionJson & { internalNote: string });
    const projectedItem = projectPublicItem({
      ...item,
      internalNote: "must not leak",
    } as FullItemJson & { internalNote: string });

    expect(Object.keys(projectedEdition).sort()).toEqual([...PUBLIC_EDITION_FIELDS].sort());
    expect(Object.keys(projectedItem).sort()).toEqual([...PUBLIC_ITEM_FIELDS].sort());
    expect(projectedEdition).not.toHaveProperty("internalNote");
    expect(projectedEdition.items?.[0]).not.toHaveProperty("internalNote");
    expect(projectedItem).not.toHaveProperty("internalNote");
    expect(projectedItem.url).toBe(item.url);
    expect(projectedItem.trustLabel).toBe(item.trustLabel);
  });

  it("omits contentMd and items when the full response omitted them", () => {
    const { contentMd: _contentMd, items: _items, ...withoutOptionals } = edition;
    const projected = projectPublicEdition(withoutOptionals);

    expect(projected).not.toHaveProperty("contentMd");
    expect(projected).not.toHaveProperty("items");
    expect(Object.keys(projected).sort()).toEqual(
      PUBLIC_EDITION_FIELDS.filter((field) => field !== "contentMd" && field !== "items").sort(),
    );
  });

  it("returns only public markdown headers", () => {
    const headers = publicMarkdownHeaders({ status: "published" });

    expect(headers).toEqual({
      "content-type": "text/markdown; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-edition-status": "published",
    });
    expect(headers).not.toHaveProperty("x-edition-id");
    expect(headers).not.toHaveProperty("x-edition-slug");
  });
});
