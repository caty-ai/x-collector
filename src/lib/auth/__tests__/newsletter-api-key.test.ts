import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  denyUnlessNewsletterBearer,
  resetNewsletterBearerWarningsForTests,
  resolveNewsletterApiKeyFromEnv,
} from "@/lib/auth/newsletter-api-key";

const logTag = "newsletter-helper-test";

function clearConfiguredBearers() {
  vi.stubEnv("NEWSLETTER_API_KEY", "");
  vi.stubEnv("DIGEST_API_KEY", "");
  vi.stubEnv("FEED_API_KEY", "");
}

beforeEach(() => {
  clearConfiguredBearers();
  resetNewsletterBearerWarningsForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("newsletter API key authorization", () => {
  it("resolves configured Bearer values in NEWSLETTER, DIGEST, FEED order", () => {
    vi.stubEnv("NEWSLETTER_API_KEY", " newsletter-value ");
    vi.stubEnv("DIGEST_API_KEY", " digest-value ");
    vi.stubEnv("FEED_API_KEY", " feed-value ");
    expect(resolveNewsletterApiKeyFromEnv()).toBe("newsletter-value");

    vi.stubEnv("NEWSLETTER_API_KEY", "");
    expect(resolveNewsletterApiKeyFromEnv()).toBe("digest-value");

    vi.stubEnv("DIGEST_API_KEY", "");
    expect(resolveNewsletterApiKeyFromEnv()).toBe("feed-value");
  });

  it("fails closed in production without a configured Bearer", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = denyUnlessNewsletterBearer(new Request("https://api.example/test"), {
      logTag,
    });

    expect(response?.status).toBe(401);
    expect(await response?.text()).toBe(JSON.stringify({ error: "api key not configured" }));
  });

  it("rejects a wrong Bearer value", async () => {
    vi.stubEnv("NEWSLETTER_API_KEY", "expected-value");
    const response = denyUnlessNewsletterBearer(
      new Request("https://api.example/test", {
        headers: { Authorization: "Bearer wrong-value" },
      }),
      { logTag },
    );

    expect(response?.status).toBe(401);
    expect(await response?.text()).toBe(
      JSON.stringify({
        error: "Unauthorized. Provide header: Authorization: Bearer <API_KEY>",
      }),
    );
  });

  it("rejects a missing Authorization header", async () => {
    vi.stubEnv("NEWSLETTER_API_KEY", "expected-value");
    const response = denyUnlessNewsletterBearer(new Request("https://api.example/test"), {
      logTag,
    });

    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({
      error: "Unauthorized. Provide header: Authorization: Bearer <API_KEY>",
    });
  });

  it("stays open outside production and warns once per tag", () => {
    vi.stubEnv("NODE_ENV", "test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const request = new Request("https://api.example/test");

    expect(
      denyUnlessNewsletterBearer(request, { logTag }),
    ).toBeNull();
    expect(
      denyUnlessNewsletterBearer(request, { logTag }),
    ).toBeNull();
    expect(
      denyUnlessNewsletterBearer(request, { logTag: "newsletter-helper-other-test" }),
    ).toBeNull();

    expect(warn.mock.calls).toEqual([
      [
        "[newsletter-helper-test] API auth disabled outside production; missing env: NEWSLETTER_API_KEY | DIGEST_API_KEY | FEED_API_KEY",
      ],
      [
        "[newsletter-helper-other-test] API auth disabled outside production; missing env: NEWSLETTER_API_KEY | DIGEST_API_KEY | FEED_API_KEY",
      ],
    ]);
  });

  it("accepts a case-insensitive Bearer prefix", () => {
    vi.stubEnv("NEWSLETTER_API_KEY", "expected-value");

    expect(
      denyUnlessNewsletterBearer(
        new Request("https://api.example/test", {
          headers: { Authorization: "bEaReR expected-value" },
        }),
        { logTag },
      ),
    ).toBeNull();
  });
});
