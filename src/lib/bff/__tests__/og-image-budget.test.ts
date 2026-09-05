import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOgImageResolver, fetchOgImage, type OgImageResult } from "../og-image";
import { safeFetchText } from "../../net/safe-fetch";
vi.mock("../../net/safe-fetch", async (original) => ({
  ...await original<typeof import("../../net/safe-fetch")>(), safeFetchText: vi.fn(),
}));
const found: OgImageResult = { kind: "found", url: "https://example.com/image.png" };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() {
  let resolve!: (result: OgImageResult) => void;
  const promise = new Promise<OgImageResult>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), ms);
    return controller.signal;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("article OG admission and budgets", () => {
  it("returns null at budget and holds its permit until fetch settles", async () => {
    const requests = Array.from({ length: 5 }, deferred);
    const fetch = vi.fn().mockImplementation(() => requests[fetch.mock.calls.length - 1].promise);
    const resolver = createOgImageResolver({ fetchOgImage: fetch });
    const active = Array.from({ length: 4 }, (_, i) => resolver.resolveArticleOgImage(`https://example.com/${i}`));
    await flush();
    const waiting = resolver.resolveArticleOgImage("https://example.com/waiting", { budgetMs: 5000 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(await Promise.all(active)).toEqual([null, null, null, null]);
    expect(fetch).toHaveBeenCalledTimes(4);
    requests[0].resolve(found);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(5);
    requests.forEach((request) => request.resolve(found));
    expect(await waiting).toBe(found.url);
  });
  it("caps concurrency at four and rejects the seventeenth waiter immediately", async () => {
    const gate = deferred();
    const fetch = vi.fn(() => gate.promise);
    const resolver = createOgImageResolver({ fetchOgImage: fetch });
    const pending = Array.from({ length: 20 }, (_, i) => resolver.resolveArticleOgImage(`https://example.com/${i}`));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(await resolver.resolveArticleOgImage("https://example.com/refused")).toBeNull();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await Promise.all(pending)).toEqual(Array(20).fill(null));
    gate.resolve(found);
    await flush();
    expect(await resolver.resolveArticleOgImage("https://example.com/refused")).toBe(found.url);
  });
  it("deduplicates in-flight URLs and preserves each caller's budget", async () => {
    const gate = deferred();
    const fetch = vi.fn(() => gate.promise);
    const resolver = createOgImageResolver({ fetchOgImage: fetch });
    const first = resolver.resolveArticleOgImage("https://example.com/a", { budgetMs: 50 });
    const second = resolver.resolveArticleOgImage("https://example.com/a", { budgetMs: 500 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await first).toBeNull();
    expect(fetch.mock.calls).toHaveLength(1);
    gate.resolve(found);
    expect(await second).toBe(found.url);
  });
  it("does not join a cancelled queued flight in the same tick", async () => {
    const gate = deferred();
    const fetch = vi.fn(() => gate.promise);
    const resolver = createOgImageResolver({ fetchOgImage: fetch });
    const active = Array.from({ length: 4 }, (_, i) => resolver.resolveArticleOgImage(`https://example.com/${i}`));
    await flush();
    const controller = new AbortController();
    const cancelled = resolver.resolveArticleOgImage("https://example.com/queued", { signal: controller.signal });
    controller.abort();
    const retry = resolver.resolveArticleOgImage("https://example.com/queued");
    gate.resolve(found);
    expect(await cancelled).toBeNull();
    expect(await retry).toBe(found.url);
    await Promise.all(active);
    expect(fetch).toHaveBeenCalledTimes(5);
  });
  it("keeps a started flight joinable after its last caller aborts", async () => {
    const gate = deferred();
    const fetch = vi.fn(() => gate.promise);
    const resolver = createOgImageResolver({ fetchOgImage: fetch });
    const controller = new AbortController();
    const first = resolver.resolveOgImage("https://example.com/a", { signal: controller.signal });
    controller.abort();
    expect(await first).toBeNull();
    const retry = resolver.resolveOgImage("https://example.com/a");
    gate.resolve(found);
    expect(await retry).toBe(found.url);
    expect(await resolver.resolveOgImage("https://example.com/a")).toBe(found.url);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("caches the real found result after the sole caller's budget expires mid-fetch", async () => {
    const gate = deferred();
    const fetch = vi.fn((_url: string, options: { signal?: AbortSignal }) => {
      options.signal?.addEventListener("abort", () => gate.resolve({ kind: "transient" }), { once: true });
      return gate.promise;
    });
    const resolver = createOgImageResolver({ fetchOgImage: fetch });
    const first = resolver.resolveArticleOgImage("https://example.com/slow", { budgetMs: 50 });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(await first).toBeNull();
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    gate.resolve(found);
    await flush();
    expect(await resolver.resolveArticleOgImage("https://example.com/slow")).toBe(found.url);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["bff", "article"] as const)("keeps a %s flight separate from the other mode for the same URL", async (firstMode) => {
    const gate = deferred();
    const fetch = vi.fn(() => gate.promise);
    const resolver = createOgImageResolver({ fetchOgImage: fetch });
    const resolveFirst = firstMode === "bff" ? resolver.resolveOgImage : resolver.resolveArticleOgImage;
    const resolveSecond = firstMode === "bff" ? resolver.resolveArticleOgImage : resolver.resolveOgImage;
    const first = resolveFirst("https://example.com/shared");
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    const second = resolveSecond("https://example.com/shared");
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    gate.resolve(found);
    expect(await Promise.all([first, second])).toEqual([found.url, found.url]);
    expect(await resolver.resolveOgImage("https://example.com/shared")).toBe(found.url);
    expect(await resolver.resolveArticleOgImage("https://example.com/shared")).toBe(found.url);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("honours external abort without cancelling another caller", async () => {
    const gate = deferred();
    const fetch = vi.fn(() => gate.promise);
    const resolver = createOgImageResolver({ fetchOgImage: fetch });
    const controller = new AbortController();
    const first = resolver.resolveOgImage("https://example.com/a", { signal: controller.signal });
    const second = resolver.resolveOgImage("https://example.com/a");
    controller.abort();
    expect(await first).toBeNull();
    gate.resolve(found);
    expect(await second).toBe(found.url);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
describe("OG cache", () => {
  it.each(["none", "found"] as const)("caches %s for 24 hours", async (kind) => {
    const fetch = vi.fn(async (): Promise<OgImageResult> => kind === "found" ? found : { kind });
    const resolver = createOgImageResolver({ fetchOgImage: fetch });
    await resolver.resolveOgImage("https://example.com/a");
    await vi.advanceTimersByTimeAsync(86_399_999);
    await resolver.resolveOgImage("https://example.com/a");
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await resolver.resolveOgImage("https://example.com/a");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("caches a real upstream transient for 60 seconds", async () => {
    const fetch = vi.fn(async (): Promise<OgImageResult> => ({ kind: "transient" }));
    const resolver = createOgImageResolver({ fetchOgImage: fetch });
    expect(await resolver.resolveArticleOgImage("https://example.com/a")).toBeNull();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(await resolver.resolveArticleOgImage("https://example.com/a")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await resolver.resolveOgImage("https://example.com/a");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
describe("fetch outcome classification", () => {
  it.each([408, 429, 500, 503])("classifies %i as transient", async (status) => {
    vi.mocked(safeFetchText).mockResolvedValue({ status, url: "https://example.com/", headers: {}, body: "" });
    expect(await fetchOgImage("https://example.com/")).toEqual({ kind: "transient" });
  });
  it.each([400, 403, 404])("classifies %i as permanent", async (status) => {
    vi.mocked(safeFetchText).mockResolvedValue({ status, url: "https://example.com/", headers: {}, body: "" });
    expect(await fetchOgImage("https://example.com/")).toEqual({ kind: "none" });
  });
  it("extracts a safe relative image and passes the signal through", async () => {
    vi.mocked(safeFetchText).mockResolvedValue({ status: 200, url: "https://example.com/", headers: { "content-type": "text/html" }, body: '<meta property="og:image" content="/image.png">' });
    const signal = new AbortController().signal;
    expect(await fetchOgImage("https://example.com/", { signal })).toEqual(found);
    expect(safeFetchText).toHaveBeenLastCalledWith("https://example.com/", expect.objectContaining({ signal }));
  });
  it.each([
    { headers: { "content-type": "application/json" }, body: '<meta property="og:image" content="/image.png">' },
    { headers: { "content-type": "text/html" }, body: "<html></html>" },
    { headers: { "content-type": "text/html" }, body: '<meta property="og:image" content="javascript:alert(1)">' },
  ])("classifies absent or unusable images as permanent", async ({ headers, body }) => {
    vi.mocked(safeFetchText).mockResolvedValue({ status: 200, url: "https://example.com/", headers, body });
    expect(await fetchOgImage("https://example.com/")).toEqual({ kind: "none" });
  });
  it("classifies network failures as transient", async () => {
    vi.mocked(safeFetchText).mockRejectedValue(new Error("network"));
    expect(await fetchOgImage("https://example.com/")).toEqual({ kind: "transient" });
  });
});
