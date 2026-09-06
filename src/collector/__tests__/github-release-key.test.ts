import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), updateSource: vi.fn() }));
vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    ghItem = { upsert: mocks.upsert };
    ghSource = { update: mocks.updateSource };
  },
}));

import { fetchSourceItems, releaseItemId } from "../github";

const release = {
  id: 123,
  tag_name: "v0.4.0",
  name: "Release 0.4.0",
  body: "Release notes",
  html_url: "https://github.com/publisher/project-a/releases/tag/v0.4.0",
  author: { login: "maintainer" },
  published_at: "2026-09-05T00:00:00Z",
};
const source = { id: 1, name: "Project A", type: "repo", repo: "publisher/project-a" };
const repoMetadata = { description: "Project description", private: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url) => ({
    ok: true,
    json: async () => String(url).includes("/releases?") ? [release] : repoMetadata,
  })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GitHub release keys", () => {
  it("stores sequential releases with the same tag from different repos as distinct rows", async () => {
    const rows = new Map<string, Prisma.GhItemUncheckedCreateInput>();
    mocks.upsert.mockImplementation(async ({ where, create, update }: Prisma.GhItemUpsertArgs) => {
      const id = where.id!;
      const existing = rows.get(id);
      rows.set(id, existing ? { ...existing, ...update } as Prisma.GhItemUncheckedCreateInput : create as Prisma.GhItemUncheckedCreateInput);
      return rows.get(id);
    });
    expect(await fetchSourceItems(source)).toEqual({ upserted: 1 });
    const second = { ...release, name: "Collector release", html_url: "https://github.com/publisher/project-b/releases/tag/v0.4.0" };
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => repoMetadata } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [second] } as Response);
    expect(await fetchSourceItems({ ...source, id: 2, repo: "publisher/project-b" })).toEqual({ upserted: 1 });

    expect(rows.size).toBe(2);
    expect(rows.get("publisher/project-a:v0.4.0")).toMatchObject({ sourceId: 1, url: release.html_url, title: release.name });
    expect(rows.get("publisher/project-b:v0.4.0")).toMatchObject({ sourceId: 2, url: second.html_url, title: second.name });
  });

  it("uses the same release id for mixed-case repo sources without changing the tag", async () => {
    await fetchSourceItems({ ...source, repo: "Owner/Repo" });
    await fetchSourceItems({ ...source, id: 2, repo: "owner/repo" });
    expect(mocks.upsert.mock.calls.map(([args]) => args.where.id)).toEqual([
      "owner/repo:v0.4.0", "owner/repo:v0.4.0",
    ]);
    expect(releaseItemId("Owner/Repo", "V1:RC")).toBe("owner/repo:V1:RC");
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain("/repos/Owner/Repo/");
  });

  it("repairs every contaminated release field on update", async () => {
    await fetchSourceItems(source);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "publisher/project-a:v0.4.0" },
      update: {
        title: release.name,
        body: release.body,
        author: "maintainer",
        url: release.html_url,
        publishedAt: new Date(release.published_at),
        tagName: release.tag_name,
        sourceId: source.id,
        fetchedAt: expect.any(Date),
      },
    }));
  });

  it("clears an obsolete publication date when the refetched release has none", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => repoMetadata } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ ...release, published_at: undefined }] } as Response);
    await fetchSourceItems(source);
    expect(mocks.upsert.mock.calls[0][0].update.publishedAt).toBeNull();
  });

  it.each([null, undefined, ""])("warns and skips a release source with repo %s", async (repo) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await fetchSourceItems({ ...source, repo })).toEqual({ upserted: 0, error: "Invalid source configuration: missing repo" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("missing repo"));
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.updateSource).not.toHaveBeenCalled();
  });

  it("keeps search-result repository keys unchanged", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 4, full_name: "publisher/project-a", html_url: "https://github.com/publisher/project-a" }] }) } as Response);
    await fetchSourceItems({ id: 3, name: "Search", type: "search", query: "project-a" });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "publisher/project-a" },
      create: expect.objectContaining({ id: "publisher/project-a", type: "repo" }),
    }));
  });
});
