import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  verifySharedCookie: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth/options", () => ({ authOptions: {} }));
vi.mock("@/lib/auth/shared-newspaper", () => ({
  SHARED_COOKIE_NAME: "np_shared",
  verifySharedCookie: mocks.verifySharedCookie,
}));

import { GET as getLatest } from "@/app/api/bff/newsletter-editions/latest/route";
import { GET as getMonth } from "@/app/api/bff/newsletter-editions/month/route";
import { __resetPublicThrottleForTests } from "@/lib/bff/public-throttle";

function req(path: string, headers?: HeadersInit): NextRequest {
  return new NextRequest(`https://reader.example${path}`, { headers });
}

function configurePublic(): void {
  vi.stubEnv("NEWSPAPER_PUBLIC", "1");
  vi.stubEnv("RAILWAY_API_BASE_URL", "https://railway.example");
  vi.stubEnv("NEWSLETTER_API_KEY", "short-key");
}

function monthBody(days: unknown[] = []) {
  return {
    meta: {
      month: "2026-09",
      timeZoneForDateParam: "Asia/Tokyo",
      status: "published",
    },
    days,
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

function authenticatedSession(): void {
  vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
  mocks.getServerSession.mockResolvedValue({ user: { email: "allowed@example.com" } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T15:00:00.000Z"));
  mocks.getServerSession.mockReset().mockResolvedValue(null);
  mocks.verifySharedCookie.mockReset().mockResolvedValue(false);
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  __resetPublicThrottleForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetPublicThrottleForTests();
});

describe("newsletter month reader BFF", () => {
  it("keeps public-off anonymous requests at 401", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    const response = await getMonth(req("/api/bff/newsletter-editions/month?month=2026-09"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it.each([
    "/api/bff/newsletter-editions/month",
    "/api/bff/newsletter-editions/month?month=2026-9",
    "/api/bff/newsletter-editions/month?month=2019-12",
    "/api/bff/newsletter-editions/month?month=2026-10",
  ])("rejects invalid or out-of-window public month %s", async (path) => {
    configurePublic();
    const response = await getMonth(req(path));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid query" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("forwards only month plus the pinned published status for public callers", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(jsonResponse(monthBody()));
    const response = await getMonth(
      req("/api/bff/newsletter-editions/month?month=2026-09&status=draft&projection=full&foo=1"),
    );

    expect(response.status).toBe(200);
    const upstream = new URL(String(mocks.fetch.mock.calls[0]?.[0]));
    expect(upstream.origin).toBe("https://railway.example");
    expect(upstream.pathname).toBe("/api/newsletter-editions/month");
    expect(upstream.searchParams.toString()).toBe("month=2026-09&status=published");
    expect(mocks.fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      cache: "no-store",
      headers: { Authorization: "Bearer short-key", Accept: "application/json" },
    });
    expect(mocks.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("pins the raw anonymous shape and filters unsafe days", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(
      jsonResponse({
        meta: { ...monthBody().meta, debug: "internal" },
        days: [
          { date: "2026-09-08", status: "published", bindingsCount: 2, debug: "internal" },
          { date: "2026-09-09", status: "draft", bindingsCount: 3 },
          { date: "2026-08-31", status: "published", bindingsCount: 4 },
          { date: "2026-09-31", status: "published", bindingsCount: 5 },
          { date: "2026-09-10", status: "published", bindingsCount: 1.5 },
          { date: "2026-09-14", status: "published", bindingsCount: 6 },
        ],
        internal: true,
      }),
    );

    const response = await getMonth(
      req("/api/bff/newsletter-editions/month?month=2026-09"),
    );
    const raw = await response.text();
    const body = JSON.parse(raw);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      meta: {
        month: "2026-09",
        timeZoneForDateParam: "Asia/Tokyo",
        status: "published",
      },
      days: [{ date: "2026-09-08", bindingsCount: 2 }],
    });
    expect(Object.keys(body.meta)).toEqual(["month", "timeZoneForDateParam", "status"]);
    expect(Object.keys(body.days[0])).toEqual(["date", "bindingsCount"]);
  });

  it("keeps an empty month as 200 without changing its shape", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(jsonResponse(monthBody([])));
    const response = await getMonth(
      req("/api/bff/newsletter-editions/month?month=2026-09"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).days).toEqual([]);
  });

  it("rejects 32 raw rows before filtering droppable entries", async () => {
    configurePublic();
    const rows = Array.from({ length: 32 }, (_, index) => ({
      date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
      status: index < 30 ? "draft" : "published",
      bindingsCount: index,
    }));
    mocks.fetch.mockResolvedValue(jsonResponse(monthBody(rows)));
    const response = await getMonth(
      req("/api/bff/newsletter-editions/month?month=2026-09"),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Bad upstream response" });
  });

  it.each([
    ["a mismatched month", JSON.stringify({ ...monthBody(), meta: { ...monthBody().meta, month: "2026-08" } })],
    ["malformed JSON", "{"],
    ["a non-object body", "null"],
  ])("returns 502 for %s", async (_label, body) => {
    configurePublic();
    mocks.fetch.mockResolvedValue(new Response(body, { status: 200 }));
    const response = await getMonth(
      req("/api/bff/newsletter-editions/month?month=2026-09"),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Bad upstream response" });
  });

  it("normalizes upstream 404 with the fallback discriminator in every auth mode", async () => {
    configurePublic();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.fetch.mockImplementation(async () => new Response("missing", { status: 404 }));

    for (const mode of ["public", "session"] as const) {
      if (mode === "session") authenticatedSession();
      const response = await getMonth(
        req("/api/bff/newsletter-editions/month?month=2026-09"),
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(
        '{"error":"Month summary not found","code":"UPSTREAM_ROUTE_MISSING"}',
      );
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(response.headers.get("x-bff-upstream")).toBe("/api/newsletter-editions/month");
      expect(response.headers.get("x-bff-month-fallback")).toBe("upstream-route-missing");
    }
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it.each([
    [429, { error: "Too many requests" }, 429],
    [400, { error: "Upstream error" }, 502],
    [500, { error: "Upstream error" }, 502],
  ])("normalizes anonymous upstream %i without leaking its body", async (status, body, expectedStatus) => {
    configurePublic();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.fetch.mockResolvedValue(
      jsonResponse({ error: "x", editionId: "internal-7" }, { status }),
    );
    const response = await getMonth(
      req("/api/bff/newsletter-editions/month?month=2026-09"),
    );
    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual(body);
    expect(response.headers.get("x-bff-upstream")).toBe("/api/newsletter-editions/month");
    if (status === 429) expect(response.headers.get("retry-after")).toBe("60");
    expect(console.warn).toHaveBeenCalledWith(
      `[bff-newsletter-month] upstream ${status} normalised for anonymous reader`,
    );
  });

  it("passes session status and non-404 responses through without public projection", async () => {
    configurePublic();
    authenticatedSession();
    const upstreamBody = { meta: { month: "2026-09" }, days: [{ status: "draft" }], internal: true };
    mocks.fetch.mockResolvedValue(jsonResponse(upstreamBody, { status: 418 }));
    const response = await getMonth(
      req("/api/bff/newsletter-editions/month?month=2026-09&status=published&foo=1"),
    );
    expect(response.status).toBe(418);
    expect(await response.json()).toEqual(upstreamBody);
    const upstream = new URL(String(mocks.fetch.mock.calls[0]?.[0]));
    expect(upstream.searchParams.toString()).toBe("month=2026-09&status=published");
  });

  it("drops unsupported session status instead of forwarding it", async () => {
    configurePublic();
    authenticatedSession();
    mocks.fetch.mockResolvedValue(jsonResponse(monthBody()));
    await getMonth(
      req("/api/bff/newsletter-editions/month?month=2026-09&status=draft&foo=1"),
    );
    expect(new URL(String(mocks.fetch.mock.calls[0]?.[0])).searchParams.toString()).toBe(
      "month=2026-09",
    );
  });

  it("returns the public fetch-failure body without a detail key", async () => {
    configurePublic();
    mocks.fetch.mockRejectedValue(new Error("private network detail"));
    const response = await getMonth(
      req("/api/bff/newsletter-editions/month?month=2026-09"),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Upstream error" });
  });

  it("keeps the session fetch-failure body aligned with latest", async () => {
    configurePublic();
    authenticatedSession();
    mocks.fetch.mockRejectedValue(new Error("network failed"));
    const response = await getMonth(
      req("/api/bff/newsletter-editions/month?month=2026-09"),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Failed to reach Railway API from BFF route",
      detail: "network failed",
    });
  });

  it("returns the same configuration errors as latest", async () => {
    configurePublic();
    vi.stubEnv("RAILWAY_API_BASE_URL", "");
    let response = await getMonth(req("/api/bff/newsletter-editions/month?month=2026-09"));
    expect(await response.json()).toEqual({ error: "BFF misconfigured: set RAILWAY_API_BASE_URL" });

    vi.stubEnv("RAILWAY_API_BASE_URL", "https://railway.example");
    vi.stubEnv("NEWSLETTER_API_KEY", "");
    response = await getMonth(req("/api/bff/newsletter-editions/month?month=2026-09"));
    expect(await response.json()).toEqual({
      error: "BFF misconfigured: set NEWSLETTER_API_KEY (or DIGEST_API_KEY / FEED_API_KEY)",
    });
  });

  it("keeps newsletter-month independent after all 240 newsletter slots are consumed", async () => {
    configurePublic();
    mocks.fetch.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      return path.endsWith("/month")
        ? jsonResponse(monthBody())
        : jsonResponse({ edition: { status: "published" } });
    });
    const headers = { "x-forwarded-for": "203.0.113.151" };
    const latestRequest = req("/api/bff/newsletter-editions/latest", headers);
    for (let count = 0; count < 240; count += 1) {
      expect((await getLatest(latestRequest)).status).toBe(200);
    }

    const monthResponse = await getMonth(
      req("/api/bff/newsletter-editions/month?month=2026-09", headers),
    );
    expect(monthResponse.status).toBe(200);
  });

  it("does not consume newsletter slots while exhausting newsletter-month", async () => {
    configurePublic();
    mocks.fetch.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      return path.endsWith("/month")
        ? jsonResponse(monthBody())
        : jsonResponse({ edition: { status: "published" } });
    });
    const headers = { "x-forwarded-for": "203.0.113.152" };
    const monthRequest = req("/api/bff/newsletter-editions/month?month=2026-09", headers);
    for (let count = 0; count < 60; count += 1) {
      expect((await getMonth(monthRequest)).status).toBe(200);
    }
    const throttled = await getMonth(monthRequest);
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("retry-after")).toBe("60");

    const latestResponse = await getLatest(
      req("/api/bff/newsletter-editions/latest", headers),
    );
    expect(latestResponse.status).toBe(200);
  });
});
