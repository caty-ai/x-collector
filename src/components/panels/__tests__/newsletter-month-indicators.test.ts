import { describe, expect, it, vi } from "vitest";

import { HttpError } from "@/lib/bff/fetch-json-or-error";
import {
  buildMonthIndicatorMap,
  createMonthIndicatorLoader,
  MonthEndpointMissingError,
} from "@/lib/reader/month-indicators";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function datesFor(monthDate: Date): string[] {
  const year = monthDate.getUTCFullYear();
  const month = monthDate.getUTCMonth();
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, index) => `${year}-${String(month + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
  );
}

function createLoader(overrides?: {
  fetchMonth?: (monthKey: string) => Promise<{ days: Array<{ date: string; bindingsCount: number }> }>;
  fetchDay?: (date: string) => Promise<{ known: boolean; hasData: boolean; bindingsCount: number }>;
}) {
  return createMonthIndicatorLoader({
    fetchMonth: overrides?.fetchMonth ?? vi.fn(async () => ({ days: [] })),
    fetchDay:
      overrides?.fetchDay ??
      vi.fn(async () => ({ known: true, hasData: false, bindingsCount: 0 })),
    isEndpointMissing: (error) => error instanceof MonthEndpointMissingError,
    listDates: datesFor,
  });
}

describe("newsletter month indicator coordinator", () => {
  it("uses one month request and zero day requests per month flip", async () => {
    const fetchMonth = vi.fn(async (monthKey: string) => ({
      days: [{ date: `${monthKey}-03`, bindingsCount: 2 }],
    }));
    const fetchDay = vi.fn();
    const loader = createLoader({ fetchMonth, fetchDay });

    await loader.load("2026-09", new Date(Date.UTC(2026, 8, 1)));
    await loader.load("2026-10", new Date(Date.UTC(2026, 9, 1)));

    expect(fetchMonth).toHaveBeenCalledTimes(2);
    expect(fetchDay).not.toHaveBeenCalled();
  });

  it("maps sparse days and ignores days outside the requested date list", () => {
    expect(
      buildMonthIndicatorMap(
        ["2026-09-01", "2026-09-02", "2026-09-03"],
        [
          { date: "2026-09-01", bindingsCount: 4 },
          { date: "2026-09-03", bindingsCount: 0 },
          { date: "2026-10-01", bindingsCount: 9 },
        ],
      ),
    ).toEqual({
      "2026-09-01": { known: true, hasData: true, bindingsCount: 4 },
      "2026-09-02": { known: true, hasData: false, bindingsCount: 0 },
      "2026-09-03": { known: true, hasData: false, bindingsCount: 0 },
    });
  });

  it("treats an empty month as all known without falling back", async () => {
    const fetchMonth = vi.fn(async () => ({ days: [] }));
    const fetchDay = vi.fn();
    const loader = createLoader({ fetchMonth, fetchDay });

    const result = await loader.load("2026-09", new Date(Date.UTC(2026, 8, 1)));

    expect(result?.source).toBe("month");
    expect(Object.values(result?.indicators ?? {})).toHaveLength(30);
    expect(Object.values(result?.indicators ?? {})).toEqual(
      Array.from({ length: 30 }, () => ({
        known: true,
        hasData: false,
        bindingsCount: 0,
      })),
    );
    expect(fetchDay).not.toHaveBeenCalled();
  });

  it("falls back on the coded missing-endpoint error, caches all 31 days, and warns", async () => {
    const fetchMonth = vi.fn(async () => {
      throw new MonthEndpointMissingError();
    });
    const fetchDay = vi.fn(async (date: string) => ({
      known: true,
      hasData: date.endsWith("-01"),
      bindingsCount: date.endsWith("-01") ? 1 : 0,
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const loader = createLoader({ fetchMonth, fetchDay });
    const january = new Date(Date.UTC(2026, 0, 1));

    const first = await loader.load("2026-01", january);
    const second = await loader.load("2026-01", january);

    expect(first?.source).toBe("fallback-per-day");
    expect(first?.indicators["2026-01-01"]).toEqual({
      known: true,
      hasData: true,
      bindingsCount: 1,
    });
    expect(second).toBe(first);
    expect(fetchMonth).toHaveBeenCalledTimes(1);
    expect(fetchDay).toHaveBeenCalledTimes(31);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not fall back for a plain 404 and returns the exact wrapped error", async () => {
    const fetchDay = vi.fn();
    const loader = createLoader({
      fetchMonth: async () => {
        throw new HttpError("Not found", 404);
      },
      fetchDay,
    });

    const result = await loader.load("2026-09", new Date(Date.UTC(2026, 8, 1)));

    expect(result?.source).toBe("month");
    expect(result?.error).toBe("一部の日付の取得に失敗しました（404: Not found）");
    expect(Object.values(result?.indicators ?? {})).toEqual(
      Array.from({ length: 30 }, () => ({
        known: false,
        hasData: false,
        bindingsCount: 0,
      })),
    );
    expect(fetchDay).not.toHaveBeenCalled();
  });

  it("does not fall back for an upstream 500", async () => {
    const fetchDay = vi.fn();
    const loader = createLoader({
      fetchMonth: async () => {
        throw new HttpError("Upstream error", 500);
      },
      fetchDay,
    });

    const result = await loader.load("2026-09", new Date(Date.UTC(2026, 8, 1)));

    expect(result?.error).toBe(
      "一部の日付の取得に失敗しました（データの取得に失敗しました。しばらく待ってから再試行してください）",
    );
    expect(fetchDay).not.toHaveBeenCalled();
  });

  it("exposes cached indicators through peek only after loading", async () => {
    const loader = createLoader({
      fetchMonth: async () => ({ days: [{ date: "2026-09-02", bindingsCount: 1 }] }),
    });
    const september = new Date(Date.UTC(2026, 8, 1));

    expect(loader.peek("2026-09")).toBeNull();
    const result = await loader.load("2026-09", september);
    expect(loader.peek("2026-09")).toBe(result?.indicators);
  });

  it("lets a cache hit invalidate an older in-flight load", async () => {
    const septemberRequest = deferred<{ days: Array<{ date: string; bindingsCount: number }> }>();
    const octoberRequest = deferred<{ days: Array<{ date: string; bindingsCount: number }> }>();
    const fetchMonth = vi.fn((key: string) =>
      key === "2026-09" ? septemberRequest.promise : octoberRequest.promise,
    );
    const loader = createLoader({ fetchMonth });
    const september = new Date(Date.UTC(2026, 8, 1));
    const october = new Date(Date.UTC(2026, 9, 1));

    const octoberLoad = loader.load("2026-10", october);
    octoberRequest.resolve({ days: [] });
    await octoberLoad;

    const septemberLoad = loader.load("2026-09", september);
    const cachedOctober = loader.load("2026-10", october);
    expect(await cachedOctober).not.toBeNull();
    septemberRequest.resolve({ days: [{ date: "2026-09-01", bindingsCount: 2 }] });

    expect(await septemberLoad).toBeNull();
    expect(loader.peek("2026-09")).toBeNull();
  });

  it("drops an overlapping load that resolves after the newer month", async () => {
    const septemberRequest = deferred<{ days: Array<{ date: string; bindingsCount: number }> }>();
    const octoberRequest = deferred<{ days: Array<{ date: string; bindingsCount: number }> }>();
    const loader = createLoader({
      fetchMonth: (key) =>
        key === "2026-09" ? septemberRequest.promise : octoberRequest.promise,
    });

    const septemberLoad = loader.load("2026-09", new Date(Date.UTC(2026, 8, 1)));
    const octoberLoad = loader.load("2026-10", new Date(Date.UTC(2026, 9, 1)));
    octoberRequest.resolve({ days: [{ date: "2026-10-01", bindingsCount: 1 }] });
    expect(await octoberLoad).not.toBeNull();
    septemberRequest.resolve({ days: [{ date: "2026-09-01", bindingsCount: 1 }] });

    expect(await septemberLoad).toBeNull();
    expect(loader.peek("2026-09")).toBeNull();
    expect(loader.peek("2026-10")?.["2026-10-01"].hasData).toBe(true);
  });

  it("keeps days after JST today+1 known and unmarked when absent", async () => {
    const loader = createLoader({
      fetchMonth: async () => ({ days: [{ date: "2026-09-09", bindingsCount: 3 }] }),
    });

    const result = await loader.load("2026-09", new Date(Date.UTC(2026, 8, 1)));

    expect(result?.indicators["2026-09-09"]).toEqual({
      known: true,
      hasData: true,
      bindingsCount: 3,
    });
    expect(result?.indicators["2026-09-11"]).toEqual({
      known: true,
      hasData: false,
      bindingsCount: 0,
    });
    expect(result?.error).toBeNull();
  });
});
