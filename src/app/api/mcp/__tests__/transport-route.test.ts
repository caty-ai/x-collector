import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetBearerGateWarningsForTests } from "@/lib/auth/bearer-gate";

const mocks = vi.hoisted(() => ({
  handler: vi.fn(async (_request: Request) => new Response("ok", { status: 200 })),
  registerMcpTools: vi.fn(),
}));

vi.mock("mcp-handler", () => ({ createMcpHandler: vi.fn(() => mocks.handler) }));
vi.mock("@/lib/mcp/tools", () => ({ registerMcpTools: mocks.registerMcpTools }));

import { GET, POST, DELETE } from "@/app/api/mcp/[transport]/route";

function req(authorization = "Bearer mcp-key", method = "GET") {
  return new Request("https://api.example/api/mcp/mcp", {
    method,
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetBearerGateWarningsForTests();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MCP_API_KEY", "mcp-key");
  vi.stubEnv("FAMILY_FEED_API_KEY", "");
  mocks.handler.mockImplementation(async () => new Response("ok", { status: 200 }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function expectDenied(response: Response, missingConfiguration = false) {
  expect(response.status).toBe(401);
  expect(await response.text()).toBe(JSON.stringify({
    error: missingConfiguration ? "api key not configured" : "Unauthorized. Provide a Bearer token.",
  }));
  expect(response.headers.get("www-authenticate")).toBe(missingConfiguration ? null : "Bearer");
  expect(mocks.handler).not.toHaveBeenCalled();
}

describe("MCP transport Bearer authorization", () => {
  it.each([["GET", GET], ["POST", POST], ["DELETE", DELETE]] as const)("fails closed in production without either key for %s", async (method, route) => {
    vi.stubEnv("MCP_API_KEY", "");
    await expectDenied(await route(req("", method)), true);
  });

  it("stays open outside production and warns once", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("MCP_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let i = 0; i < 2; i += 1) {
      const response = await GET(req(""));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
    }
    expect(mocks.handler).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls).toEqual([["[mcp-api] API auth disabled outside production; missing env: MCP_API_KEY | FAMILY_FEED_API_KEY"]]);
  });

  it.each(["Bearer wrong", "", "mcp-key"])("rejects wrong, missing, or raw Authorization (%s)", async (authorization) => {
    await expectDenied(await GET(req(authorization)));
  });

  it("passes the same request through and returns the handler response", async () => {
    const request = req();
    const expected = new Response("handler response", { status: 202 });
    mocks.handler.mockResolvedValueOnce(expected);
    expect(await GET(request)).toBe(expected);
    expect(mocks.handler).toHaveBeenCalledOnce();
    expect(mocks.handler.mock.calls[0][0]).toBe(request);
  });

  it("prefers MCP over FAMILY_FEED and trims configured values", async () => {
    vi.stubEnv("MCP_API_KEY", " mcp-key ");
    vi.stubEnv("FAMILY_FEED_API_KEY", " family-key ");
    await expectDenied(await GET(req("Bearer family-key")));
    expect((await GET(req())).status).toBe(200);
    expect(mocks.handler).toHaveBeenCalledOnce();
  });

  it.each(["", "   "])("falls back to trimmed FAMILY_FEED when MCP is blank (%j)", async (configuredBearer) => {
    vi.stubEnv("MCP_API_KEY", configuredBearer);
    vi.stubEnv("FAMILY_FEED_API_KEY", " family-key ");
    const request = req("Bearer family-key");
    expect((await GET(request)).status).toBe(200);
    expect(mocks.handler).toHaveBeenCalledOnce();
    expect(mocks.handler.mock.calls[0][0]).toBe(request);
  });

  it("accepts a lower-case Bearer scheme", async () => {
    expect((await GET(req("bearer mcp-key"))).status).toBe(200);
    expect(mocks.handler).toHaveBeenCalledOnce();
  });

  it.each([["POST", POST], ["DELETE", DELETE]] as const)("gates denied and allowed %s requests identically", async (method, route) => {
    await expectDenied(await route(req("Bearer wrong", method)));
    const request = req("Bearer mcp-key", method);
    expect((await route(request)).status).toBe(200);
    expect(mocks.handler).toHaveBeenCalledOnce();
    expect(mocks.handler.mock.calls[0][0]).toBe(request);
  });
});
