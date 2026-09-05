import React from "react";
// @ts-expect-error -- @types/react-dom is not installed in this repository.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/script", () => ({ default: ({ src }: { src: string }) => React.createElement("script", { "data-src": src }) }));
import { ArticlePage } from "../article-page";

const props = { masthead: "Sample Daily", poweredBy: null, sourceRepo: null, date: "2026-09-04", id: "abcdef012345", sectionTitle: "ニュース", title: "見出し", summary: "要約本文", sourceUrl: "https://example.org/story", imageUrl: null, xFollowHandle: null, articleCount: 4 };

const widgetSrc = "https://platform.x.com/" + "widgets" + ".js";

describe("article server page", () => {
  it("renders the labelled follow fallback and official enhancement before the source action", () => {
    const html = renderToStaticMarkup(React.createElement(ArticlePage, { ...props, xFollowHandle: "example" }));
    expect(html).toContain("twitter-follow-button");
    expect(html).toContain('href="https://x.com/intent/follow?screen_name=example"');
    expect(html).toContain("@example をフォロー");
    expect(html).toContain('data-screen-name="example"');
    expect(html).toContain('data-show-count="false"');
    expect(html).toContain('data-size="large"');
    expect(html).toContain('data-lang="ja"');
    expect(html).toContain(`data-src="${widgetSrc}"`);
    expect(html.indexOf("@example をフォロー")).toBeLessThan(html.indexOf("記事を確認する"));
    expect(html.match(/<a[^>]*twitter-follow-button[^>]*>/)?.[0]).toMatch(/target="_blank" rel="noopener noreferrer"/);
  });
  it("omits the follow control and its script without a handle", () => {
    const html = renderToStaticMarkup(React.createElement(ArticlePage, props));
    for (const text of ["twitter-follow-button", "https://x.com/intent/follow", "@example をフォロー", widgetSrc, "<script"]) expect(html).not.toContain(text);
  });
  it("places a safe thumbnail between the heading and summary", () => {
    const imageUrl = "https://example.org/thumbnail.jpg";
    const html = renderToStaticMarkup(React.createElement(ArticlePage, { ...props, imageUrl }));
    expect(html).toContain(`<img src="${imageUrl}"`);
    expect(html).toMatch(/referrerpolicy="no-referrer"/i);
    expect(html).toContain('alt=""');
    expect(html).toContain('decoding="async"');
    expect(html).not.toContain('loading="lazy"');
    expect(html.indexOf("<img")).toBeGreaterThan(html.indexOf("</h1>"));
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("要約本文"));
  });
  it.each([null, "javascript:alert(1)"])("omits unavailable or unsafe thumbnail %j", (imageUrl) => {
    expect(renderToStaticMarkup(React.createElement(ArticlePage, { ...props, imageUrl }))).not.toContain("<img");
  });
  it("shows a source action and hostname without displaying the raw URL", () => {
    const html = renderToStaticMarkup(React.createElement(ArticlePage, { ...props, sourceUrl: "https://www.example.org/story" }));
    expect(html).toMatch(/<a href="https:\/\/www\.example\.org\/story" target="_blank" rel="noopener noreferrer"[^>]*>記事を確認する<\/a>/);
    expect(html).toContain(">example.org</span>");
    expect(html.replace(/<[^>]*>/g, "")).not.toContain("https://www.example.org/story");
  });
  it("omits the actions block when neither handle nor source is available", () => {
    const html = renderToStaticMarkup(React.createElement(ArticlePage, { ...props, sourceUrl: null }));
    expect(html).not.toContain("mt-8 flex flex-col items-center");
    expect(html).not.toContain("記事を確認する");
  });
  it("keeps the follow action without a source", () => {
    const html = renderToStaticMarkup(React.createElement(ArticlePage, { ...props, sourceUrl: null, xFollowHandle: "example" }));
    expect(html).toContain("@example をフォロー");
    expect(html).not.toContain("記事を確認する");
  });
  it("uses responsive heading sizes and line heights and centered mobile navigation", () => {
    const html = renderToStaticMarkup(React.createElement(ArticlePage, props));
    const headingClasses = html.match(/<h1 class="([^"]+)"/)![1].split(" ");
    expect(headingClasses).toEqual(expect.arrayContaining(["text-wired-display-sm", "md:text-wired-display-md", "lg:text-wired-display-lg", "leading-tight", "md:leading-tight", "lg:leading-tight"]));
    expect(headingClasses).not.toContain("text-wired-display-lg");
    const nav = html.match(/<nav[^>]*>[\s\S]*?<\/nav>/)![0];
    expect(nav).toContain("flex flex-col gap-3 sm:flex-row sm:flex-wrap");
    const links = [...nav.matchAll(/<a[^>]*class="([^"]+)"/g)];
    expect(links).toHaveLength(2);
    for (const link of links) expect(link[1].split(" ")).toContain("text-center");
  });
  it("renders summary, safe source, CTA and AI menu without JavaScript", () => {
    const html = renderToStaticMarkup(React.createElement(ArticlePage, props));
    expect(html).toContain("要約本文");
    expect(html).toContain('href="https://example.org/story"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="/calendar?date=2026-09-04"');
    expect(html).toContain("この日の紙面を読む（他 3 本）");
    expect(html).toMatch(/AI\s*に聞く/);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("Powered by");
    expect(html).not.toContain("<footer");
  });
  it("keeps hostile title and markdown inert and suppresses unsafe source links", () => {
    const html = renderToStaticMarkup(React.createElement(ArticlePage, { ...props, title: '</script><script>alert(1)</script>', summary: '<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)', sourceUrl: "javascript:alert(1)" }));
    expect(html).not.toMatch(/<script|<img|onerror=|href="javascript:/i);
    expect(html).toContain("&lt;/script&gt;");
    expect(html).not.toContain("引用元 <a");
  });
  it("renders optional env-provided attribution safely", () => {
    const html = renderToStaticMarkup(React.createElement(ArticlePage, { ...props, poweredBy: { label: "Example", url: "https://example.net" } }));
    expect(html).toContain("Powered by");
    expect(html).toContain('href="https://example.net"');
  });
  it("renders the source repository as the only footer item", () => {
    const html = renderToStaticMarkup(React.createElement(ArticlePage, { ...props, sourceRepo: { label: "GitHub", url: "https://github.com/caty-ai/x-collector" } }));
    expect(html).toContain("<footer");
    expect(html).toContain("Source:");
    expect(html).toContain('href="https://github.com/caty-ai/x-collector"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("renders credit before source with a separator", () => {
    const html = renderToStaticMarkup(React.createElement(ArticlePage, {
      ...props,
      poweredBy: { label: "Example", url: "https://example.net" },
      sourceRepo: { label: "GitHub", url: "https://github.com/caty-ai/x-collector" },
    }));
    expect(html).toMatch(/Powered by[\s\S]* · [\s\S]*Source:/);
  });
  it("suppresses an unsafe source repository URL", () => {
    const html = renderToStaticMarkup(React.createElement(ArticlePage, { ...props, sourceRepo: { label: "GitHub", url: "javascript:alert(1)" } }));
    expect(html).not.toContain("<footer");
    expect(html).not.toContain("javascript:");
  });
});
