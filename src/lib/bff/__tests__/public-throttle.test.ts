import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  __resetPublicThrottleForTests,
  consumePublicThrottle,
} from "@/lib/bff/public-throttle";

afterEach(() => {
  vi.unstubAllEnvs();
  __resetPublicThrottleForTests();
});

function request(ip?: string): NextRequest {
  return new NextRequest("https://reader.example/api/bff/test", {
    headers: ip ? { "x-forwarded-for": `${ip}, 10.0.0.1` } : undefined,
  });
}

describe("public throttle", () => {
  it("rejects the 241st request within one minute", () => {
    const req = request("203.0.113.1");
    for (let count = 0; count < 240; count += 1) {
      expect(consumePublicThrottle(req, "newsletter", 240, 60_000, 1_000)).toBe(true);
    }
    expect(consumePublicThrottle(req, "newsletter", 240, 60_000, 1_000)).toBe(false);
  });

  it("tracks separate IPs independently", () => {
    const first = request("203.0.113.2");
    expect(consumePublicThrottle(first, "og", 1, 60_000, 1_000)).toBe(true);
    expect(consumePublicThrottle(first, "og", 1, 60_000, 1_000)).toBe(false);
    expect(consumePublicThrottle(request("203.0.113.3"), "og", 1, 60_000, 1_000)).toBe(true);
  });

  it("resets after the window expires", () => {
    const req = request();
    expect(consumePublicThrottle(req, "og", 1, 60_000, 1_000)).toBe(true);
    expect(consumePublicThrottle(req, "og", 1, 60_000, 61_000)).toBe(true);
  });
});
