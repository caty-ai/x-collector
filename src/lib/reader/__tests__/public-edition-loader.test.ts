import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPublicEditionLoader, UpstreamBusyError, UpstreamTransientError } from "../public-edition-loader";
import { parseNewsletterMarkdown } from "../newsletter-markdown";
import { createSemaphore } from "@/lib/bff/semaphore";
import { buildNewsletterLatestPublicUpstreamUrl } from "@/lib/bff/upstream";

const base = new URL("https://example.com");
const date = "2026-09-04";
const markdown = "# News\n## Section\n### Title\nSummary\n引用元: https://example.org/article";
const published = () => new Response(JSON.stringify({ edition: { status: "published", contentMd: markdown } }));
function setup(fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => published())) {
  let time = Date.parse("2026-09-05T00:00:00Z");
  const parseMarkdown = vi.fn(parseNewsletterMarkdown);
  const semaphore = createSemaphore(4, 32);
  const load = createPublicEditionLoader({ fetchImpl, now: () => time, resolveBaseUrl: () => base, resolveApiKey: () => "test-key", parseMarkdown, semaphore });
  return { load, fetchImpl, parseMarkdown, semaphore, advance: (ms: number) => { time += ms; } };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("public edition loader", () => {
  it.each(["2019-12-31", "2026-02-30", "2026-09-07", "garbage"])("rejects unacceptable date %s before fetching", async (input) => {
    const s = setup();
    expect(await s.load(input)).toBeNull();
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
  it("pins the public upstream URL, headers and published-only loaded shape", async () => {
    const s = setup();
    const result = await s.load(date);
    expect(s.fetchImpl.mock.calls[0][0]).toEqual(buildNewsletterLatestPublicUpstreamUrl(base, { date, format: "json", includeContent: "1", includeItems: "0" }));
    expect(s.fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store", headers: { Authorization: "Bearer test-key", Accept: "application/json" }, signal: expect.any(AbortSignal) });
    expect(result).toMatchObject({ date, articleCount: 1 });
    expect(result).not.toHaveProperty("status");
    expect(result?.index.byId.size).toBe(1);
    expect(await s.load(date)).toBe(result);
    expect(s.parseMarkdown).toHaveBeenCalledTimes(1);
  });
  it("negative-caches 404 for 60 seconds", async () => {
    const s = setup(vi.fn<typeof fetch>().mockImplementation(async () => new Response("missing", { status: 404 })));
    expect(await s.load(date)).toBeNull();
    s.advance(59_999);
    expect(await s.load(date)).toBeNull();
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    s.advance(1);
    await s.load(date);
    expect(s.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([
    JSON.stringify({ edition: { status: "draft", contentMd: markdown } }),
    JSON.stringify({ edition: { contentMd: markdown } }),
    JSON.stringify({ edition: { status: "unknown", contentMd: markdown } }),
    JSON.stringify({ contentMd: markdown }),
    `{"edition":{"contentMd":${JSON.stringify(markdown)},`,
    "null",
  ])("never parses unpublished or malformed payload %s", async (payload) => {
    const s = setup(vi.fn<typeof fetch>().mockImplementation(async () => new Response(payload)));
    expect(await s.load(date)).toBeNull();
    expect(await s.load(date)).toBeNull();
    expect(s.parseMarkdown).not.toHaveBeenCalled();
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 500, 503])("caches upstream %s as a rethrown error for 10 seconds", async (status) => {
    const s = setup(vi.fn<typeof fetch>().mockImplementation(async () => new Response("error", { status })));
    await expect(s.load(date)).rejects.toBeInstanceOf(UpstreamTransientError);
    s.advance(9_999);
    await expect(s.load(date)).rejects.toBeInstanceOf(UpstreamTransientError);
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    s.advance(1);
    await expect(s.load(date)).rejects.toBeInstanceOf(UpstreamTransientError);
    expect(s.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["a network failure", new TypeError("network")],
    ["an upstream fetch timeout", new DOMException("timeout", "TimeoutError")],
  ])("caches %s for 10 s (transient upstream failure)", async (_label, error) => {
    const s = setup(vi.fn<typeof fetch>().mockRejectedValue(error));
    await expect(s.load(date)).rejects.toBeInstanceOf(UpstreamTransientError);
    await expect(s.load(date)).rejects.toBeInstanceOf(UpstreamTransientError);
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    expect(s.semaphore.active()).toBe(0);
  });
  it("recovers error to success and uses positive TTL without stale error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("error", { status: 500 })).mockImplementation(async () => published());
    const s = setup(fetchImpl);
    await expect(s.load(date)).rejects.toBeInstanceOf(UpstreamTransientError);
    s.advance(10_000);
    const result = await s.load(date);
    s.advance(10_000);
    expect(await s.load(date)).toBe(result);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("joins 100 same-date misses before admission", async () => {
    let finish!: (r: Response) => void;
    const s = setup(vi.fn<typeof fetch>().mockImplementation(() => new Promise((r) => { finish = r; })));
    const tasks = Array.from({ length: 100 }, () => s.load(date));
    await Promise.resolve();
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    expect([s.semaphore.active(), s.semaphore.pending()]).toEqual([1, 0]);
    finish(published());
    const results = await Promise.all(tasks);
    expect(results.every((value) => value === results[0])).toBe(true);
  });
  it("caps distinct misses at 4, queues 32, refuses excess and expires waiters at 3 seconds without caching busy", async () => {
    vi.useFakeTimers();
    // Native AbortSignal.timeout uses runtime timers; bridge it to the fake clock.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException("timeout", "TimeoutError")), ms);
      return c.signal;
    });
    const finish: Array<(response: Response) => void> = [];
    const s = setup(vi.fn<typeof fetch>().mockImplementation(() => new Promise((r) => { finish.push(r); })));
    const dates = Array.from({ length: 100 }, (_, i) => new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10));
    const results = dates.map((d) => s.load(d).catch((e: unknown) => e));
    await vi.advanceTimersByTimeAsync(0);
    expect([s.semaphore.active(), s.semaphore.pending()]).toEqual([4, 32]);
    expect(s.fetchImpl).toHaveBeenCalledTimes(4);
    expect(await results[99]).toBeInstanceOf(UpstreamBusyError);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(s.semaphore.pending()).toBe(0);
    expect(await results[4]).toBeInstanceOf(UpstreamBusyError);
    finish.forEach((r) => r(published()));
    const all = await Promise.all(results);
    expect(all.filter((r) => r instanceof UpstreamBusyError)).toHaveLength(96);
    const retry = s.load(dates[4]);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.fetchImpl).toHaveBeenCalledTimes(5);
    finish[4](published());
    expect(await retry).toMatchObject({ articleCount: 1 });
  });
  it("limits positive cache to 16 using FIFO, not hit recency", async () => {
    const s = setup();
    const dates = Array.from({ length: 17 }, (_, i) => `2025-01-${String(i + 1).padStart(2, "0")}`);
    for (const d of dates.slice(0, 16)) await s.load(d);
    await s.load(dates[0]);
    await s.load(dates[16]);
    await s.load(dates[1]);
    expect(s.fetchImpl).toHaveBeenCalledTimes(17);
    await s.load(dates[0]);
    expect(s.fetchImpl).toHaveBeenCalledTimes(18);
    s.advance(60_000);
    await s.load(dates[0]);
    expect(s.fetchImpl).toHaveBeenCalledTimes(19);
  });
  it.each(["base", "key"])("does not cache missing %s configuration", async (missing) => {
    let configured = false;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => published());
    const load = createPublicEditionLoader({ fetchImpl, now: () => Date.parse("2026-09-05"), resolveBaseUrl: () => missing === "base" && !configured ? null : base, resolveApiKey: () => missing === "key" && !configured ? null : "key" });
    await expect(load(date)).rejects.toThrow("misconfigured");
    configured = true;
    expect(await load(date)).toMatchObject({ articleCount: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
