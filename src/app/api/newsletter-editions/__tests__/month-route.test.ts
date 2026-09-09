import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  editionFindMany: vi.fn(),
}));

vi.mock("@prisma/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@prisma/client")>()),
  PrismaClient: class {
    newsletterEdition = { findMany: mocks.editionFindMany };
  },
}));

import { GET } from "@/app/api/newsletter-editions/month/route";

function req(query: string, authorization = "Bearer test-key"): NextRequest {
  return new NextRequest(`https://api.example/api/newsletter-editions/month${query}`, {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

function row(
  editionDate: string,
  updatedAt: string,
  bindingsCount: number,
  status = "published",
) {
  return {
    editionDate: new Date(editionDate),
    updatedAt: new Date(updatedAt),
    status,
    _count: { bindings: bindingsCount },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEWSLETTER_API_KEY", "test-key");
  mocks.editionFindMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("newsletter month upstream route", () => {
  it.each([
    ["2026-09", "2026-08-31T15:00:00.000Z", "2026-09-30T14:59:59.999Z"],
    ["2026-12", "2026-11-30T15:00:00.000Z", "2026-12-31T14:59:59.999Z"],
    ["2028-02", "2028-01-31T15:00:00.000Z", "2028-02-29T14:59:59.999Z"],
  ])("queries exact JST bounds for %s", async (month, start, end) => {
    const response = await GET(req(`?month=${month}&status=published`));

    expect(response.status).toBe(200);
    expect(mocks.editionFindMany).toHaveBeenCalledWith({
      where: {
        editionDate: { gte: new Date(start), lte: new Date(end) },
        status: "published",
      },
      select: {
        editionDate: true,
        status: true,
        updatedAt: true,
        _count: { select: { bindings: true } },
      },
      orderBy: [{ editionDate: "asc" }, { updatedAt: "desc" }],
    });
  });

  it("omits the status predicate and reports null when status is absent", async () => {
    const response = await GET(req("?month=2026-09"));

    expect(mocks.editionFindMany.mock.calls[0]?.[0].where).toEqual({
      editionDate: {
        gte: new Date("2026-08-31T15:00:00.000Z"),
        lte: new Date("2026-09-30T14:59:59.999Z"),
      },
    });
    expect((await response.json()).meta.status).toBeNull();
  });

  it("emits sparse sorted JST labels and keeps the newest updated collision", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.editionFindMany.mockResolvedValue([
      row("2026-09-07T15:00:00.000Z", "2026-09-08T00:00:00.000Z", 1),
      row("2026-09-08T00:00:00.000Z", "2026-09-08T02:00:00.000Z", 4),
      row("2026-09-06T15:00:00.000Z", "2026-09-07T02:00:00.000Z", 2, "draft"),
    ]);

    const response = await GET(req("?month=2026-09"));

    expect(await response.json()).toEqual({
      meta: {
        month: "2026-09",
        timeZoneForDateParam: "Asia/Tokyo",
        status: null,
      },
      days: [
        { date: "2026-09-07", status: "draft", bindingsCount: 2 },
        { date: "2026-09-08", status: "published", bindingsCount: 4 },
      ],
    });
    expect(console.warn).toHaveBeenCalledWith(
      "[newsletter-month-api] multiple editions map to JST date 2026-09-08",
    );
  });

  it("returns 200 with an empty sparse month", async () => {
    const response = await GET(req("?month=2026-09&status=published"));
    expect(response.status).toBe(200);
    expect((await response.json()).days).toEqual([]);
  });

  it.each(["", "?month=2026-9", "?month=2026-13"])(
    "rejects an invalid or missing month: %s",
    async (query) => {
      const response = await GET(req(query));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid month format. Use YYYY-MM" });
      expect(mocks.editionFindMany).not.toHaveBeenCalled();
    },
  );

  it("rejects an unsupported status", async () => {
    const response = await GET(req("?month=2026-09&status=draft"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid status. Use status=published" });
    expect(mocks.editionFindMany).not.toHaveBeenCalled();
  });

  it("fails closed in production without a configured key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEWSLETTER_API_KEY", "");
    vi.stubEnv("DIGEST_API_KEY", "");
    vi.stubEnv("FEED_API_KEY", "");

    const response = await GET(req("?month=2026-09", ""));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "api key not configured" });
  });

  it("rejects a wrong Bearer value", async () => {
    const response = await GET(req("?month=2026-09", "Bearer wrong"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unauthorized. Provide header: Authorization: Bearer <API_KEY>",
    });
  });

  it("stays open outside production when no key is configured", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEWSLETTER_API_KEY", "");
    vi.stubEnv("DIGEST_API_KEY", "");
    vi.stubEnv("FEED_API_KEY", "");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await GET(req("?month=2026-09", ""));
    expect(response.status).toBe(200);
    expect(mocks.editionFindMany).toHaveBeenCalledTimes(1);
  });
});
