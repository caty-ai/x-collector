import fs from "node:fs";
import React from "react";
// @ts-expect-error -- @types/react-dom is not installed in this repository.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/app-shell/EditionNav", () => ({ default: () => null }));

import ReaderShell from "@/components/app-shell/ReaderShell";

const props = {
  title: "Sample Daily",
  description: "Sample description",
  productName: "Sample",
  editionDate: "2026-09-05",
  accessLabel: "公開閲覧",
  poweredBy: null,
};

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

describe("reader shell source repository link", () => {
  it("renders the source repository link in the footer", () => {
    const html = renderToStaticMarkup(React.createElement(ReaderShell, {
      ...props,
      sourceRepo: { label: "GitHub", url: "https://github.com/caty-ai/x-collector" },
    }));
    expect(html).toContain("Source:");
    expect(html).toContain('href="https://github.com/caty-ai/x-collector"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain(">GitHub</a>");
  });

  it("omits the source repository link when disabled", () => {
    const html = renderToStaticMarkup(React.createElement(ReaderShell, { ...props, sourceRepo: null }));
    expect(html).not.toContain("Source:");
    expect(html).not.toContain("github.com/caty-ai");
  });

  it("wires the source repository setting into the calendar route", () => {
    const route = fs.readFileSync("src/app/calendar/page.tsx", "utf8");
    expect(route).toContain("sourceRepo={getSourceRepoLink()}");
  });
});
