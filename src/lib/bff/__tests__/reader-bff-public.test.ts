import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  verifySharedCookie: vi.fn(),
  resolveOgImage: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth/options", () => ({ authOptions: {} }));
vi.mock("@/lib/auth/shared-newspaper", () => ({
  SHARED_COOKIE_NAME: "np_shared",
  verifySharedCookie: mocks.verifySharedCookie,
}));
vi.mock("@/lib/bff/og-image", () => ({ resolveOgImage: mocks.resolveOgImage }));

import { GET as getFeed } from "@/app/api/bff/feed/route";
import { GET as getNewsletter } from "@/app/api/bff/newsletter-editions/latest/route";
import { GET as getOgImage } from "@/app/api/bff/og-image/route";
import { __resetEditionUrlCacheForTests } from "@/lib/bff/og-image-guard";
import { __resetPublicThrottleForTests } from "@/lib/bff/public-throttle";

function req(path: string, headers?: HeadersInit): NextRequest {
  return new NextRequest(`https://reader.example${path}`, { headers });
}

function configurePublic(): void {
  vi.stubEnv("NEWSPAPER_PUBLIC", "1");
  vi.stubEnv("RAILWAY_API_BASE_URL", "https://railway.example");
  vi.stubEnv("NEWSLETTER_API_KEY", "short-key");
}

function publishedMarkdown(markdown: string): Response {
  return new Response(markdown, {
    status: 200,
    headers: { "content-type": "text/markdown", "x-edition-status": "published" },
  });
}

function authenticatedCaller(mode: "session" | "shared"): void {
  if (mode === "session") {
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
    mocks.getServerSession.mockResolvedValue({ user: { email: "allowed@example.com" } });
    return;
  }

  mocks.verifySharedCookie.mockResolvedValue(true);
}

function public404Shape(response: Response) {
  return {
    contentType: response.headers.get("content-type"),
    upstream: response.headers.get("x-bff-upstream"),
    keys: [...response.headers.keys()].sort(),
  };
}

beforeEach(() => {
  mocks.getServerSession.mockReset().mockResolvedValue(null);
  mocks.verifySharedCookie.mockReset().mockResolvedValue(false);
  mocks.resolveOgImage.mockReset().mockResolvedValue("https://images.example/og.png");
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  __resetEditionUrlCacheForTests();
  __resetPublicThrottleForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  __resetEditionUrlCacheForTests();
  __resetPublicThrottleForTests();
});

describe("newsletter reader BFF", () => {
  it("keeps public-off anonymous requests at 401", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    expect((await getNewsletter(req("/api/bff/newsletter-editions/latest"))).status).toBe(401);
  });

  it("allows the existing shared-cookie path unchanged when public is off", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    vi.stubEnv("RAILWAY_API_BASE_URL", "https://railway.example");
    vi.stubEnv("NEWSLETTER_API_KEY", "short-key");
    mocks.verifySharedCookie.mockResolvedValue(true);
    mocks.fetch.mockResolvedValue(
      new Response("draft markdown", {
        status: 200,
        headers: { "content-type": "text/markdown", "x-edition-status": "draft" },
      }),
    );
    const response = await getNewsletter(
      req("/api/bff/newsletter-editions/latest?format=markdown&slug=draft-slug"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("draft markdown");
    expect(String(mocks.fetch.mock.calls[0]?.[0])).toContain("slug=draft-slug");
  });

  it("rejects a non-allowlisted session when public and shared access are off", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
    mocks.getServerSession.mockResolvedValue({ user: { email: "intruder@example.com" } });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect((await getNewsletter(req("/api/bff/newsletter-editions/latest"))).status).toBe(401);
  });

  it("keeps shared-cookie access for a non-allowlisted session", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
    vi.stubEnv("RAILWAY_API_BASE_URL", "https://railway.example");
    vi.stubEnv("NEWSLETTER_API_KEY", "short-key");
    mocks.getServerSession.mockResolvedValue({ user: { email: "intruder@example.com" } });
    mocks.verifySharedCookie.mockResolvedValue(true);
    mocks.fetch.mockResolvedValue(new Response("shared markdown", { status: 200 }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await getNewsletter(req("/api/bff/newsletter-editions/latest?format=markdown"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("shared markdown");
    expect(console.warn).toHaveBeenCalledWith(
      "[bff-auth] deny email=in***@example.com reason=allowlist_miss",
    );
  });

  it("forwards only validated anonymous parameters and drops slug/unknown keys", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ edition: { status: "published" } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const response = await getNewsletter(
      req(
        "/api/bff/newsletter-editions/latest?date=2026-08-01&format=json&includeContent=1&includeItems=0&slug=secret&foo=1",
      ),
    );
    expect(response.status).toBe(200);
    const upstream = new URL(String(mocks.fetch.mock.calls[0]?.[0]));
    expect(upstream.searchParams.toString()).toBe(
      "date=2026-08-01&includeContent=1&includeItems=0",
    );
  });

  it("rejects invalid anonymous values before fetch", async () => {
    configurePublic();
    const response = await getNewsletter(
      req("/api/bff/newsletter-editions/latest?date=2026-02-31&includeItems=yes"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid query" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps session slug pass-through even when the switch is on", async () => {
    configurePublic();
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
    mocks.getServerSession.mockResolvedValue({ user: { email: "allowed@example.com" } });
    mocks.fetch.mockResolvedValue(new Response("draft unchanged", { status: 200 }));
    const response = await getNewsletter(
      req("/api/bff/newsletter-editions/latest?slug=draft-slug&format=markdown"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("draft unchanged");
    expect(String(mocks.fetch.mock.calls[0]?.[0])).toContain("slug=draft-slug");
    expect(mocks.verifySharedCookie).not.toHaveBeenCalled();
  });

  it("hides draft markdown and JSON from anonymous public callers", async () => {
    configurePublic();
    mocks.fetch
      .mockResolvedValueOnce(
        new Response("draft markdown", {
          headers: { "x-edition-status": "draft", "content-type": "text/markdown" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ edition: { status: "draft" } }), {
          headers: { "content-type": "application/json" },
        }),
      );
    for (const suffix of ["?format=markdown", "?format=json"]) {
      const response = await getNewsletter(req(`/api/bff/newsletter-editions/latest${suffix}`));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Edition not found" });
    }
  });

  it("normalizes upstream anonymous 404 bodies to one indistinguishable public response", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(
      new Response('{"error":"Edition exists but contentMd is empty"}', {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await getNewsletter(req("/api/bff/newsletter-editions/latest"));

    expect(response.status).toBe(404);
    expect(public404Shape(response)).toEqual({
      contentType: "application/json; charset=utf-8",
      upstream: "/api/newsletter-editions/latest",
      keys: ["content-type", "x-bff-upstream"],
    });
    expect(await response.text()).toBe('{"error":"Edition not found"}');
  });

  it("returns the exact same anonymous 404 for draft editions and upstream 404s", async () => {
    configurePublic();
    mocks.fetch
      .mockResolvedValueOnce(
        new Response('{"error":"Edition exists but contentMd is empty"}', {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{"error":"Edition not found"}', {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ edition: { status: "draft" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const upstream404 = await getNewsletter(req("/api/bff/newsletter-editions/latest"));
    const missing404 = await getNewsletter(req("/api/bff/newsletter-editions/latest"));
    const draft404 = await getNewsletter(req("/api/bff/newsletter-editions/latest?format=json"));

    expect(missing404.status).toBe(upstream404.status);
    expect(draft404.status).toBe(upstream404.status);
    expect(public404Shape(missing404)).toEqual(public404Shape(upstream404));
    expect(public404Shape(draft404)).toEqual(public404Shape(upstream404));
    expect(await upstream404.text()).toBe('{"error":"Edition not found"}');
    expect(await missing404.text()).toBe('{"error":"Edition not found"}');
    expect(await draft404.text()).toBe('{"error":"Edition not found"}');
  });

  it("keeps shared upstream 404 bodies verbatim", async () => {
    configurePublic();
    mocks.verifySharedCookie.mockResolvedValue(true);
    mocks.fetch.mockResolvedValue(
      new Response('{"error":"Edition exists but contentMd is empty"}', {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await getNewsletter(req("/api/bff/newsletter-editions/latest"));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-bff-upstream")).toBe("/api/newsletter-editions/latest");
    expect(await response.text()).toBe('{"error":"Edition exists but contentMd is empty"}');
  });

  it("forwards published markdown unchanged", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(publishedMarkdown("# Published"));
    const response = await getNewsletter(
      req("/api/bff/newsletter-editions/latest?format=markdown"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("# Published");
  });

  it("does not leak the public switch to the feed BFF", async () => {
    configurePublic();
    expect((await getFeed(req("/api/bff/feed"))).status).toBe(401);
  });

  it("rejects a non-allowlisted session from the feed BFF", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
    mocks.getServerSession.mockResolvedValue({ user: { email: "intruder@example.com" } });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect((await getFeed(req("/api/bff/feed"))).status).toBe(401);
  });

  it("returns the documented 429 response on the 241st anonymous request", async () => {
    configurePublic();
    mocks.fetch.mockImplementation(async () =>
      new Response(JSON.stringify({ edition: { status: "published" } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const request = req("/api/bff/newsletter-editions/latest", {
      "x-forwarded-for": "203.0.113.10",
    });
    for (let count = 0; count < 240; count += 1) {
      expect((await getNewsletter(request)).status).toBe(200);
    }
    const response = await getNewsletter(request);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({ error: "Too many requests" });
    expect(mocks.fetch).toHaveBeenCalledTimes(240);
  });

  it.each(["session", "shared"] as const)(
    "does not consume the public throttle for %s newsletter callers",
    async (mode) => {
      configurePublic();
      authenticatedCaller(mode);
      mocks.fetch.mockImplementation(
        async () =>
          new Response(JSON.stringify({ edition: { status: "published" } }), {
            headers: { "content-type": "application/json" },
          }),
      );

      const request = req("/api/bff/newsletter-editions/latest", {
        "x-forwarded-for": "203.0.113.12",
      });

      for (let count = 0; count < 241; count += 1) {
        expect((await getNewsletter(request)).status).toBe(200);
      }
    },
  );
});

describe("og-image reader BFF", () => {
  it("keeps public-off anonymous requests at 401", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    expect(
      (await getOgImage(req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fa"))).status,
    ).toBe(401);
  });

  it("keeps shared callers unrestricted when public is off", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    mocks.verifySharedCookie.mockResolvedValue(true);
    const response = await getOgImage(
      req("/api/bff/og-image?url=https%3A%2F%2FEXAMPLE.com%2Fa%2F%23raw"),
    );
    expect(response.status).toBe(200);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.resolveOgImage).toHaveBeenCalledWith("https://example.com/a/#raw");
  });

  it("rejects a non-allowlisted session when public and shared access are off", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
    mocks.getServerSession.mockResolvedValue({ user: { email: "intruder@example.com" } });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(
      (await getOgImage(req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fa"))).status,
    ).toBe(401);
  });

  it("keeps shared-cookie access for a non-allowlisted session", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
    mocks.getServerSession.mockResolvedValue({ user: { email: "intruder@example.com" } });
    mocks.verifySharedCookie.mockResolvedValue(true);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await getOgImage(
      req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fa"),
    );
    expect(response.status).toBe(200);
    expect(mocks.resolveOgImage).toHaveBeenCalledWith("https://example.com/a");
    expect(console.warn).toHaveBeenCalledWith(
      "[bff-auth] deny email=in***@example.com reason=allowlist_miss",
    );
  });

  it("allows an anonymous target found in any date/referer/latest union member", async () => {
    configurePublic();
    mocks.fetch.mockImplementation(async (input) => {
      const url = new URL(String(input));
      return publishedMarkdown(
        url.searchParams.get("date") === "2026-07-31" ? "https://example.com/a/。" : "none",
      );
    });
    const response = await getOgImage(
      req(
        "/api/bff/og-image?url=https%3A%2F%2FEXAMPLE.com%2Fa%23hash&date=2026-08-01",
        { referer: "https://reader.example/calendar?date=2026-07-31" },
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.resolveOgImage).toHaveBeenCalledWith("https://example.com/a");
    expect(
      mocks.fetch.mock.calls.map((call) => new URL(String(call[0])).searchParams.get("date")),
    ).toEqual(["2026-08-01", "2026-07-31", null]);
  });

  it("passes if one union member matches even when another load fails", async () => {
    configurePublic();
    mocks.fetch.mockImplementation(async (input) => {
      const date = new URL(String(input)).searchParams.get("date");
      return date === "2026-08-01"
        ? publishedMarkdown("https://example.com/a")
        : new Response("upstream error", { status: 500 });
    });
    const response = await getOgImage(
      req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fa&date=2026-08-01"),
    );
    expect(response.status).toBe(200);
  });

  it("returns generic 403 and never calls the resolver for an absent target", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(publishedMarkdown("https://example.com/other"));
    const response = await getOgImage(
      req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fmissing"),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(mocks.resolveOgImage).not.toHaveBeenCalled();
  });

  it("ignores a cross-origin Referer date", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(publishedMarkdown("https://example.com/other"));
    await getOgImage(
      req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fmissing", {
        referer: "https://evil.example/calendar?date=2026-07-31",
      }),
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(new URL(String(mocks.fetch.mock.calls[0]?.[0])).searchParams.has("date")).toBe(false);
  });

  it("ignores impossible public dates and still checks the latest edition", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(publishedMarkdown("https://example.com/a"));

    const response = await getOgImage(
      req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fa&date=2026-02-31"),
    );

    expect(response.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(new URL(String(mocks.fetch.mock.calls[0]?.[0])).searchParams.has("date")).toBe(false);
  });

  it("caches an upstream 404 empty set", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(new Response("missing", { status: 404 }));
    const target = "/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fmissing";
    expect((await getOgImage(req(target))).status).toBe(403);
    expect((await getOgImage(req(target))).status).toBe(403);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("applies membership to session callers while public mode is enabled", async () => {
    configurePublic();
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
    mocks.getServerSession.mockResolvedValue({ user: { email: "allowed@example.com" } });
    mocks.fetch.mockResolvedValue(publishedMarkdown("https://example.com/other"));
    const response = await getOgImage(
      req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fmissing"),
    );
    expect(response.status).toBe(403);
    expect(mocks.resolveOgImage).not.toHaveBeenCalled();
  });

  it("canonicalizes hash and trailing-slash variants before resolving", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(publishedMarkdown("https://example.com/a"));
    for (const target of ["https://example.com/a#1", "https://example.com/a#2", "https://example.com/a/"]) {
      const response = await getOgImage(
        req(`/api/bff/og-image?url=${encodeURIComponent(target)}`),
      );
      expect(response.status).toBe(200);
    }
    expect(mocks.resolveOgImage.mock.calls.map((call) => call[0])).toEqual([
      "https://example.com/a",
      "https://example.com/a",
      "https://example.com/a",
    ]);
  });

  it("reports missing upstream configuration with newsletter wording", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "1");
    vi.stubEnv("RAILWAY_API_BASE_URL", "");
    vi.stubEnv("NEWSLETTER_API_KEY", "");
    let response = await getOgImage(
      req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fa"),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "BFF misconfigured: set RAILWAY_API_BASE_URL" });

    vi.stubEnv("RAILWAY_API_BASE_URL", "https://railway.example");
    response = await getOgImage(
      req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fa"),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "BFF misconfigured: set NEWSLETTER_API_KEY (or DIGEST_API_KEY / FEED_API_KEY)",
    });
  });

  it("maps guard upstream failures to 502 without resolving", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(new Response("bad", { status: 500 }));
    const response = await getOgImage(
      req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fa"),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Failed to load edition for og-image guard" });
    expect(mocks.resolveOgImage).not.toHaveBeenCalled();
  });

  it("maps guard credential rejection to its specific 500 response", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(new Response("no", { status: 401 }));
    const response = await getOgImage(
      req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fa"),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "BFF misconfigured: upstream rejected the newsletter API key",
    });
  });

  it("returns 429 on the 121st anonymous og-image request", async () => {
    configurePublic();
    mocks.fetch.mockResolvedValue(publishedMarkdown("https://example.com/a"));
    const request = req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fa", {
      "x-forwarded-for": "203.0.113.11",
    });
    for (let count = 0; count < 120; count += 1) {
      expect((await getOgImage(request)).status).toBe(200);
    }
    const response = await getOgImage(request);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({ error: "Too many requests" });
  });

  it.each(["session", "shared"] as const)(
    "does not consume the public throttle for %s og-image callers",
    async (mode) => {
      configurePublic();
      authenticatedCaller(mode);
      mocks.fetch.mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.searchParams.get("format") === "markdown") {
          return publishedMarkdown("https://example.com/a");
        }

        return new Response(JSON.stringify({ edition: { status: "published" } }), {
          headers: { "content-type": "application/json" },
        });
      });

      const request = req("/api/bff/og-image?url=https%3A%2F%2Fexample.com%2Fa", {
        "x-forwarded-for": "203.0.113.13",
      });

      for (let count = 0; count < 121; count += 1) {
        expect((await getOgImage(request)).status).toBe(200);
      }
    },
  );
});

it("imports resolveBffReaderAuth only in the two reader BFF routes", () => {
  const root = process.cwd();
  const files = {
    newsletter: "src/app/api/bff/newsletter-editions/latest/route.ts",
    ogImage: "src/app/api/bff/og-image/route.ts",
    feed: "src/app/api/bff/feed/route.ts",
  };
  expect(readFileSync(join(root, files.newsletter), "utf8")).toContain(
    'from "@/lib/bff/reader-auth"',
  );
  expect(readFileSync(join(root, files.ogImage), "utf8")).toContain(
    'from "@/lib/bff/reader-auth"',
  );
  expect(readFileSync(join(root, files.feed), "utf8")).not.toContain(
    'from "@/lib/bff/reader-auth"',
  );
});
