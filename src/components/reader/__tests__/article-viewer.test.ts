import React from "react";
// @ts-expect-error -- @types/react-dom is not installed in this repository.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import NewsletterViewerPanel from "@/components/panels/NewsletterViewerPanel";
import { articleIdFromSource } from "@/lib/reader/article-id";

const markdown = "# Test\n## Section\n### First\nSummary.\n引用元: https://example.com/story\n### No source\nhttps://example.org/body-only\n## Second section\n### Duplicate\nSummary.\n引用元: https://example.com/story?utm_source=x\n";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("date=2026-09-02") }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => {
    const value = initial && typeof initial === "object" && "loading" in initial
      ? { loading: false, edition: { status: "published", items: [], bindingsCount: 3, contentChars: 100 }, markdown, emptyDay: false, error: null }
      : initial;
    return actual.useState(value);
  } };
});
vi.mock("@/components/reader/ArticleActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/reader/ArticleActions")>();
  return { ArticleActions: (props: React.ComponentProps<typeof actual.ArticleActions>) => React.createElement(
    "div",
    { "data-landing": props.articleUrl ?? "none", "data-edition": props.editionUrl, "data-ai-source": props.sourceUrl },
    React.createElement(actual.ArticleActions, props),
  ) };
});
afterEach(() => vi.unstubAllGlobals());
it("gives only the first source occurrence a landing URL across sections", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(React.createElement(NewsletterViewerPanel, { masthead: "テスト新聞" }));
  const id = articleIdFromSource("https://example.com/story");
  expect(html).toContain(`data-landing="/a/2026-09-02/${id}"`);
  expect(html.match(/data-landing="\/a\//g)).toHaveLength(1);
  expect(html.match(/data-landing="none"/g)).toHaveLength(2);
  expect(html.match(/data-edition="\/calendar\?date=2026-09-02"/g)).toHaveLength(3);
  expect(html).toContain('id="a-2026-09-02-3"');
});

it("keeps the body-only source URL for AI questions without an article share link", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(React.createElement(NewsletterViewerPanel, { masthead: "テスト新聞" }));
  const bodyOnlyArticle = html.split('id="a-2026-09-02-2"')[1].split('id="a-2026-09-02-3"')[0];
  expect(bodyOnlyArticle).toContain('data-ai-source="https://example.org/body-only"');
  expect(bodyOnlyArticle).toContain("AIに聞く");
  expect(bodyOnlyArticle).toContain('data-landing="none"');
  expect(bodyOnlyArticle).not.toContain("でシェア");
  expect(bodyOnlyArticle).not.toContain('href="/a/');
});
