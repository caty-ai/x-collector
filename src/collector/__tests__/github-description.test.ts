import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), updateSource: vi.fn() }));
vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    ghItem = { upsert: mocks.upsert };
    ghSource = { update: mocks.updateSource };
  },
}));

import { fetchSourceItems } from "../github";

const source = { id: 1, name: "Project", type: "repo", repo: "publisher/project" };
const release = {
  id: 42,
  tag_name: "v1.0.0",
  html_url: "https://github.com/publisher/project/releases/tag/v1.0.0",
};
const metadataUrl = "https://api.github.com/repos/publisher/project";

function response(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GITHUB_TOKEN", "test-token");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([release])));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GitHub source descriptions", () => {
  describe.each(["releases", "metadata"])("%s rate limits", (request) => {
    it.each([
      ["exhausted quota header", "Access denied", "0"],
      ["primary rate limit message", "API rate limit exceeded", "1"],
      ["secondary rate limit message", "You have exceeded a secondary rate limit", undefined],
      ["case-insensitive message", "RATE LIMIT exceeded", undefined],
    ])("preserves visibility for a 403 with %s", async (_label, message, remaining) => {
      const headers: HeadersInit = remaining === undefined ? {} : { "x-ratelimit-remaining": remaining };
      const limited = new Response(JSON.stringify({ message }), { status: 403, headers });
      if (request === "releases") {
        vi.mocked(fetch).mockReset()
          .mockRejectedValueOnce(new Error("Metadata unavailable"))
          .mockResolvedValueOnce(limited);
      } else {
        vi.mocked(fetch).mockResolvedValueOnce(limited);
      }

      expect(await fetchSourceItems(source)).toEqual(request === "releases"
        ? { upserted: 0, error: "Rate limited. Set GITHUB_TOKEN for higher limits." }
        : { upserted: 1 });
      if (request === "releases") {
        expect(mocks.updateSource).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch).toHaveBeenNthCalledWith(1, metadataUrl, expect.any(Object));
        expect(mocks.upsert).not.toHaveBeenCalled();
      } else {
        expect(mocks.updateSource).toHaveBeenCalledTimes(1);
        expect(mocks.updateSource).toHaveBeenCalledWith({
          where: { id: source.id },
          data: { lastFetchedAt: expect.any(Date) },
        });
        expect(mocks.upsert).toHaveBeenCalledOnce();
      }
    });
  });

  it.each([
    [401, "HTTP 401"],
    [403, "HTTP 403"],
    [404, "Repository not found."],
  ])("clears stale public visibility on releases HTTP %s after attempting metadata", async (status, error) => {
    vi.mocked(fetch).mockReset()
      .mockRejectedValueOnce(new Error("Metadata unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Access denied" }), { status }));

    expect(await fetchSourceItems(source)).toEqual({ upserted: 0, error });
    expect(mocks.updateSource).toHaveBeenCalledTimes(1);
    expect(mocks.updateSource).toHaveBeenCalledWith({
      where: { id: source.id },
      data: { isPrivate: null },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, metadataUrl, expect.any(Object));
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain("/releases?");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each(["A publisher project", "", null, undefined])(
    "stores repository description %s with the release request's headers and a timeout",
    async (description) => {
      vi.mocked(fetch).mockResolvedValueOnce(response({ description, private: false }));

      expect(await fetchSourceItems(source)).toEqual({ upserted: 1 });

      expect(fetch).toHaveBeenCalledTimes(2);
      const releaseOptions = vi.mocked(fetch).mock.calls[1][1];
      expect(fetch).toHaveBeenNthCalledWith(1, metadataUrl, {
        headers: releaseOptions?.headers,
        signal: expect.any(AbortSignal),
      });
      expect(releaseOptions?.headers).toMatchObject({
        Authorization: "Bearer test-token",
        Accept: "application/vnd.github+json",
        "User-Agent": expect.any(String),
      });
      expect(mocks.updateSource).toHaveBeenCalledWith({
        where: { id: source.id },
        data: { description: description ?? null, isPrivate: false },
      });
      expect(mocks.upsert).toHaveBeenCalledOnce();
      expect(mocks.updateSource.mock.invocationCallOrder[0]).toBeLessThan(mocks.upsert.mock.invocationCallOrder[0]);
      expect(mocks.updateSource.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fetch).mock.invocationCallOrder[1]);
      expect(console.warn).not.toHaveBeenCalled();
    },
  );

  it.each([false, true, undefined, null])("persists repository privacy %s even with the shelf disabled", async (isPrivate) => {
    vi.stubEnv("NEWSPAPER_PROJECTS_SHELF", "0");
    vi.mocked(fetch).mockResolvedValueOnce(response({ description: "Project", private: isPrivate }));
    expect(await fetchSourceItems(source)).toEqual({ upserted: 1 });
    expect(mocks.updateSource).toHaveBeenCalledWith({
      where: { id: source.id },
      data: { description: "Project", isPrivate: isPrivate ?? null },
    });
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(mocks.updateSource.mock.invocationCallOrder[0]).toBeLessThan(mocks.upsert.mock.invocationCallOrder[0]);
    expect(mocks.updateSource.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fetch).mock.invocationCallOrder[1]);
  });

  it("persists a token-readable private repository before fetching and upserting releases", async () => {
    const stored = { description: "Old project", isPrivate: false };
    mocks.updateSource.mockImplementation(async ({ data }) => {
      await Promise.resolve();
      Object.assign(stored, data);
    });
    vi.mocked(fetch).mockReset()
      .mockResolvedValueOnce(response({ description: "Private project", private: true }))
      .mockImplementationOnce(async (_url, options) => {
        expect(options?.headers).toMatchObject({ Authorization: "Bearer test-token" });
        expect(stored).toMatchObject({ description: "Private project", isPrivate: true });
        return response([release]);
      });
    mocks.upsert.mockImplementation(async () => {
      expect(stored).toMatchObject({ description: "Private project", isPrivate: true });
    });

    expect(await fetchSourceItems(source)).toEqual({ upserted: 1 });
    expect(mocks.updateSource).toHaveBeenNthCalledWith(1, {
      where: { id: source.id },
      data: { description: "Private project", isPrivate: true },
    });
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(mocks.updateSource.mock.invocationCallOrder[0]).toBeLessThan(mocks.upsert.mock.invocationCallOrder[0]);
  });

  it("preserves stored description and visibility through a transient metadata failure while ingesting releases", async () => {
    const stored = { description: "Existing project", isPrivate: false };
    mocks.updateSource.mockImplementation(async ({ data }) => Object.assign(stored, data));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    mocks.upsert.mockImplementation(async () => {
      expect(stored).toEqual({ description: "Existing project", isPrivate: false });
    });

    expect(await fetchSourceItems(source)).toEqual({ upserted: 1 });
    expect(fetch).toHaveBeenNthCalledWith(1, metadataUrl, expect.any(Object));
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(mocks.updateSource).toHaveBeenCalledOnce();
    expect(stored).toMatchObject({ description: "Existing project", isPrivate: false });
  });

  it.each([401, 403, 404])("clears stale public visibility on metadata HTTP %s without changing the description", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: "Access denied" }), { status }));

    expect(await fetchSourceItems(source)).toEqual({ upserted: 1 });
    expect(mocks.updateSource).toHaveBeenCalledTimes(2);
    expect(mocks.updateSource).toHaveBeenNthCalledWith(1, {
      where: { id: source.id },
      data: { isPrivate: null },
    });
    expect(mocks.updateSource).toHaveBeenLastCalledWith({
      where: { id: source.id },
      data: { lastFetchedAt: expect.any(Date) },
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not refresh description for publisher/project"),
      expect.objectContaining({ message: `HTTP ${status}` }),
    );
  });

  it.each(["network", 429, 500, 502, 503, "json", "database"])(
    "warns on a metadata %s failure and still upserts releases",
    async (failure) => {
      if (failure === "network") {
        vi.mocked(fetch).mockRejectedValueOnce(new Error("Network unavailable"));
      } else if (typeof failure === "number") {
        vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: failure } as Response);
      } else if (failure === "json") {
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: true,
          json: async () => { throw new Error("Invalid JSON"); },
        } as unknown as Response);
      } else {
        vi.mocked(fetch).mockResolvedValueOnce(response({ description: "Project" }));
        mocks.updateSource.mockRejectedValueOnce(new Error("Write failed"));
      }

      expect(await fetchSourceItems(source)).toEqual({ upserted: 1 });
      expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "publisher/project:v1.0.0" },
      }));
      expect(mocks.updateSource).toHaveBeenLastCalledWith({
        where: { id: source.id },
        data: { lastFetchedAt: expect.any(Date) },
      });
      if (failure !== "database") {
        expect(mocks.updateSource).toHaveBeenCalledOnce();
      }
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("Could not refresh description for publisher/project"),
        expect.any(Error),
      );
    },
  );

  it.each(["request", "body"])("preserves metadata and ingests releases after a metadata %s hits its independent 5 second timeout", async (phase) => {
    vi.useFakeTimers();
    let metadataSignal: AbortSignal | undefined;
    vi.mocked(fetch).mockReset()
      .mockImplementationOnce((_url, options) => {
        expect(mocks.upsert).not.toHaveBeenCalled();
        metadataSignal = options?.signal as AbortSignal;
        const pending = new Promise<Response>((_resolve, reject) => {
          metadataSignal!.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          }, { once: true });
        });
        return phase === "request"
          ? pending
          : Promise.resolve({ ok: true, json: () => pending } as Response);
      })
      .mockResolvedValueOnce(response([release, { ...release, id: 43, tag_name: "v2.0.0" }]));
    let completed = false;
    const result = fetchSourceItems(source).then((value) => {
      completed = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenLastCalledWith(metadataUrl, expect.any(Object));
    expect(metadataSignal).toBeInstanceOf(AbortSignal);
    expect(mocks.updateSource).not.toHaveBeenCalled();
    expect(metadataSignal?.aborted).toBe(false);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(metadataSignal?.aborted).toBe(true);
    const releaseSignal = vi.mocked(fetch).mock.calls[1][1]?.signal;
    expect(releaseSignal).toBeInstanceOf(AbortSignal);
    expect(metadataSignal).not.toBe(releaseSignal);
    expect(releaseSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(await result).toEqual({ upserted: 2 });
    expect(mocks.updateSource).toHaveBeenCalledTimes(1);
    expect(mocks.updateSource).toHaveBeenCalledWith({
      where: { id: source.id },
      data: { lastFetchedAt: expect.any(Date) },
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not refresh description for publisher/project"),
      expect.objectContaining({ name: "AbortError" }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes the description even when the source has no releases", async () => {
    vi.mocked(fetch).mockReset()
      .mockResolvedValueOnce(response({ description: "New project" }))
      .mockResolvedValueOnce(response([]));

    expect(await fetchSourceItems(source)).toEqual({ upserted: 0 });
    expect(mocks.updateSource).toHaveBeenCalledWith({
      where: { id: source.id },
      data: { description: "New project", isPrivate: null },
    });
  });

  it("does not fetch repository metadata or update source descriptions for search sources", async () => {
    vi.mocked(fetch).mockReset().mockResolvedValueOnce(response({ items: [{
      id: 1,
      full_name: "publisher/project",
      html_url: "https://github.com/publisher/project",
      description: "Search result description",
    }] }));

    expect(await fetchSourceItems({ id: 2, name: "Search", type: "search", query: "project" }))
      .toEqual({ upserted: 1 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("/search/repositories?");
    expect(mocks.updateSource).toHaveBeenCalledOnce();
    expect(mocks.updateSource).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { lastFetchedAt: expect.any(Date) },
    });
  });
});
