import React from "react";
// @ts-expect-error -- @types/react-dom is not installed in this repository.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { load, resolveOgImage } = vi.hoisted(() => ({ load: vi.fn(), resolveOgImage: vi.fn(async () => null) }));
vi.mock("@/lib/reader/public-edition-loader", () => ({ loadPublicEdition: load }));
vi.mock("@/lib/bff/og-image", () => ({ resolveArticleOgImage: resolveOgImage }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("not-found"); }, redirect: (url: string) => { throw Error(`redirect:${url}`); } }));
import Page, { generateMetadata } from "../[date]/[id]/page";
import Layout from "../layout";
import ErrorPage from "../[date]/[id]/error";
import NotFound, { metadata as notFoundMetadata } from "@/app/not-found";
const params = { date: "2026-09-04", id: "abcdef012345" };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-05T00:00:00Z")); load.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("article route", () => {
  it.each([{ ...params, date: "2019-12-31" }, { ...params, date: "2026-02-30" }, { ...params, date: "2099-01-01" }, { ...params, id: "ABCDEF012345" }, { ...params, id: "abcdef012345/extra" }, { ...params, id: "%61bcdef01234" }])("rejects invalid params before loading: %j", async (invalid) => {
    await expect(Page({ params: invalid })).rejects.toThrow("not-found");
    await expect(generateMetadata({ params: invalid })).rejects.toThrow("not-found");
    expect(load).not.toHaveBeenCalled();
  });
  it("maps an unavailable edition to 404 for page and metadata", async () => {
    load.mockResolvedValue(null);
    await expect(Page({ params })).rejects.toThrow("not-found");
    await expect(generateMetadata({ params })).rejects.toThrow("not-found");
  });
  it("redirects unknown ids and samples warnings at ten per rolling minute", async () => {
    load.mockResolvedValue({ index: { byId: new Map() } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let n = 0; n < 20; n++) await expect(Page({ params })).rejects.toThrow("redirect:/calendar?date=2026-09-04&from=a");
    expect(warn).toHaveBeenCalledTimes(10);
    expect(warn).toHaveBeenCalledWith("[article] unknown id", { date: params.date });
    vi.advanceTimersByTime(60_000);
    await expect(Page({ params })).rejects.toThrow("redirect:");
    expect(warn).toHaveBeenCalledTimes(11);
    expect(await generateMetadata({ params })).toMatchObject({ robots: { index: false } });
  });
  it("uses the same canonical for marked and unmarked requests", async () => {
    vi.stubEnv("NEWSPAPER_SITE_URL", "https://example.com");
    load.mockResolvedValue({ index: { byId: new Map([[params.id, { sectionTitle: "News", article: { title: "Title", body: "Summary", source: "https://example.org/story" } }]]) }, articleCount: 3 });
    const unmarked = await generateMetadata({ params });
    expect(await generateMetadata({ params, searchParams: { utm_source: "x" } })).toEqual(unmarked);
    expect(unmarked).toHaveProperty("alternates.canonical", `https://example.com/a/${params.date}/${params.id}`);
    expect(renderToStaticMarkup(await Page({ params }))).toContain("この日の紙面を読む（他 2 本）");
  });
  it("brands error and root 404 from server env", () => {
    vi.stubEnv("NEWSPAPER_MASTHEAD", "Test Masthead");
    const html = renderToStaticMarkup(React.createElement(Layout, { children: React.createElement(ErrorPage) }));
    expect(html).toContain("Test Masthead");
    expect(html).toContain("一時的に表示できません");
    expect(notFoundMetadata.title).toBe("AI Daily News");
    expect(renderToStaticMarkup(React.createElement(NotFound))).toContain("Test Masthead");
  });
});
