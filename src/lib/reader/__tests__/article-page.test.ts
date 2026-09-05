import React from "react";
// @ts-expect-error -- @types/react-dom is not installed in this repository.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArticlePage } from "../article-page";

const props = { masthead: "Sample Daily", poweredBy: null, sourceRepo: null, date: "2026-09-04", id: "abcdef012345", sectionTitle: "ニュース", title: "見出し", summary: "要約本文", sourceUrl: "https://example.org/story", articleCount: 4 };

describe("article server page", () => {
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
