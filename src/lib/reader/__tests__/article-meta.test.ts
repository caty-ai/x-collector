import { describe, expect, it, vi } from "vitest";
import { buildArticleMetadata } from "../article-meta";

const input = { siteUrl: "https://example.com", masthead: "Sample Daily", date: "2026-09-04", id: "abcdef012345", title: "見出し", summary: "**要約**", sourceUrl: "https://example.org/story", resolveOgImage: vi.fn(async () => null as string | null) };

describe("article metadata", () => {
  it("emits an article card with a clean origin-based canonical", async () => {
    const metadata = await buildArticleMetadata({ ...input, siteUrl: "https://example.com/path?utm_source=x" });
    expect(metadata).toMatchObject({ title: "見出し | Sample Daily", description: "要約", alternates: { canonical: "https://example.com/a/2026-09-04/abcdef012345" }, openGraph: { type: "article", url: "https://example.com/a/2026-09-04/abcdef012345", locale: "ja_JP", siteName: "Sample Daily", publishedTime: input.date }, twitter: { card: "summary_large_image" } });
    expect(metadata).toEqual(await buildArticleMetadata(input));
  });
  it.each(["null", "throw"])("falls back to the default image on resolver %s", async (kind) => {
    const metadata = await buildArticleMetadata({ ...input, resolveOgImage: async () => { if (kind === "throw") throw Error("temporary"); return null; } });
    expect(metadata.openGraph).toHaveProperty("images", ["https://example.com/og-default.png"]);
    expect(metadata.twitter).toHaveProperty("images", ["https://example.com/og-default.png"]);
  });
  it("uses the source image with the 1500 ms budget", async () => {
    const resolveOgImage = vi.fn(async () => "https://example.org/image.png");
    const metadata = await buildArticleMetadata({ ...input, resolveOgImage });
    expect(resolveOgImage).toHaveBeenCalledWith(input.sourceUrl, { budgetMs: 1500 });
    expect(metadata.openGraph).toHaveProperty("images", ["https://example.org/image.png"]);
  });
  it("omits all absolute URL fields and images without an origin, warning once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolveOgImage = vi.fn(async () => null);
    const metadata = await buildArticleMetadata({ ...input, siteUrl: null, resolveOgImage });
    await buildArticleMetadata({ ...input, siteUrl: null, resolveOgImage });
    expect(metadata.metadataBase).toBeUndefined();
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).not.toHaveProperty("url");
    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata.twitter).not.toHaveProperty("images");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(JSON.stringify(metadata)).not.toContain("localhost");
    expect(resolveOgImage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it("truncates descriptions by code point and never fetches unsafe sources", async () => {
    const resolveOgImage = vi.fn(async () => null);
    const metadata = await buildArticleMetadata({ ...input, summary: "😀".repeat(170), sourceUrl: "javascript:alert(1)", resolveOgImage });
    expect(metadata.description).toBe("😀".repeat(160));
    expect(resolveOgImage).not.toHaveBeenCalled();
  });
});
