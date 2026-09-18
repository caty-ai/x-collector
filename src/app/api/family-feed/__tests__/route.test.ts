import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { resetBearerGateWarningsForTests } from "@/lib/auth/bearer-gate";

const mocks = vi.hoisted(() => ({
  pipelineClassificationFindMany: vi.fn(),
  pipelineCrosslinkLlmDecisionFindMany: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@prisma/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@prisma/client")>()),
  PrismaClient: class {
    pipelineClassification = { findMany: mocks.pipelineClassificationFindMany };
    pipelineCrosslinkLlmDecision = { findMany: mocks.pipelineCrosslinkLlmDecisionFindMany };
    $queryRaw = mocks.queryRaw;
  },
}));

import { GET } from "@/app/api/family-feed/route";

function req(authorization = "Bearer test-key", extra = ""): NextRequest {
  return new NextRequest(`https://api.example/api/family-feed?platform=twitter${extra}`, {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetBearerGateWarningsForTests();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FAMILY_FEED_API_KEY", "test-key");
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

describe("family-feed Bearer authorization", () => {
  it("fails closed in production without a configured key", async () => {
    vi.stubEnv("FAMILY_FEED_API_KEY", "");
    await expectDenied(await GET(req("")), "api key not configured");
  });

  it("rejects a wrong Bearer", async () => {
    await expectDenied(await GET(req("Bearer wrong")), "Unauthorized. Provide header: Authorization: Bearer <FAMILY_FEED_API_KEY>");
  });

  it("rejects missing Authorization", async () => {
    await expectDenied(await GET(req("")), "Unauthorized. Provide header: Authorization: Bearer <FAMILY_FEED_API_KEY>");
  });

  it("checks auth before parsing invalid parameters", async () => {
    await expectDenied(await GET(req("Bearer wrong", "&since=garbage")), "Unauthorized. Provide header: Authorization: Bearer <FAMILY_FEED_API_KEY>");
  });

  it("stays open outside production and warns once", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FAMILY_FEED_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let i = 0; i < 2; i += 1) {
      const response = await GET(req(""));
      expect(response.status).toBe(200);
      expect((await response.json()).items).toEqual([]);
    }
    expect(mocks.pipelineClassificationFindMany).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls).toEqual([["[family-feed-api] API auth disabled outside production; missing env: FAMILY_FEED_API_KEY"]]);
  });

  it("accepts a valid Bearer and returns empty items", async () => {
    const response = await GET(req());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([]);
    expect(mocks.pipelineCrosslinkLlmDecisionFindMany).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.pipelineClassificationFindMany).toHaveBeenCalledOnce();
  });

  it("accepts raw Authorization without a scheme", async () => {
    const response = await GET(req("test-key"));
    expect(response.status).toBe(200);
    expect((await response.json()).items).toEqual([]);
    expect(mocks.pipelineClassificationFindMany).toHaveBeenCalledOnce();
  });

  it("reads and trims the configured value on each request", async () => {
    vi.stubEnv("FAMILY_FEED_API_KEY", " changed-key ");
    await expectDenied(await GET(req()), "Unauthorized. Provide header: Authorization: Bearer <FAMILY_FEED_API_KEY>");
    expect((await GET(req("Bearer changed-key"))).status).toBe(200);
    expect(mocks.pipelineClassificationFindMany).toHaveBeenCalledOnce();
  });
});
