import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { denyUnlessBearer, resetBearerGateWarningsForTests, type BearerGateSpec } from "@/lib/auth/bearer-gate";

const spec: BearerGateSpec = {
  logTag: "gate-test",
  resolveConfiguredBearer: () => "test-key",
  missingEnvHint: "FIRST_KEY | SECOND_KEY",
  unauthorizedBody: { error: "custom unauthorized", code: 42 },
};

function req(authorization?: string) {
  return new Request("https://api.example/test", {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetBearerGateWarningsForTests();
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("generic Bearer gate", () => {
  it("reads production at call time and fails closed without warning or challenge headers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const missing = { ...spec, resolveConfiguredBearer: () => undefined, unauthorizedHeaders: { "WWW-Authenticate": "Bearer" } };
    vi.stubEnv("NODE_ENV", "production");
    const response = denyUnlessBearer(req(), missing);
    expect(response?.status).toBe(401);
    expect(await response?.text()).toBe('{"error":"api key not configured"}');
    expect(response?.headers.has("www-authenticate")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "test");
    expect(denyUnlessBearer(req(), missing)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("warns once per tag outside production and reset re-arms warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const missing = { ...spec, resolveConfiguredBearer: () => undefined };
    expect(denyUnlessBearer(req(), missing)).toBeNull();
    expect(denyUnlessBearer(req(), missing)).toBeNull();
    expect(denyUnlessBearer(req(), { ...missing, logTag: "other" })).toBeNull();
    expect(warn.mock.calls).toEqual([
      ["[gate-test] API auth disabled outside production; missing env: FIRST_KEY | SECOND_KEY"],
      ["[other] API auth disabled outside production; missing env: FIRST_KEY | SECOND_KEY"],
    ]);
    resetBearerGateWarningsForTests();
    expect(denyUnlessBearer(req(), missing)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenLastCalledWith("[gate-test] API auth disabled outside production; missing env: FIRST_KEY | SECOND_KEY");
  });

  it.each([undefined, { "WWW-Authenticate": "Bearer" }])("returns the configured body and optional headers for a missing header (%j)", async (unauthorizedHeaders) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = denyUnlessBearer(req(), { ...spec, unauthorizedHeaders });
    expect(response?.status).toBe(401);
    expect(await response?.text()).toBe(JSON.stringify(spec.unauthorizedBody));
    expect(response?.headers.get("www-authenticate")).toBe(unauthorizedHeaders ? "Bearer" : null);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects a wrong value and accepts a correct Bearer", async () => {
    const response = denyUnlessBearer(req("Bearer wrong"), spec);
    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual(spec.unauthorizedBody);
    expect(denyUnlessBearer(req("Bearer test-key"), spec)).toBeNull();
  });

  it.each([undefined, false])("accepts raw Authorization when requireBearerScheme is %s", (requireBearerScheme) => {
    expect(denyUnlessBearer(req("test-key"), { ...spec, requireBearerScheme })).toBeNull();
  });

  it("requires the scheme when requested and accepts a lower-case scheme", async () => {
    const strict = { ...spec, requireBearerScheme: true };
    const response = denyUnlessBearer(req("test-key"), strict);
    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual(spec.unauthorizedBody);
    expect(denyUnlessBearer(req("bearer test-key"), strict)).toBeNull();
  });

  it("resolves the configured Bearer on every request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const resolveConfiguredBearer = vi.fn<() => string | undefined>()
      .mockReturnValueOnce(undefined).mockReturnValueOnce("test-key");
    const dynamic = { ...spec, resolveConfiguredBearer };
    expect(denyUnlessBearer(req("Bearer test-key"), dynamic)?.status).toBe(401);
    expect(denyUnlessBearer(req("Bearer test-key"), dynamic)).toBeNull();
    expect(resolveConfiguredBearer).toHaveBeenCalledTimes(2);
  });
});
