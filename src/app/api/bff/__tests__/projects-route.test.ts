import { NextRequest } from "next/server";
import type { OgImageResult } from "@/lib/bff/og-image";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sources: vi.fn(), release: vi.fn(), allow: vi.fn(), fetch: vi.fn(), auth: vi.fn() }));
vi.mock("@prisma/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@prisma/client")>(),
  PrismaClient: class {
    ghSource = { findMany: mocks.sources };
    $queryRaw = mocks.release;
  },
}));
vi.mock("@/lib/bff/public-throttle", () => ({ consumePublicThrottle: mocks.allow }));
vi.mock("@/lib/bff/reader-auth", () => ({ resolveBffReaderAuth: mocks.auth }));
vi.mock("@/lib/bff/og-image", () => ({ fetchOgImage: mocks.fetch }));

import { dynamic, runtime, GET, HEAD } from "@/app/api/bff/projects/route";

const cacheControl = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
type Source = {
  id: number; name: string; repo: string | null; description: string | null;
  tags: string[]; active: boolean; type: string; isPrivate: boolean | null;
};
type Release = { tagName: string; url: string; publishedAt: Date | null; fetchedAt: Date };

let nextSourceId = 1;
function source(name: string, overrides: Partial<Source> = {}): Source {
  return { id: nextSourceId++, name, repo: `publisher/${name}`, description: null, tags: ["family"], active: true, type: "repo", isPrivate: false, ...overrides };
}

function release(date: string | null, fetchedAt = "2026-09-01T00:00:00Z"): Release {
  return {
    tagName: "v1.0.0", url: "https://github.com/publisher/project/releases/tag/v1.0.0",
    publishedAt: date ? new Date(date) : null, fetchedAt: new Date(fetchedAt),
  };
}

function seed(sources: Source[], releases: Record<string, Release | Release[]> = {}) {
  // Emulate Prisma's eligibility filters so excluded rows exercise the query contract.
  mocks.sources.mockImplementation(async ({ where, orderBy, take }) => sources.filter((row) =>
    (where.active === undefined || row.active === where.active)
    && (where.type === undefined || row.type === where.type)
    && (!where.repo || row.repo !== where.repo.not)
    && (!where.OR || where.OR.some(({ repo }: { repo: { equals: string; mode: string } }) =>
      repo.mode === "insensitive" ? row.repo?.toLowerCase() === repo.equals.toLowerCase() : row.repo === repo.equals))
    && (where.isPrivate === undefined || row.isPrivate === where.isPrivate)
    && (!where.tags?.has || row.tags.includes(where.tags.has)),
  ).sort((a, b) => orderBy?.name === "asc" ? a.name.localeCompare(b.name, "en") : 0).slice(0, take));
  mocks.release.mockImplementation(async (query: Prisma.Sql) => {
    expectReleaseQuery(query.values as number[], query);

    // Emulate the asserted SQL's per-source ordering and DISTINCT ON result.
    return (query.values as number[]).flatMap((sourceId) => {
      const name = sources.find((row) => row.id === sourceId)?.name;
      const candidates = name ? releases[name] : undefined;
      const rows = candidates ? [candidates].flat() : [];
      rows.sort((a, b) => {
        if (a.publishedAt === null && b.publishedAt !== null) return 1;
        if (a.publishedAt !== null && b.publishedAt === null) return -1;
        return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)
          || b.fetchedAt.getTime() - a.fetchedAt.getTime();
      });
      return rows.length ? [{ sourceId, ...rows[0] }] : [];
    });
  });
}

function expectReleaseQuery(sourceIds: number[], currentQuery?: Prisma.Sql) {
  if (!currentQuery) expect(mocks.release).toHaveBeenCalledTimes(1);
  const query = currentQuery ?? mocks.release.mock.calls[0][0] as Prisma.Sql;
  expect(query.values).toEqual(sourceIds);
  const placeholders = sourceIds.map((_, index) => `$${index + 1}`).join(",");
  expect(query.text.replace(/\s+/g, " ").trim()).toBe(
    'SELECT DISTINCT ON ("sourceId") "sourceId", "tagName", "url", "publishedAt", "fetchedAt" '
    + 'FROM gh_items WHERE type = \'release\' AND "sourceId" = ANY(ARRAY[' + placeholders + ']::integer[]) '
    + 'ORDER BY "sourceId", "publishedAt" DESC NULLS LAST, "fetchedAt" DESC',
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  nextSourceId = 1;
  mocks.allow.mockReturnValue(true);
  mocks.auth.mockResolvedValue({ mode: "public" });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  for (const key of ["SHELF", "TAG", "TITLE", "LIMIT", "FEATURED"]) vi.stubEnv(`NEWSPAPER_PROJECTS_${key}`, undefined);
  mocks.fetch.mockRejectedValue(new Error("No image"));
  seed([]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("public projects BFF", () => {
  it("is dynamic and returns 404 without querying when disabled", async () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    const response = await GET(new NextRequest("https://example.com/api/bff/projects"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not found" });
    expect(mocks.sources).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD"])("returns 404 for disabled %s without consuming limiter tokens even when denied", async (method) => {
    mocks.allow.mockReturnValue(false);
    mocks.auth.mockResolvedValue({ mode: "denied" });
    const request = new NextRequest("https://example.com/api/bff/projects", { method });
    const response = await (method === "HEAD" ? HEAD(request) : GET(request));
    expect(response.status).toBe(404);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.allow).not.toHaveBeenCalled();
    expect(mocks.sources).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD"])("rejects denied %s before querying or throttling", async (method) => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
    mocks.auth.mockResolvedValue({ mode: "denied" });
    const request = new NextRequest("https://example.com/api/bff/projects", { method });
    const response = await (method === "HEAD" ? HEAD(request) : GET(request));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.auth).toHaveBeenCalledTimes(1);
    expect(mocks.auth).toHaveBeenCalledWith(request);
    expect(mocks.allow).not.toHaveBeenCalled();
    expect(mocks.sources).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["shared", "session"])("allows %s access without consuming public throttle", async (mode) => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
    mocks.auth.mockResolvedValue({ mode });
    mocks.allow.mockReturnValue(false);
    const response = await GET(new NextRequest("https://example.com/api/bff/projects"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ title: "Projects", items: [] });
    expect(mocks.allow).not.toHaveBeenCalled();
  });

  describe.each(["sources", "featured"])("%s response caching", (shelfMode) => {
    it.each([
      ["public", "GET"], ["public", "HEAD"],
      ["shared", "GET"], ["shared", "HEAD"],
      ["session", "GET"], ["session", "HEAD"],
    ])("sets the cache policy for %s %s", async (mode, method) => {
      vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
      if (shelfMode === "featured") {
        vi.stubEnv("NEWSPAPER_PROJECTS_FEATURED", JSON.stringify([
          { title: "Card", url: "https://example.com/project", image: "https://images.example/preview.png" },
        ]));
      }
      mocks.auth.mockResolvedValue({ mode });
      const response = await (method === "HEAD" ? HEAD : GET)(
        new NextRequest("https://example.com/api/bff/projects", { method }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(mode === "public" ? cacheControl : "private, no-store");
      if (method === "HEAD") expect(await response.text()).toBe("");
      else expect((await response.json()).items).toHaveLength(shelfMode === "featured" ? 1 : 0);
    });
  });

  it("returns only public fields and intentionally excludes mixed-case Studio tags", async () => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", " TRUE ");
    vi.stubEnv("NEWSPAPER_PROJECTS_TAG", " Family ");
    vi.stubEnv("NEWSPAPER_PROJECTS_TITLE", " Publisher projects ");
    seed([
      source("included", { tags: ["other", "family"], description: "A public project" }),
      source("inactive", { tags: ["family"], active: false }),
      source("search", { tags: ["family"], type: "search" }),
      source("missing-repo", { tags: ["family"], repo: null }),
      source("mixed-case", { tags: ["Family"] }),
      source("wrong-tag", { tags: ["other"] }),
      source("private", { tags: ["family"], isPrivate: true }),
      source("unknown", { tags: ["family"], isPrivate: null }),
    ], { included: release("2026-09-05T12:00:00Z") });
    const response = await GET(new NextRequest("https://example.com/api/bff/projects"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(cacheControl);
    expect(await response.json()).toEqual({
      title: "Publisher projects",
      items: [{
        name: "included", repo: "publisher/included", repoUrl: "https://github.com/publisher/included",
        description: "A public project", latestTag: "v1.0.0",
        latestUrl: "https://github.com/publisher/project/releases/tag/v1.0.0",
        publishedAt: "2026-09-05T12:00:00.000Z",
      }],
    });
    expect(mocks.sources).toHaveBeenCalledWith(expect.objectContaining({
      where: { active: true, type: "repo", repo: { not: null }, isPrivate: false, tags: { has: "family" } },
      orderBy: { name: "asc" },
      take: 200,
    }));
    expect(mocks.sources).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledTimes(1);
    expectReleaseQuery([1]);
  });

  it("preserves the serialized v0.4.16 sources response", async () => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
    seed([source("project")]);
    const response = await GET(new NextRequest("https://example.com/api/bff/projects"));
    expect(await response.text()).toBe('{"title":"Projects","items":[{"name":"project","repo":"publisher/project","repoUrl":"https://github.com/publisher/project","description":null,"latestTag":null,"latestUrl":null,"publishedAt":null}]}');
  });

  it.each([
    ["dated over undated with a newer fetch", release(null, "2026-09-06T00:00:00Z"), release("2026-09-02T00:00:00Z")],
    ["newest published date", release("2026-09-02T00:00:00Z", "2026-09-06T00:00:00Z"), release("2026-09-05T00:00:00Z")],
    ["newest fetch for tied published dates", release("2026-09-05T00:00:00Z"), release("2026-09-05T00:00:00Z", "2026-09-06T00:00:00Z")],
    ["newest fetch when both dates are absent", release(null), release(null, "2026-09-06T00:00:00Z")],
  ])("selects one source's latest release by %s", async (_rule, other, latest) => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
    seed([source("project")], {
      project: [{ ...other, tagName: "other" }, { ...latest, tagName: "latest" }],
    });
    const response = await GET(new NextRequest("https://example.com/api/bff/projects"));
    expect(response.status).toBe(200);
    expect((await response.json()).items).toEqual([
      expect.objectContaining({ name: "project", latestTag: "latest", publishedAt: latest.publishedAt?.toISOString() ?? null }),
    ]);
  });

  it("orders releases by date with fetched fallback, then unreleased projects by name", async () => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
    seed([
      source("Zulu"), source("older"), source("newest"), source("Alpha"), source("fallback"),
    ], {
      older: release("2026-09-02T00:00:00Z", "2026-09-06T00:00:00Z"),
      newest: release("2026-09-05T00:00:00Z"),
      fallback: release(null, "2026-09-04T00:00:00Z"),
    });
    const body = await (await GET(new NextRequest("https://example.com/api/bff/projects"))).json();
    expect(body.items.map((item: { name: string }) => item.name)).toEqual(["newest", "fallback", "older", "Alpha", "Zulu"]);
    expect(body.items[1].publishedAt).toBeNull();
    expect(body.items[3]).toEqual({
      name: "Alpha", repo: "publisher/Alpha", repoUrl: "https://github.com/publisher/Alpha",
      description: null, latestTag: null, latestUrl: null, publishedAt: null,
    });
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(["description", "latestTag", "latestUrl", "name", "publishedAt", "repo", "repoUrl"]);
    }
  });

  it("applies the limit after ordering", async () => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
    vi.stubEnv("NEWSPAPER_PROJECTS_LIMIT", "2");
    seed([source("Zulu"), source("Alpha"), source("release")], { release: release("2026-09-05T00:00:00Z") });
    expect((await (await GET(new NextRequest("https://example.com/api/bff/projects"))).json()).items.map((item: { name: string }) => item.name)).toEqual(["release", "Alpha"]);
  });

  it("returns an empty shelf when no eligible projects exist", async () => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
    expect(await (await GET(new NextRequest("https://example.com/api/bff/projects"))).json()).toEqual({ title: "Projects", items: [] });
    expect(mocks.sources).toHaveBeenCalledTimes(1);
    expectReleaseQuery([]);
  });

  it("returns an empty HEAD with matching status and cache headers", async () => {
    const disabled = await HEAD(new NextRequest("https://example.com/api/bff/projects", { method: "HEAD" }));
    expect(disabled.status).toBe(404);
    expect(await disabled.text()).toBe("");
    expect(mocks.sources).not.toHaveBeenCalled();
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
    mocks.allow.mockClear();
    const enabled = await HEAD(new NextRequest("https://example.com/api/bff/projects", { method: "HEAD" }));
    expect(enabled.status).toBe(200);
    expect(enabled.headers.get("cache-control")).toBe(cacheControl);
    expect(await enabled.text()).toBe("");
    expect(mocks.allow).toHaveBeenCalledTimes(1);
    expect(mocks.sources).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("warns and caps overflow at the first 200 tagged public sources by name", async () => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
    const eligible = Array.from({ length: 201 }, (_, index) => source(`project-${String(index).padStart(3, "0")}`));
    seed([
      ...Array.from({ length: 501 }, (_, index) => source(`aaa-unrelated-${index}`, { tags: ["other"] })),
      source("private", { isPrivate: true }), source("unknown", { isPrivate: null }),
      ...[...eligible].reverse(),
    ]);
    await GET(new NextRequest("https://example.com/api/bff/projects"));
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      "[bff/projects] tagged sources reached 200; results may be truncated to the first 200 by name",
    );
    expect(mocks.sources).toHaveBeenCalledTimes(1);
    expectReleaseQuery(eligible.slice(0, 200).map((row) => row.id));
  });

  it("fetches all 200 tagged sources and applies the display limit after release ordering", async () => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
    vi.stubEnv("NEWSPAPER_PROJECTS_LIMIT", "1");
    const eligible = Array.from({ length: 200 }, (_, index) => source(`project-${String(index).padStart(3, "0")}`));
    seed(eligible, { "project-199": release("2026-09-05T00:00:00Z") });
    const body = await (await GET(new NextRequest("https://example.com/api/bff/projects"))).json();
    expect(body.items.map((item: { name: string }) => item.name)).toEqual(["project-199"]);
    expectReleaseQuery(eligible.map((row) => row.id));
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      "[bff/projects] tagged sources reached 200; results may be truncated to the first 200 by name",
    );
  });

  it("encodes each repository URL path segment", async () => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
    seed([source("encoded", { repo: "owner name/repo?#" })]);
    const body = await (await GET(new NextRequest("https://example.com/api/bff/projects"))).json();
    expect(body.items[0].repoUrl).toBe("https://github.com/owner%20name/repo%3F%23");
  });

  it.each(["GET", "HEAD"])("rate limits public %s through the shared throttle without querying", async (method) => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
    mocks.allow.mockReturnValue(false);
    const request = new NextRequest("https://example.com/api/bff/projects", {
      method, headers: { "x-forwarded-for": "spoofed, 203.0.113.7", "x-real-ip": "ignored" },
    });
    const response = await (method === "HEAD" ? HEAD(request) : GET(request));
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("60");
    if (method === "HEAD") expect(await response.text()).toBe("");
    else expect(await response.json()).toEqual({ error: "rate limit exceeded" });
    expect(mocks.allow).toHaveBeenCalledTimes(1);
    expect(mocks.allow).toHaveBeenCalledWith(request, "projects", 120);
    expect(mocks.sources).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it.each(["sources", "release", "limiter"])("returns a no-store 503 for a %s failure, including HEAD", async (failure) => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
    if (failure === "limiter") mocks.allow.mockImplementation(() => { throw new Error("failed"); });
    else mocks[failure as "sources" | "release"].mockRejectedValue(new Error("failed"));
    const response = await GET(new NextRequest("https://example.com/api/bff/projects"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unavailable" });
    const head = await HEAD(new NextRequest("https://example.com/api/bff/projects", { method: "HEAD" }));
    expect(head.status).toBe(503);
    expect(head.headers.get("cache-control")).toBe("no-store");
    expect(await head.text()).toBe("");
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith("[bff/projects] unavailable:", "failed");
  });

});

type Featured = { title: string; url: string; description?: string; image?: string };
function feature(entries: Featured[]) {
  vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "1");
  vi.stubEnv("NEWSPAPER_PROJECTS_FEATURED", JSON.stringify(entries));
}
function resolvedImage(url: string): OgImageResult {
  return { kind: "found", url };
}
function getProjects() {
  return GET(new NextRequest("https://example.com/api/bff/projects"));
}

describe("featured projects BFF", () => {
  it("preserves configured order and fields, enriches case-insensitive public GitHub repos, and excludes private releases", async () => {
    feature([
      { title: "Public card", url: "https://GITHUB.COM/PUBLISHER/Public", image: "https://images.example/public.png" },
      { title: "Private card", url: "https://github.com/publisher/private", image: "https://images.example/private.png" },
      { title: "Website", url: "https://website.example", description: "Configured description", image: "https://images.example/site.png" },
    ]);
    vi.stubEnv("NEWSPAPER_PROJECTS_TITLE", "My projects");
    vi.stubEnv("NEWSPAPER_PROJECTS_LIMIT", "1");
    seed([
      source("Public", { repo: "publisher/PUBLIC", description: "Public fallback", tags: [] }),
      source("private", { isPrivate: true, description: "Private description" }),
      source("unconfigured"),
    ], { Public: release("2026-09-05T12:00:00Z"), private: release("2026-09-06T00:00:00Z") });
    const response = await getProjects();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(cacheControl);
    expect(await response.json()).toEqual({
      title: "My projects", mode: "featured", items: [
        { kind: "featured", name: "Public card", url: "https://GITHUB.COM/PUBLISHER/Public", description: "Public fallback",
          imageUrl: "https://images.example/public.png", latestTag: "v1.0.0", latestUrl: "https://github.com/publisher/project/releases/tag/v1.0.0", publishedAt: "2026-09-05T12:00:00.000Z" },
        { kind: "featured", name: "Private card", url: "https://github.com/publisher/private", description: null,
          imageUrl: "https://images.example/private.png", latestTag: null, latestUrl: null, publishedAt: null },
        { kind: "featured", name: "Website", url: "https://website.example", description: "Configured description",
          imageUrl: "https://images.example/site.png", latestTag: null, latestUrl: null, publishedAt: null },
      ],
    });
    expect(mocks.sources).toHaveBeenCalledWith(expect.objectContaining({ where: {
      active: true, type: "repo", isPrivate: false,
      OR: [{ repo: { equals: "publisher/public", mode: "insensitive" } }, { repo: { equals: "publisher/private", mode: "insensitive" } }],
    } }));
    expectReleaseQuery([1]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["private", { isPrivate: true }], ["unknown", { isPrivate: null }],
    ["inactive", { active: false }], ["search", { type: "search" }], ["missing", null],
  ] as const)("keeps the card without leaking %s source metadata", async (_name, overrides) => {
    feature([{ title: "Card", url: "https://github.com/publisher/project", image: "https://images.example/preview.png" }]);
    seed(overrides ? [source("project", { ...overrides, description: "Secret" })] : [], { project: release("2026-09-05T00:00:00Z") });
    const body = await (await getProjects()).json();
    expect(body.items[0]).toMatchObject({ name: "Card", description: null, latestTag: null, latestUrl: null, publishedAt: null });
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it.each(["https://github.com/publisher/project.git", "https://github.com/publisher/project/", "https://github.com/publisher/project.git/"])("enriches the repository URL variant %s", async (url) => {
    feature([{ title: "Project", url, image: "https://images.example/preview.png" }]);
    seed([source("project", { repo: "publisher/project", description: "Project description" })], {
      project: release("2026-09-05T00:00:00Z"),
    });
    expect((await (await getProjects()).json()).items[0]).toMatchObject({
      url, description: "Project description", latestTag: "v1.0.0", publishedAt: "2026-09-05T00:00:00.000Z",
    });
    expect(mocks.sources).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      OR: [{ repo: { equals: "publisher/project", mode: "insensitive" } }],
    }) }));
    expectReleaseQuery([1]);
  });

  it.each([
    "http://github.com/publisher/project", "https://github.com/publisher/project/issues",
    "https://github.com/publisher", "https://github.com.evil.example/publisher/project",
  ])("does not enrich non-repository URL %s", async (url) => {
    feature([{ title: "Card", url, image: "https://images.example/preview.png" }]);
    seed([source("project")], { project: release("2026-09-05T00:00:00Z") });
    expect((await (await getProjects()).json()).items[0].latestTag).toBeNull();
    expect(mocks.sources).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it.each(["url", "image"])("drops credentialed configured %s before returning public data", async (field) => {
    feature([
      { title: "Secret card", url: "https://example.com", [field]: "https://user:token@example.com/" },
      { title: "Safe card", url: "https://safe.example", image: "https://avatars.githubusercontent.com/u/1" },
    ]);
    const response = await getProjects();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("Safe card");
    expect(JSON.stringify(body)).not.toContain("user:token");
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  describe.each(["configured", "og"] as const)("%s image hygiene", (kind) => {
    it.each([
      "http://example.com/image.png", "https://127.0.0.1/image.png", "https://8.8.8.8/image.png",
      "https://[::1]/image.png", "https://[2001:4860:4860::8888]/image.png",
      "https://localhost/image.png", "https://app.localhost/image.png", "https://app.local/image.png",
      "https://app.internal/image.png", "https://example.com:8443/image.png",
    ])("drops configured HTTP entries or returns a null image for %s", async (image) => {
      const url = `https://image-hygiene.example/${kind}/${encodeURIComponent(image)}`;
      feature([{ title: "Card", url, ...(kind === "configured" ? { image } : {}) }]);
      mocks.fetch.mockResolvedValue(resolvedImage(image));
      const response = await getProjects();
      expect(response.status).toBe(200);
      const body = await response.json();
      if (kind === "configured" && image.startsWith("http://")) {
        expect(body.items).toEqual([]);
        expect(console.warn).toHaveBeenCalledTimes(1);
      } else {
        expect(body.items[0]).toMatchObject({ name: "Card", imageUrl: null });
      }
      if (kind === "configured") expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it.each(["https://avatars.githubusercontent.com/u/1", "https://opengraph.githubassets.com/hash/org/repo"])("accepts %s", async (image) => {
      const url = `https://image-hygiene.example/${kind}/${encodeURIComponent(image)}`;
      feature([{ title: "Card", url, ...(kind === "configured" ? { image } : {}) }]);
      mocks.fetch.mockResolvedValue(resolvedImage(image));
      expect((await (await getProjects()).json()).items[0].imageUrl).toBe(image);
    });
  });

  it.each(["https://user:token@example.com/", "https://user@example.com/", "https://:token@example.com/"])("suppresses credentialed OG image %s", async (image) => {
    const url = `https://og-credentials.example/${encodeURIComponent(image)}`;
    feature([{ title: "Card", url }]);
    mocks.fetch.mockResolvedValue(resolvedImage(image));
    expect((await (await getProjects()).json()).items[0].imageUrl).toBeNull();
  });

  it("rejects an explicitly configured default HTTPS port", async () => {
    feature([{ title: "Card", url: "https://port.example", image: "https://example.com:443/image.png" }]);
    expect((await (await getProjects()).json()).items[0].imageUrl).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("logs image resolution failures once before caching the miss", async () => {
    const url = "https://og.example/logged-failure";
    feature([{ title: "Card", url }]);
    mocks.fetch.mockRejectedValue(new Error("Fetch failed"));
    for (let index = 0; index < 2; index++) {
      expect((await (await getProjects()).json()).items[0].imageUrl).toBeNull();
    }
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith("[bff/projects] og:image unavailable:", url, "Fetch failed");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("uses explicit description and image without fetching an OG page", async () => {
    feature([{ title: "Card", url: "https://github.com/publisher/project", description: "Config wins", image: "https://images.example/config.png" }]);
    seed([source("project", { description: "Database description" })]);
    expect((await (await getProjects()).json()).items[0]).toMatchObject({ description: "Config wins", imageUrl: "https://images.example/config.png" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("passes only the configured URL to the bounded OG resolver", async () => {
    const url = "https://og.example/bounded";
    feature([{ title: "Card", url }]);
    mocks.fetch.mockResolvedValue(resolvedImage("https://og.example/preview.png"));
    expect((await (await getProjects()).json()).items[0].imageUrl).toBe("https://og.example/preview.png");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(url);
    expect(mocks.fetch.mock.calls[0]).toHaveLength(1);
  });

  it("uses the OG resolver image resolved against the final redirect URL", async () => {
    const url = "https://redirect.example/project";
    feature([{ title: "Card", url }]);
    mocks.fetch.mockResolvedValue(resolvedImage("https://www.redirect.example/preview.png"));
    expect((await (await getProjects()).json()).items[0].imageUrl).toBe("https://www.redirect.example/preview.png");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(url);
  });

  it.each([false, true])("coalesces concurrent cold-cache requests and clears settled lookups (failure: %s)", async (fails) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    const url = `https://og.example/concurrent-${fails}`;
    feature([{ title: "Card", url }]);
    let settle!: () => void;
    mocks.fetch.mockImplementationOnce(() => new Promise((resolve, reject) => {
      settle = () => fails ? reject(new Error("Fetch failed")) : resolve(resolvedImage("https://og.example/preview.png"));
    }));
    const first = getProjects();
    const second = getProjects();
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    settle();
    const responses = await Promise.all([first, second]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect((await response.json()).items[0].imageUrl).toBe(fails ? null : "https://og.example/preview.png");
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + (fails ? 30 : 6 * 60) * 60_000);
    mocks.fetch.mockResolvedValue(resolvedImage("https://og.example/refreshed.png"));
    expect((await (await getProjects()).json()).items[0].imageUrl).toBe("https://og.example/refreshed.png");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a prior image hit on transient refresh failures and retries without caching a miss", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    const url = "https://og.example/transient-refresh";
    const image = "https://og.example/previous.png";
    feature([{ title: "Card", url }]);
    mocks.fetch.mockResolvedValueOnce(resolvedImage(image));
    expect((await (await getProjects()).json()).items[0].imageUrl).toBe(image);
    vi.setSystemTime(Date.now() + 6 * 60 * 60_000);
    mocks.fetch.mockResolvedValue({ kind: "transient" });
    for (let index = 0; index < 2; index++) {
      expect((await (await getProjects()).json()).items[0].imageUrl).toBe(image);
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    mocks.fetch.mockResolvedValue(resolvedImage("https://og.example/recovered.png"));
    expect((await (await getProjects()).json()).items[0].imageUrl).toBe("https://og.example/recovered.png");
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["failed request", null],
    ["non-HTML", { kind: "none" }],
    ["HTTP error", { kind: "transient" }],
    ["unsafe image", { kind: "found", url: "javascript:alert(1)" }],
    ["missing OG", { kind: "none" }],
  ])("keeps a no-image card for %s", async (name, result) => {
    const url = `https://og.example/${encodeURIComponent(String(name))}`;
    feature([{ title: "Card", url }]);
    if (result) mocks.fetch.mockResolvedValue(result);
    const response = await getProjects();
    expect(response.status).toBe(200);
    expect((await response.json()).items[0]).toMatchObject({ name: "Card", imageUrl: null });
  });

  it.each([["hit", 6 * 60, true], ["miss", 30, false]] as const)("caches an image %s by URL until its TTL expires", async (name, minutes, hasImage) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
    const url = `https://og.example/cache-${name}`;
    feature([{ title: "Card", url }]);
    mocks.fetch.mockResolvedValue(hasImage ? resolvedImage("https://og.example/preview.png") : { kind: "none" });
    const expected = hasImage ? "https://og.example/preview.png" : null;
    expect((await (await getProjects()).json()).items[0].imageUrl).toBe(expected);
    vi.setSystemTime(Date.now() + minutes * 60_000 - 1);
    feature([{ title: "Renamed card", url }]);
    expect((await (await getProjects()).json()).items[0]).toMatchObject({ name: "Renamed card", imageUrl: expected });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1);
    await getProjects();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["GET", "HEAD"])("keeps featured %s disabled before the limiter and network", async (method) => {
    feature([{ title: "Card", url: "https://og.example/disabled" }]);
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "0");
    mocks.allow.mockReturnValue(false);
    const response = await (method === "HEAD" ? HEAD : GET)(new NextRequest("https://example.com/api/bff/projects", { method }));
    expect(response.status).toBe(404);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.allow).not.toHaveBeenCalled();
    expect(mocks.sources).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("mirrors successful featured GET headers in an empty HEAD", async () => {
    feature([{ title: "Card", url: "https://og.example/head", image: "https://images.example/preview.png" }]);
    const get = await getProjects();
    const head = await HEAD(new NextRequest("https://example.com/api/bff/projects", { method: "HEAD" }));
    expect(head.status).toBe(get.status);
    expect([...head.headers]).toEqual([...get.headers]);
    expect(await head.text()).toBe("");
  });

  it.each(["GET", "HEAD"])("rate limits featured %s before database and image fetches", async (method) => {
    feature([{ title: "Card", url: "https://github.com/publisher/project" }]);
    mocks.allow.mockReturnValue(false);
    const response = await (method === "HEAD" ? HEAD : GET)(new NextRequest("https://example.com/api/bff/projects", { method }));
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.sources).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["sources", "release"] as const)("returns no-store 503 when featured %s lookup fails", async (failure) => {
    feature([{ title: "Card", url: "https://github.com/publisher/project" }]);
    seed([source("project")]);
    mocks[failure].mockRejectedValue(new Error("Database unavailable"));
    for (const method of ["GET", "HEAD"]) {
      const response = await (method === "HEAD" ? HEAD : GET)(new NextRequest("https://example.com/api/bff/projects", { method }));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      if (method === "HEAD") expect(await response.text()).toBe("");
      else expect(await response.json()).toEqual({ error: "unavailable" });
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
