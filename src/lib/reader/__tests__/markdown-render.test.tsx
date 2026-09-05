import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../markdown-render";

// This repository has no @types/react-dom; type the single server API used here.
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: ReturnType<typeof renderMarkdown>) => string;
};

describe("shared markdown renderer", () => {
  it.each(["[x](javascript:alert(1))", "<script>alert(1)</script>", '<img src="x" onerror="alert(1)">'])("does not emit executable markup for %s", (markdown) => {
    const html = renderToStaticMarkup(renderMarkdown(markdown));
    expect(html).not.toMatch(/<script\b|<img\b|\bonerror\s*=|href=["']javascript:/i);
  });
  it("opens safe links with opener protection", () => {
    const html = renderToStaticMarkup(renderMarkdown("[source](https://example.com/article)"));
    expect(html).toContain('href="https://example.com/article"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("merges extra components with the link defaults", () => {
    const html = renderToStaticMarkup(renderMarkdown("*A* [source](https://example.org/item)", { em: () => "custom emphasis" }));
    expect(html).toContain("custom emphasis");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://example.org/item"');
  });
});
