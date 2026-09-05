import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedEdition } from "@/lib/reader/public-edition-loader";

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/reader/public-edition-loader", () => ({ loadPublicEdition: load }));
import robots, { buildRobots, dynamic as robotsDynamic } from "../robots";
import sitemap, { buildSitemapEntries, dynamic as sitemapDynamic, SITEMAP_BUDGET_MS, SITEMAP_DAYS } from "../sitemap";

const dates = ["2026-09-05", "2026-09-04", "2026-09-03", "2026-09-02", "2026-09-01", "2026-08-31", "2026-08-30"];
const ids = ["ffffffffffff", "000000000001"];
function edition(date: string, articleIds = ids): LoadedEdition {
  return {
    date,
    parsed: { title: "Edition", preamble: "", sections: [] },
    index: {
      byId: new Map(articleIds.map((id, articleIndex) => [id, {
        sectionIndex: 0, articleIndex, sectionTitle: "News",
        article: { title: "Title", body: "Summary", source: "https://example.com/source" },
      }])),
      total: articleIds.length,
    },
    articleCount: articleIds.length,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  // UTC is still September 4; JST has just entered September 5.
  vi.setSystemTime(new Date("2026-09-04T15:00:00Z"));
  vi.stubEnv("NEWSPAPER_PUBLIC", "1");
  vi.stubEnv("NEWSPAPER_SITE_URL", "https://example.com/configured/path");
  vi.stubEnv("NEXTAUTH_URL", undefined);
  load.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("robots", () => {
  it.each(["1", "true", "TRUE"])("publishes article discovery for %s", (value) => {
    vi.stubEnv("NEWSPAPER_PUBLIC", value);
    expect(robots()).toEqual({
      rules: [{ userAgent: "*", allow: ["/a/", "/calendar", "/sitemap.xml", "/og-default.png"], disallow: ["/"] }],
      sitemap: "https://example.com/sitemap.xml",
    });
  });
  it("allows the advertised sitemap and fallback image", () => {
    expect(robots().rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ allow: expect.arrayContaining(["/sitemap.xml", "/og-default.png"]) }),
    ]));
  });
  it("uses the fallback origin", () => {
    vi.stubEnv("NEWSPAPER_SITE_URL", undefined);
    vi.stubEnv("NEXTAUTH_URL", "https://example.com/auth");
    expect(robots().sitemap).toBe("https://example.com/sitemap.xml");
  });
  it.each(["0", undefined])("disallows everything for %s", (value) => {
    vi.stubEnv("NEWSPAPER_PUBLIC", value);
    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: ["/"] }] });
  });
  it("fails closed without an origin", () => {
    vi.stubEnv("NEWSPAPER_SITE_URL", "invalid");
    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: ["/"] }] });
    expect(buildRobots({ isPublic: true, siteUrl: null })).not.toHaveProperty("sitemap");
  });
  it("reads changed environment on every invocation", () => {
    expect(robots()).toHaveProperty("sitemap");
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    expect(robots()).not.toHaveProperty("sitemap");
    vi.stubEnv("NEWSPAPER_PUBLIC", "1");
    vi.stubEnv("NEWSPAPER_SITE_URL", undefined);
    expect(robots()).not.toHaveProperty("sitemap");
  });
});

describe("sitemap", () => {
  it.each(["0", undefined])("does not load when the switch is %s", async (value) => {
    vi.stubEnv("NEWSPAPER_PUBLIC", value);
    expect(await sitemap()).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
  it("does not load without an origin", async () => {
    vi.stubEnv("NEWSPAPER_SITE_URL", undefined);
    expect(await sitemap()).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
  it("requests exactly the last seven JST dates, descending across a month boundary", async () => {
    expect(await sitemap()).toEqual([]);
    expect(SITEMAP_DAYS).toBe(7);
    expect(load.mock.calls).toEqual(dates.map((date) => [date]));
  });
  it("lists only available articles in map order with JST midnight modification dates", async () => {
    load.mockImplementation(async (date: string) =>
      date === dates[0] || date === dates[2] ? edition(date) : null);
    expect(await sitemap()).toEqual([dates[0], dates[2]].flatMap((date) => ids.map((id) => ({
      url: `https://example.com/a/${date}/${id}`,
      lastModified: new Date(`${date}T00:00:00+09:00`),
    }))));
    expect(new Date(`${dates[0]}T00:00:00+09:00`).toISOString()).toBe("2026-09-04T15:00:00.000Z");
  });
  it("uses the fallback and rereads configuration between requests", async () => {
    vi.stubEnv("NEWSPAPER_SITE_URL", undefined);
    vi.stubEnv("NEXTAUTH_URL", "https://example.com/auth");
    load.mockResolvedValueOnce(edition(dates[0], [ids[0]]));
    expect(await sitemap()).toHaveLength(1);
    load.mockClear();
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    expect(await sitemap()).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
  it("skips busy, transient and unexpected errors, logging once without error details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failures = ["UpstreamBusyError", "UpstreamTransientError", "Error"];
    load.mockImplementation(async (date: string) => {
      const index = dates.indexOf(date);
      if (index < failures.length) {
        throw Object.assign(new Error("https://example.com/private"), { name: failures[index] });
      }
      return edition(date, [ids[0]]);
    });
    await expect(sitemap()).resolves.toEqual(dates.slice(3).map((date) => ({
      url: `https://example.com/a/${date}/${ids[0]}`,
      lastModified: new Date(`${date}T00:00:00+09:00`),
    })));
    expect(load).toHaveBeenCalledTimes(7);
    expect(warn.mock.calls).toEqual([["[sitemap] skipped %d of %d editions", 3, 7]]);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/https?:|private|Error|2026-/);
    await sitemap();
    expect(warn).toHaveBeenCalledTimes(2);
  });
  it.each([SITEMAP_BUDGET_MS, SITEMAP_BUDGET_MS + 1])("returns two loaded dates when the budget reaches %d ms", async (elapsed) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const now = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(101)
      .mockReturnValue(100 + elapsed);
    load.mockImplementation(async (date: string) => edition(date));
    expect(await buildSitemapEntries({ isPublic: true, siteUrl: "https://example.com", dates, load, now }))
      .toEqual(dates.slice(0, 2).flatMap((date) => ids.map((id) => ({
        url: `https://example.com/a/${date}/${id}`,
        lastModified: new Date(`${date}T00:00:00+09:00`),
      }))));
    expect(load.mock.calls).toEqual(dates.slice(0, 2).map((date) => [date]));
    expect(warn.mock.calls).toEqual([["[sitemap] skipped %d of %d editions", 5, 7]]);
  });
  it("preserves both URLs when an article id appears on two dates", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    load.mockImplementation(async (date: string) =>
      dates.slice(0, 2).includes(date) ? edition(date, [ids[0]]) : null);
    expect((await sitemap()).map(({ url }) => url)).toEqual(
      dates.slice(0, 2).map((date) => `https://example.com/a/${date}/${ids[0]}`),
    );
    expect(warn).not.toHaveBeenCalled();
  });
  it("finishes an in-flight load after the budget expires before skipping the remaining dates", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let release!: (value: LoadedEdition) => void;
    load.mockImplementation(() => new Promise<LoadedEdition>((resolve) => { release = resolve; }));
    const pending = sitemap();
    vi.advanceTimersByTime(SITEMAP_BUDGET_MS + 1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    release(edition(dates[0], [ids[0]]));
    await expect(pending).resolves.toEqual([{
      url: `https://example.com/a/${dates[0]}/${ids[0]}`,
      lastModified: new Date(`${dates[0]}T00:00:00+09:00`),
    }]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls).toEqual([["[sitemap] skipped %d of %d editions", 6, 7]]);
  });
  it("waits for each load to resolve before starting the next date", async () => {
    const releases: Array<(value: LoadedEdition | null) => void> = [];
    load.mockImplementation(() => new Promise<LoadedEdition | null>((resolve) => releases.push(resolve)));
    const pending = sitemap();
    for (let index = 0; index < dates.length; index++) {
      expect(load.mock.calls).toEqual(dates.slice(0, index + 1).map((date) => [date]));
      releases[index](null);
      await Promise.resolve();
    }
    await expect(pending).resolves.toEqual([]);
  });
  it("keeps the helper fail-closed before calling its injected loader", async () => {
    for (const input of [{ isPublic: false, siteUrl: "https://example.com" }, { isPublic: true, siteUrl: null }]) {
      expect(await buildSitemapEntries({ ...input, dates, load })).toEqual([]);
    }
    expect(load).not.toHaveBeenCalled();
  });
});

it("keeps both discovery routes dynamic and independent of request headers", () => {
  expect(robotsDynamic).toBe("force-dynamic");
  expect(sitemapDynamic).toBe("force-dynamic");
  for (const file of ["robots.ts", "sitemap.ts"]) {
    expect(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).not.toMatch(/headers|Host/);
  }
});
