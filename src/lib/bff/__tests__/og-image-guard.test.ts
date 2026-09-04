import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetEditionUrlCacheForTests,
  EditionUrlLoadError,
  extractEditionUrls,
  isUrlInEdition,
  loadEditionUrlSet,
  normalizeUrlForMatch,
} from "@/lib/bff/og-image-guard";

afterEach(() => {
  vi.unstubAllEnvs();
  __resetEditionUrlCacheForTests();
  vi.restoreAllMocks();
});

describe("edition URL extraction", () => {
  it("extracts every supported markdown spelling and deduplicates canonical URLs", () => {
    const urls = extractEditionUrls(`
[markdown](https://EXAMPLE.com/story/#part)
<https://example.com/auto/>
[reference]: https://example.com/reference
bare https://example.com/japanese。 and https://example.com/dot.
closing https://example.com/quote」
\`\`\`
https://example.com/in-code
\`\`\`
again https://example.com/story/
`);
    expect([...urls]).toEqual([
      "https://example.com/story",
      "https://example.com/auto",
      "https://example.com/reference",
      "https://example.com/japanese",
      "https://example.com/dot",
      "https://example.com/quote",
      "https://example.com/in-code",
    ]);
  });

  it("normalizes both sides symmetrically", () => {
    expect(normalizeUrlForMatch(' <"https://EXAMPLE.com/a/#one"> ')).toBe(
      "https://example.com/a",
    );
    expect(normalizeUrlForMatch("https://example.com/a/。")).toBe("https://example.com/a");
    expect(normalizeUrlForMatch("ftp://example.com/a")).toBeNull();
    expect(normalizeUrlForMatch("not a URL")).toBeNull();
    expect(isUrlInEdition("https://EXAMPLE.com/a/#two", new Set(["https://example.com/a"]))).toBe(
      true,
    );
  });

  it("keeps balanced parentheses in markdown and bare URLs", () => {
    const markdownUrls = extractEditionUrls(
      "[t](https://en.wikipedia.org/wiki/Transformer_(machine_learning))",
    );
    const bareUrls = extractEditionUrls(
      "see https://en.wikipedia.org/wiki/Transformer_(machine_learning)。",
    );

    expect(markdownUrls).toContain(
      "https://en.wikipedia.org/wiki/Transformer_(machine_learning)",
    );
    expect(bareUrls).toContain(
      "https://en.wikipedia.org/wiki/Transformer_(machine_learning)",
    );
  });

  it("strips only unbalanced trailing closing parentheses", () => {
    const urls = new Set([
      "https://en.wikipedia.org/wiki/Transformer_(machine_learning)",
    ]);

    expect(
      isUrlInEdition(
        "https://en.wikipedia.org/wiki/Transformer_(machine_learning))",
        urls,
      ),
    ).toBe(true);
  });

  it("stops markdown link targets before adjacent Japanese text", () => {
    const urls = extractEditionUrls("[記事](https://example.com/a/b)によると");

    expect(urls).toContain("https://example.com/a/b");
    expect([...urls].some((url) => url.includes("によると"))).toBe(false);
  });

  it("stops bare URLs at a closing parenthesis", () => {
    expect(extractEditionUrls("参照（https://example.com/x）を確認")).toContain(
      "https://example.com/x",
    );
  });

  it("extracts markdown targets followed by punctuation and prose", () => {
    expect(extractEditionUrls("[t](https://example.com/p?q=1)。次の文")).toContain(
      "https://example.com/p?q=1",
    );
  });

  it("accepts the panel-shaped target extracted from an adjacent markdown link", () => {
    const urls = extractEditionUrls("[記事](https://example.com/a/b)によると");

    expect(isUrlInEdition("https://example.com/a/b", urls)).toBe(true);
  });
});

describe("edition URL cache", () => {
  const deps = (fetchImpl: typeof fetch, now?: () => number) => ({
    baseUrl: new URL("https://railway.example"),
    apiKey: "short-value",
    fetchImpl,
    now,
  });

  it("caches upstream 404 for 60 seconds", async () => {
    let nowMs = 1_000;
    const fetchImpl = vi.fn(async () => new Response("missing", { status: 404 }));
    await loadEditionUrlSet("2026-08-01", deps(fetchImpl, () => nowMs));
    await loadEditionUrlSet("2026-08-01", deps(fetchImpl, () => nowMs + 59_000));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    nowMs += 61_000;
    await loadEditionUrlSet("2026-08-01", deps(fetchImpl, () => nowMs));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches a non-published edition as empty", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("https://example.com/draft", {
        status: 200,
        headers: { "x-edition-status": "draft" },
      }),
    );
    expect(await loadEditionUrlSet(null, deps(fetchImpl))).toEqual(new Set());
    expect(await loadEditionUrlSet(null, deps(fetchImpl))).toEqual(new Set());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not cache a published edition that contains no URLs", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("no links", {
        status: 200,
        headers: { "x-edition-status": "published" },
      }),
    );
    await loadEditionUrlSet(null, deps(fetchImpl));
    await loadEditionUrlSet(null, deps(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not cache thrown fetches or upstream 500 responses", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("bad", { status: 500 }))
      .mockResolvedValueOnce(
        new Response("https://example.com/ok", {
          status: 200,
          headers: { "x-edition-status": "published" },
        }),
      );
    await expect(loadEditionUrlSet(null, deps(fetchImpl))).rejects.toMatchObject({ status: 502 });
    await expect(loadEditionUrlSet(null, deps(fetchImpl))).rejects.toMatchObject({ status: 502 });
    expect(await loadEditionUrlSet(null, deps(fetchImpl))).toEqual(new Set(["https://example.com/ok"]));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("maps upstream credential rejection to the specific 500 error", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 403 }));
    await expect(loadEditionUrlSet(null, deps(fetchImpl))).rejects.toEqual(
      new EditionUrlLoadError(
        500,
        "BFF misconfigured: upstream rejected the newsletter API key",
      ),
    );
  });

  it("deduplicates concurrent cache misses", async () => {
    let release: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      () => new Promise<Response>((resolve) => { release = resolve; }),
    );
    const first = loadEditionUrlSet(null, deps(fetchImpl));
    const second = loadEditionUrlSet(null, deps(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release?.(
      new Response("https://example.com/one", {
        headers: { "x-edition-status": "published" },
      }),
    );
    await expect(Promise.all([first, second])).resolves.toEqual([
      new Set(["https://example.com/one"]),
      new Set(["https://example.com/one"]),
    ]);
  });
});
