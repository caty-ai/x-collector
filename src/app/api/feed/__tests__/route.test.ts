import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { resetBearerGateWarningsForTests } from "@/lib/auth/bearer-gate";

const mocks = vi.hoisted(() => ({
  tweetFindMany: vi.fn(),
  igPostFindMany: vi.fn(),
  fbPostFindMany: vi.fn(),
  redditPostFindMany: vi.fn(),
  qiitaItemFindMany: vi.fn(),
  ghItemFindMany: vi.fn(),
  alertEntryFindMany: vi.fn(),
}));

vi.mock("@prisma/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@prisma/client")>()),
  PrismaClient: class {
    tweet = { findMany: mocks.tweetFindMany };
    igPost = { findMany: mocks.igPostFindMany };
    fbPost = { findMany: mocks.fbPostFindMany };
    redditPost = { findMany: mocks.redditPostFindMany };
    qiitaItem = { findMany: mocks.qiitaItemFindMany };
    ghItem = { findMany: mocks.ghItemFindMany };
    alertEntry = { findMany: mocks.alertEntryFindMany };
  },
}));

import { GET } from "@/app/api/feed/route";

function req(authorization = "Bearer test-key", extra = ""): NextRequest {
  return new NextRequest(`https://api.example/api/feed?platform=twitter${extra}`, {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetBearerGateWarningsForTests();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FEED_API_KEY", "test-key");
  for (const mock of Object.values(mocks)) mock.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function expectDenied(response: Response, error: string) {
  expect(response.status).toBe(401);
  expect(await response.text()).toBe(JSON.stringify({ error }));
  expect(response.headers.has("www-authenticate")).toBe(false);
  for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
}

describe("feed Bearer authorization", () => {
  it("fails closed in production without a configured key", async () => {
    vi.stubEnv("FEED_API_KEY", "");
    await expectDenied(await GET(req("")), "api key not configured");
  });

  it("rejects a wrong Bearer", async () => {
    await expectDenied(await GET(req("Bearer wrong")), "Unauthorized. Provide header: Authorization: Bearer <FEED_API_KEY>");
  });

  it("rejects missing Authorization", async () => {
    await expectDenied(await GET(req("")), "Unauthorized. Provide header: Authorization: Bearer <FEED_API_KEY>");
  });

  it("checks auth before parsing invalid parameters", async () => {
    await expectDenied(await GET(req("Bearer wrong", "&date=not-a-date")), "Unauthorized. Provide header: Authorization: Bearer <FEED_API_KEY>");
  });

  it("stays open outside production and warns once", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FEED_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let i = 0; i < 2; i += 1) {
      const response = await GET(req(""));
      expect(response.status).toBe(200);
      expect((await response.json()).items).toEqual([]);
    }
    expect(mocks.tweetFindMany).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls).toEqual([["[feed-api] API auth disabled outside production; missing env: FEED_API_KEY"]]);
  });

  it("accepts a valid Bearer and returns empty items", async () => {
    const response = await GET(req());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([]);
    expect(body.meta.platforms).toEqual(["twitter"]);
    expect(mocks.tweetFindMany).toHaveBeenCalledOnce();
  });

  it("accepts raw Authorization without a scheme", async () => {
    const response = await GET(req("test-key"));
    expect(response.status).toBe(200);
    expect((await response.json()).items).toEqual([]);
    expect(mocks.tweetFindMany).toHaveBeenCalledOnce();
  });

  it("reads and trims the configured value on each request", async () => {
    vi.stubEnv("FEED_API_KEY", " changed-key ");
    await expectDenied(await GET(req()), "Unauthorized. Provide header: Authorization: Bearer <FEED_API_KEY>");
    expect((await GET(req("Bearer changed-key"))).status).toBe(200);
    expect(mocks.tweetFindMany).toHaveBeenCalledOnce();
  });
});
