import { afterEach, describe, expect, it, vi } from "vitest";

import { getPoweredBy, getSourceRepoLink, getTagline, getXFollowHandle } from "@/lib/masthead";

afterEach(() => vi.unstubAllEnvs());

describe("reader masthead details", () => {
  it("uses the neutral tagline default", () => {
    vi.stubEnv("NEWSPAPER_TAGLINE", "");
    expect(getTagline()).toBe("AIの最新ニュースを、毎日ひとつの紙面に。");
  });

  it("trims a configured tagline", () => {
    vi.stubEnv("NEWSPAPER_TAGLINE", "  読者のためのAIニュース  ");
    expect(getTagline()).toBe("読者のためのAIニュース");
  });

  it("renders credit only with both a label and an http(s) URL", () => {
    vi.stubEnv("NEWSPAPER_POWERED_BY_LABEL", "Caty");
    vi.stubEnv("NEWSPAPER_POWERED_BY_URL", "https://caty.example/about");
    expect(getPoweredBy()).toEqual({ label: "Caty", url: "https://caty.example/about" });

    vi.stubEnv("NEWSPAPER_POWERED_BY_URL", "javascript:alert(1)");
    expect(getPoweredBy()).toBeNull();
    vi.stubEnv("NEWSPAPER_POWERED_BY_URL", "");
    expect(getPoweredBy()).toBeNull();
  });
});

describe("source repo link", () => {
  it("uses the public repository by default", () => {
    vi.stubEnv("NEWSPAPER_SOURCE_REPO_URL", "");
    expect(getSourceRepoLink()).toEqual({
      label: "GitHub",
      url: "https://github.com/caty-ai/x-collector",
    });
  });

  it("uses a configured HTTPS repository URL", () => {
    vi.stubEnv("NEWSPAPER_SOURCE_REPO_URL", "https://example.com/org/repo");
    expect(getSourceRepoLink()).toEqual({
      label: "GitHub",
      url: "https://example.com/org/repo",
    });
  });

  it.each(["off", " OFF ", "Off"])("hides the link for %j", (value) => {
    vi.stubEnv("NEWSPAPER_SOURCE_REPO_URL", value);
    expect(getSourceRepoLink()).toBeNull();
  });

  it.each(["javascript:alert(1)", "not a URL", "ftp://example.com"])(
    "uses the default for invalid URL %j",
    (value) => {
      vi.stubEnv("NEWSPAPER_SOURCE_REPO_URL", value);
      expect(getSourceRepoLink()).toEqual({
        label: "GitHub",
        url: "https://github.com/caty-ai/x-collector",
      });
    },
  );
});

describe("X follow handle", () => {
  it("hides the follow button when unset", () => {
    vi.stubEnv("NEWSPAPER_X_FOLLOW_HANDLE", undefined);
    expect(getXFollowHandle()).toBeNull();
  });
  it.each(["example", "@example", "  @example  "])("normalizes %j", (value) => {
    vi.stubEnv("NEWSPAPER_X_FOLLOW_HANDLE", value);
    expect(getXFollowHandle()).toBe("example");
  });
  it.each(["", "  ", "a b", "abcdefghijklmnop", "-", "@@example"])("hides invalid handle %j", (value) => {
    vi.stubEnv("NEWSPAPER_X_FOLLOW_HANDLE", value);
    expect(getXFollowHandle()).toBeNull();
  });
  it("accepts a 15-character handle with digits and underscores", () => {
    vi.stubEnv("NEWSPAPER_X_FOLLOW_HANDLE", "Example_1234567");
    expect(getXFollowHandle()).toBe("Example_1234567");
  });
});
