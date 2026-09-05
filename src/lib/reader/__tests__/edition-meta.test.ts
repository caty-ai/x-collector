import { afterEach, describe, expect, it, vi } from "vitest";

import { buildEditionMetadata, resolveSiteUrl } from "@/lib/reader/edition-meta";

afterEach(() => vi.unstubAllEnvs());

describe("edition metadata", () => {
  it("emits metadataBase and an absolute og:url when a site origin exists", () => {
    const metadata = buildEditionMetadata({
      masthead: "夕刊AI",
      tagline: "今日のAI",
      date: "2026-08-02",
      siteUrl: "https://paper.example",
    });
    expect(metadata.metadataBase?.toString()).toBe("https://paper.example/");
    expect(metadata.openGraph).toMatchObject({
      title: "夕刊AI 2026-08-02",
      images: ["https://paper.example/og-default.png"],
      url: "https://paper.example/calendar?date=2026-08-02",
    });
  });

  it("omits metadataBase and og:url rather than emitting a relative URL", () => {
    const metadata = buildEditionMetadata({
      masthead: "夕刊AI",
      tagline: "今日のAI",
      date: "2026-08-02",
      siteUrl: null,
    });
    expect(metadata.metadataBase).toBeUndefined();
    expect(metadata.openGraph).not.toHaveProperty("url");
    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata.twitter).not.toHaveProperty("images");
  });

  it("uses the site URL first and returns only its origin", () => {
    expect(
      resolveSiteUrl({
        NEWSPAPER_SITE_URL: "https://paper.example/nested?q=1",
        NEXTAUTH_URL: "https://auth.example/callback",
      }),
    ).toBe("https://paper.example");
  });

  it("falls back and rejects credential-bearing or non-http URLs", () => {
    expect(
      resolveSiteUrl({
        NEWSPAPER_SITE_URL: "https://user:pass@paper.example",
        NEXTAUTH_URL: "https://auth.example/path",
      }),
    ).toBe("https://auth.example");
    expect(resolveSiteUrl({ NEWSPAPER_SITE_URL: "https://user:pass@paper.example" })).toBeNull();
    expect(resolveSiteUrl({ NEWSPAPER_SITE_URL: "file:///tmp/paper" })).toBeNull();
  });
});
