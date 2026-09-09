import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildEditionPath,
  buildOgImageBffPath,
  formatEditionDateLabel,
  isAcceptablePublicDate,
  isAcceptablePublicMonth,
  resolveEditionDate,
  shiftIsoDate,
  todayJstIsoDate,
} from "@/lib/reader/edition-nav";

afterEach(() => vi.unstubAllEnvs());

describe("edition date helpers", () => {
  const beforeJstMidnight = new Date("2026-08-01T14:59:59Z");
  const afterJstMidnight = new Date("2026-08-01T15:00:00Z");

  it("resolves valid scalar and array dates", () => {
    expect(resolveEditionDate("2026-02-28", beforeJstMidnight)).toBe("2026-02-28");
    expect(resolveEditionDate(["2026-03-01", "2026-03-02"], beforeJstMidnight)).toBe(
      "2026-03-01",
    );
  });

  it("uses the supplied fallback before today for client-side invalid values", () => {
    expect(resolveEditionDate("bad", afterJstMidnight, "2026-07-20")).toBe("2026-07-20");
  });

  it("falls back to today in JST for missing, malformed, and impossible dates", () => {
    expect(todayJstIsoDate(beforeJstMidnight)).toBe("2026-08-01");
    expect(todayJstIsoDate(afterJstMidnight)).toBe("2026-08-02");
    expect(resolveEditionDate(undefined, afterJstMidnight)).toBe("2026-08-02");
    expect(resolveEditionDate("not-a-date", afterJstMidnight)).toBe("2026-08-02");
    expect(resolveEditionDate("2026-02-31", afterJstMidnight)).toBe("2026-08-02");
  });

  it("shifts civil dates across month, year, and leap-day boundaries", () => {
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIsoDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftIsoDate("2024-02-29", 1)).toBe("2024-03-01");
  });

  it("builds navigation paths and the inherited Japanese-era label", () => {
    expect(buildEditionPath("2026-08-02")).toBe("/calendar?date=2026-08-02");
    expect(formatEditionDateLabel("2026-08-02")).toMatch(/年.*\([日月火水木金土]\)/);
  });

  it("builds an encoded og-image BFF path with a valid edition date", () => {
    expect(buildOgImageBffPath("https://example.com/a path?q=one&two=2", "2026-08-02")).toBe(
      "/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fa+path%3Fq%3Done%26two%3D2&date=2026-08-02",
    );
  });

  it("omits an invalid edition date from the og-image BFF path", () => {
    expect(buildOgImageBffPath("https://example.com/article", "not-a-date")).toBe(
      "/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Farticle",
    );
  });

  it("bounds anonymous dates from 2020 through tomorrow JST", () => {
    expect(isAcceptablePublicDate("2020-01-01", afterJstMidnight)).toBe(true);
    expect(isAcceptablePublicDate("2026-08-03", afterJstMidnight)).toBe(true);
    expect(isAcceptablePublicDate("2026-08-04", afterJstMidnight)).toBe(false);
    expect(isAcceptablePublicDate("2019-12-31", afterJstMidnight)).toBe(false);
    expect(isAcceptablePublicDate("2026-02-31", afterJstMidnight)).toBe(false);
  });

  it("bounds anonymous months from 2020 through the month containing tomorrow JST", () => {
    expect(isAcceptablePublicMonth("2020-01", afterJstMidnight)).toBe(true);
    expect(isAcceptablePublicMonth("2026-08", afterJstMidnight)).toBe(true);
    expect(isAcceptablePublicMonth("2026-09", afterJstMidnight)).toBe(false);
    expect(isAcceptablePublicMonth("2019-12", afterJstMidnight)).toBe(false);
    expect(isAcceptablePublicMonth("2026-00", afterJstMidnight)).toBe(false);
    expect(isAcceptablePublicMonth("2026-13", afterJstMidnight)).toBe(false);
    expect(isAcceptablePublicMonth("2026-8", afterJstMidnight)).toBe(false);
  });

  it("allows the next month only when tomorrow JST crosses the month boundary", () => {
    const september30Jst = new Date("2026-09-30T12:00:00.000Z");
    expect(isAcceptablePublicMonth("2026-10", september30Jst)).toBe(true);
    expect(isAcceptablePublicMonth("2026-11", september30Jst)).toBe(false);
  });
});
