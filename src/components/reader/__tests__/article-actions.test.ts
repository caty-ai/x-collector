import React, { type ReactElement } from "react";
// @ts-expect-error -- @types/react-dom is not installed in this repository.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArticleActions } from "../ArticleActions";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useRef: () => ({ current: null }), useEffect: () => {}, useState: (value: unknown) => [value, vi.fn()] };
});

const props = { anchorId: "a-test", articleUrl: "/a/2026-09-02/abcdef012345", editionUrl: "/calendar?date=2026-09-02", masthead: "テスト新聞", title: "Title", sourceUrl: "https://example.com/story", summary: "Summary" };
function buttons(node: React.ReactNode): ReactElement[] {
  if (!React.isValidElement(node)) return [];
  const children = React.Children.toArray((node.props as { children?: React.ReactNode }).children);
  return [...(node.type === "button" ? [node] : []), ...children.flatMap(buttons)];
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("article actions", () => {
  it("renders AI and sharing controls for a landing article", () => {
    const html = renderToStaticMarkup(React.createElement(ArticleActions, props));
    expect(html).toContain("AIに聞く");
    expect(html).toContain('aria-label="Xでシェア"');
    expect(html).toContain('aria-label="Facebookでシェア"');
  });
  it("hides shares for a source-less or duplicate article but keeps copy", () => {
    const html = renderToStaticMarkup(React.createElement(ArticleActions, { ...props, articleUrl: null, sourceUrl: null }));
    expect(html).not.toContain("でシェア");
    expect(html).toContain('aria-label="リンクをコピー"');
  });
  it("opens the landing share URL and copies attributed article or clean edition URLs", async () => {
    vi.useFakeTimers();
    const open = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { location: { origin: "https://example.com" }, open });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const click = (articleUrl: string | null, label: string) => {
      const button = buttons(ArticleActions({ ...props, articleUrl })).find((button) => button.props["aria-label"] === label)!;
      button.props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    };
    click(props.articleUrl, "Xでシェア");
    const shared = new URL(new URL(open.mock.calls[0][0]).searchParams.get("url")!);
    expect(shared.pathname).toBe(props.articleUrl);
    expect(shared.searchParams.get("utm_source")).toBe("x");
    click(props.articleUrl, "リンクをコピー");
    expect(writeText).toHaveBeenLastCalledWith(`https://example.com${props.articleUrl}?utm_source=copy&utm_medium=share`);
    click(null, "リンクをコピー");
    expect(writeText).toHaveBeenLastCalledWith(`https://example.com${props.editionUrl}`);
    await Promise.resolve();
  });
});
