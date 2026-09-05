import React from "react";
// @ts-expect-error -- @types/react-dom is not installed in this repository.
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, { type Components } from "react-markdown";
import { describe, expect, it } from "vitest";
import { MARKDOWN_COMPONENTS, renderMarkdown } from "@/lib/reader/markdown-render";

// The viewer renders source paragraphs inline, without the body styling wrapper.
const extraComponents: Components = {
  p: ({ children }) => React.createElement(React.Fragment, null, children),
};
const renderViewerSource = (text: string) => React.cloneElement(
  renderMarkdown(text, extraComponents),
  { className: undefined },
);

describe("newsletter viewer source rendering", () => {
  it("keeps skipHtml with the viewer's inline paragraph component", () => {
    const html = renderToStaticMarkup(renderViewerSource(
      '[source](https://example.com/article) <img src="x" onerror="alert(1)">\n\n<script>alert(1)</script>',
    ));
    expect(html).not.toMatch(/<script\b|<img\b|\bonerror\s*=/i);
    expect(html).not.toMatch(/<p\b|<div\b/);
    expect(html).toContain('href="https://example.com/article"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("matches the previous inline renderer markup", () => {
    const text = "[source](https://example.com/article) **Details**";
    const previous = React.createElement(ReactMarkdown, {
      skipHtml: true,
      components: { ...MARKDOWN_COMPONENTS, ...extraComponents },
      children: text,
    });
    expect(renderToStaticMarkup(renderViewerSource(text))).toBe(renderToStaticMarkup(previous));
  });
});
