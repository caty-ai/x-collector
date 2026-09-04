import { afterEach, describe, expect, it, vi } from "vitest";

import { getPoweredBy, getTagline } from "@/lib/masthead";

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
