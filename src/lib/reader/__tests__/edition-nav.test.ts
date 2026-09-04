import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildEditionPath,
  formatEditionDateLabel,
  isAcceptablePublicDate,
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

  it("bounds anonymous dates from 2020 through tomorrow JST", () => {
    expect(isAcceptablePublicDate("2020-01-01", afterJstMidnight)).toBe(true);
    expect(isAcceptablePublicDate("2026-08-03", afterJstMidnight)).toBe(true);
    expect(isAcceptablePublicDate("2026-08-04", afterJstMidnight)).toBe(false);
    expect(isAcceptablePublicDate("2019-12-31", afterJstMidnight)).toBe(false);
    expect(isAcceptablePublicDate("2026-02-31", afterJstMidnight)).toBe(false);
  });
});
