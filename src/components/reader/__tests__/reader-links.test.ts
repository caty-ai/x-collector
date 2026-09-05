import { describe, expect, it } from "vitest";

import {
  AI_SERVICES,
  buildAiServiceTarget,
  buildArticleAnchorId,
  buildArticleQuestion,
  buildArticleUrl,
  buildEditionQuestion,
  buildEditionUrl,
  buildShareUrls,
  buildShareTargets,
  buildArticlePath,
  buildArticleCanonicalUrl,
  extractFirstExternalUrl,
  fitToEncodedBudget,
  formatDateLabelJa,
  isSafeHttpUrl,
  parseArticleAnchor,
  plainTextFromMarkdown,
  resolveDeepLinkAnchor,
  truncateText,
} from "../reader-links";

describe("reader links", () => {
  it("builds and parses article anchors round-trip", () => {
    const id = buildArticleAnchorId("2026-09-02", 7);
    expect(id).toBe("a-2026-09-02-7");
    expect(parseArticleAnchor(`#${id}`)).toEqual({ date: "2026-09-02", n: 7 });
    expect(parseArticleAnchor(id)).toEqual({ date: "2026-09-02", n: 7 });
  });

  it("rejects malformed and zero-numbered article anchors", () => {
    expect(parseArticleAnchor("#a-2026-09-02-x")).toBeNull();
    expect(parseArticleAnchor("#article-2026-09-02-7")).toBeNull();
    expect(parseArticleAnchor("#a-2026-09-02-0")).toBeNull();
  });

  it("resolves a deep link for the applied date", () => {
    expect(resolveDeepLinkAnchor("#a-2026-09-02-2", "2026-09-02")).toEqual({
      date: "2026-09-02",
      n: 2,
    });
  });

  it("rejects deep links for another date or garbage input", () => {
    expect(resolveDeepLinkAnchor("#a-2026-09-01-2", "2026-09-02")).toBeNull();
    expect(resolveDeepLinkAnchor("#garbage", "2026-09-02")).toBeNull();
  });

  it("builds edition and article URLs", () => {
    const editionUrl = buildEditionUrl("https://news.example", "2026-09-02");
    expect(editionUrl).toBe("https://news.example/calendar?date=2026-09-02");
    expect(buildArticleUrl("https://news.example", "2026-09-02", 3)).toBe(
      "https://news.example/calendar?date=2026-09-02#a-2026-09-02-3",
    );
  });

  it("uses a zero-padded Japanese date label", () => {
    expect(formatDateLabelJa("2026-09-02")).toBe("2026年09月02日");
    expect(formatDateLabelJa("not-a-date")).toBe("not-a-date");
  });

  it("builds a fully substituted edition question", () => {
    const url = "https://news.example/calendar?date=2026-09-02";
    const question = buildEditionQuestion({
      url,
      dateLabel: "2026年09月02日",
      masthead: "テスト新聞",
    });

    expect(question).toContain(url);
    expect(question).toContain("2026年09月02日");
    expect(question).toContain("テスト新聞");
    expect(question).toContain("まず URL");
    expect(question).not.toContain("{");
  });

  it("turns markdown summaries into compact plain text", () => {
    const markdown = [
      "## **見出し**",
      "> [本文](https://example.com) と `code` と ~~削除~~",
      "- 項目 <em>一</em>",
      "Why it matters: remove this",
      "引用元: https://source.example",
    ].join("\n");

    expect(plainTextFromMarkdown(markdown)).toBe(
      "見出し 本文 と code と 削除 項目 一",
    );
  });

  it("includes safe article context and strips excluded markdown lines", () => {
    const question = buildArticleQuestion({
      title: "**新モデル**",
      sourceUrl: "https://source.example/story?id=1",
      summary:
        "[要約](https://paper.example)です。\nWhy it matters: hidden\n引用元: hidden",
    });

    expect(question).toContain("「新モデル」");
    expect(question).toContain(
      "引用元 https://source.example/story?id=1 を読んで",
    );
    expect(question).toContain("紙面の要約: 要約です。");
    expect(question).not.toContain("Why it matters");
    expect(question).not.toContain("引用元: hidden");
  });

  it("rejects unsafe URL schemes and omits an unsafe source", () => {
    const question = buildArticleQuestion({
      title: "安全",
      sourceUrl: "javascript:alert(1)",
      summary: "要約",
    });

    expect(question).not.toContain("javascript:");
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/plain,hello")).toBe(false);
    expect(isSafeHttpUrl("ftp://example.com/file")).toBe(false);
    expect(isSafeHttpUrl("https://example.com")).toBe(true);
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
  });

  it("truncates text by code point and appends an ellipsis", () => {
    const truncated = truncateText("😀".repeat(301), 300);
    expect(Array.from(truncated)).toHaveLength(301);
    expect(truncated.endsWith("…")).toBe(true);
    expect(Array.from(truncated).slice(0, -1).join("")).toBe("😀".repeat(300));
  });

  it("caps article titles at 120 code points", () => {
    const question = buildArticleQuestion({
      title: "題".repeat(140),
      sourceUrl: null,
      summary: "",
    });
    expect(question).toMatch(new RegExp(`^「${"題".repeat(120)}…」`));
  });

  it("caps article summaries at 300 code points", () => {
    const question = buildArticleQuestion({
      title: "題",
      sourceUrl: null,
      summary: "a".repeat(320),
    });
    expect(question).toContain(`紙面の要約: ${"a".repeat(300)}…`);
  });

  it("keeps every prefill service URL below 1800 characters", () => {
    const question = buildArticleQuestion({
      title: "長い見出し".repeat(80),
      sourceUrl: `https://source.example/${"path-segment/".repeat(30)}?a=1&b=2`,
      summary: "日本語のとても長い要約".repeat(200),
    });

    expect(encodeURIComponent(question).length).toBeLessThanOrEqual(1600);
    for (const service of AI_SERVICES.filter(
      (candidate) => candidate.mode === "prefill",
    )) {
      const target = buildAiServiceTarget(service.id, question);
      expect(
        target.url.length,
        `${service.name} target was ${target.url.length} chars`,
      ).toBeLessThan(1800);
    }
  });

  it("fits multi-byte text to an encoded budget", () => {
    const fitted = fitToEncodedBudget("日".repeat(100), 100);
    expect(encodeURIComponent(fitted).length).toBeLessThanOrEqual(100);
    expect(fitted.endsWith("…")).toBe(true);
  });

  it("encodes reserved characters in share URLs", () => {
    const urls = buildShareUrls({
      url: "https://news.example/story?a=1&b=2#part",
      title: "A&B #1",
    });
    expect(urls.x).toMatch(/text=A%26B%20%231/);
    expect(urls.x).toMatch(
      /url=https%3A%2F%2Fnews\.example%2Fstory%3Fa%3D1%26b%3D2%23part/,
    );
    expect(urls.facebook).toMatch(
      /u=https%3A%2F%2Fnews\.example%2Fstory%3Fa%3D1%26b%3D2%23part/,
    );
  });

  it("distinguishes prefill and copy AI service targets", () => {
    const prefill = buildAiServiceTarget("chatgpt", "日本語 #1");
    const copy = buildAiServiceTarget("gemini", "日本語 #1");

    expect(prefill.mode).toBe("prefill");
    expect(prefill.url).toBe(
      `https://chatgpt.com/?q=${encodeURIComponent("日本語 #1")}`,
    );
    expect(copy).toEqual({
      mode: "copy",
      url: "https://gemini.google.com/app",
    });
  });

  it("prefers a markdown link when extracting an external URL", () => {
    expect(
      extractFirstExternalUrl(
        "[primary](https://primary.example/story) then https://secondary.example/story",
        "https://third.example/story",
      ),
    ).toBe("https://primary.example/story");
    expect(
      extractFirstExternalUrl("no link here", "https://fallback.example/story"),
    ).toBe("https://fallback.example/story");
  });

  it("strips trailing CJK punctuation from a bare URL only", () => {
    expect(extractFirstExternalUrl("https://example.com/x。")).toBe(
      "https://example.com/x",
    );
    expect(extractFirstExternalUrl("https://example.com/x】")).toBe(
      "https://example.com/x",
    );
    expect(extractFirstExternalUrl("[label](https://example.com/x。)")).toBe(
      "https://example.com/x。",
    );
  });
});


describe("article landing links", () => {
  it("uses clean paths and channel-specific share attribution", () => {
    const path = buildArticlePath("2026-09-02", "abcdef012345");
    expect(path).toBe("/a/2026-09-02/abcdef012345");
    const canonicalUrl = buildArticleCanonicalUrl("https://example.com", "2026-09-02", "abcdef012345");
    const targets = buildShareTargets({ canonicalUrl: canonicalUrl + "?utm_source=old#old", title: "見出し", masthead: "テスト新聞" });
    expect(targets.canonical).toBe(canonicalUrl);
    expect(new URL(targets.x).searchParams.get("text")).toBe("見出し | テスト新聞");
    for (const [channel, value] of Object.entries({
      x: new URL(targets.x).searchParams.get("url")!,
      facebook: new URL(targets.facebook).searchParams.get("u")!,
      copy: targets.copy,
    })) {
      const url = new URL(value);
      expect(url.pathname).toBe(path);
      expect(url.searchParams.get("utm_source")).toBe(channel);
      expect(url.searchParams.get("utm_medium")).toBe("share");
      expect(url.hash).toBe("");
    }
  });

  it.each([
    ["ＡＩ News", "ai   news。Details remain。", "Details remain。"],
    ["Long enough headline", "LONG ENOUGH HEADLINE is here. Details remain.", "Details remain."],
    ["AI", "AI is here. Details remain.", "AI is here. Details remain."],
    ["Title", "Title.", "Title."],
    ["Title", "Unrelated first. Details remain.", "Unrelated first. Details remain."],
  ])("deduplicates only the qualifying first sentence: %s", (title, summary, expected) => {
    const question = buildArticleQuestion({ title, summary, sourceUrl: null });
    expect(question.split("紙面の要約: ")[1]).toBe(expected);
  });
});
