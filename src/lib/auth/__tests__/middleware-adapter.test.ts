import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifySharedCookie: vi.fn(),
  handler: undefined as undefined | ((request: unknown) => Promise<Response>),
  options: undefined as
    | undefined
    | {
        callbacks: {
          authorized(input: { token: unknown; req: { nextUrl: URL; method?: string } }): boolean;
        };
      },
}));

vi.mock("next-auth/middleware", () => ({
  withAuth: (handler: (request: unknown) => Promise<Response>, options: typeof mocks.options) => {
    mocks.handler = handler;
    mocks.options = options;
    return handler;
  },
}));
vi.mock("@/lib/auth/options", () => ({ authSecret: "short-test-secret" }));
vi.mock("@/lib/auth/shared-newspaper", () => ({
  SHARED_COOKIE_NAME: "np_shared",
  verifySharedCookie: mocks.verifySharedCookie,
}));

import middleware, { config } from "@/middleware";
import { __resetPublicThrottleForTests } from "@/lib/bff/public-throttle";

type MinimalRequest = {
  method: string;
  headers: Headers;
  nextUrl: URL;
  url: string;
  cookies: { get(name: string): { value: string } | undefined };
  nextauth: { token: { email?: string } | null };
};

function request(pathname: string, token: { email?: string } | null = null): MinimalRequest {
  const url = `https://reader.example${pathname}`;
  return {
    method: "GET",
    headers: new Headers({ "x-forwarded-for": "203.0.113.98" }),
    nextUrl: new URL(url),
    url,
    cookies: { get: () => undefined },
    nextauth: { token },
  };
}

async function run(req: MinimalRequest): Promise<Response> {
  return middleware(req as never, {} as never) as unknown as Response;
}

beforeEach(() => {
  __resetPublicThrottleForTests();
  vi.stubEnv("NEWSPAPER_PUBLIC", undefined);
  vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
  mocks.verifySharedCookie.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  __resetPublicThrottleForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("middleware reader adapter", () => {
  it("pins the origin/main matcher exactly", () => {
    expect(config.matcher).toEqual([
      "/api/admin/:path*",
      "/((?!login|api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|json)$).*)",
    ]);
  });

  it.each([
    "/calendar",
    "/calendar/ask-ai-widget.js",
    "/calendar/reader.css",
    "/calendar/font.woff2",
  ])(
    "lets anonymous public readers through %s without checking the shared cookie",
    async (pathname) => {
      vi.stubEnv("NEWSPAPER_PUBLIC", "1");
      const response = await run(request(pathname));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(mocks.verifySharedCookie).not.toHaveBeenCalled();
    },
  );

  it.each(["/calendar", "/calendar/ask-ai-widget.js"])(
    "keeps the public-off redirect for %s",
    async (pathname) => {
      vi.stubEnv("NEWSPAPER_PUBLIC", "0");
      const response = await run(request(pathname));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://reader.example/np-login");
    },
  );

  it("keeps shared-cookie and allowlisted-token reader access", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    mocks.verifySharedCookie.mockResolvedValueOnce(true);
    expect((await run(request("/calendar"))).status).toBe(200);
    expect((await run(request("/calendar", { email: "allowed@example.com" }))).status).toBe(200);
  });

  it("redirects a non-allowlisted reader token without a shared cookie", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "0");
    const response = await run(request("/calendar", { email: "other@example.com" }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://reader.example/np-login");
  });

  it("preserves the exact non-reader text and JSON 403 responses", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "1");
    const textResponse = await run(request("/feed", { email: "other@example.com" }));
    expect(textResponse.status).toBe(403);
    expect(await textResponse.text()).toBe(
      "Forbidden: this account is not on the allowlist. Sign out at /api/auth/signout to switch accounts.",
    );
    const jsonResponse = await run(request("/api/admin/x", { email: "other@example.com" }));
    expect(jsonResponse.status).toBe(403);
    expect(await jsonResponse.json()).toEqual({ error: "Forbidden" });
  });

  it("keeps /np-login open in both switch states", async () => {
    for (const value of ["0", "1"]) {
      vi.stubEnv("NEWSPAPER_PUBLIC", value);
      expect((await run(request("/np-login"))).status).toBe(200);
    }
  });

  it("does not add public access to authorized or non-reader pages", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "1");
    expect(
      mocks.options?.callbacks.authorized({
        token: null,
        req: { nextUrl: new URL("https://reader.example/feed") },
      }),
    ).toBe(false);
    const response = await run(request("/settings", { email: "other@example.com" }));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe(
      "Forbidden: this account is not on the allowlist. Sign out at /api/auth/signout to switch accounts.",
    );
  });
});

describe("middleware article adapter", () => {
  const articlePath = "/a/2026-09-04/0123456789ab";

  it.each(["GET", "HEAD"])("admits anonymous public %s articles", async (method) => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "1");
    const response = await run({ ...request(articlePath), method });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects to shared login when the public switch is unset", async () => {
    const response = await run(request(articlePath));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://reader.example/np-login");
  });

  it("admits a valid shared cookie when the public switch is unset", async () => {
    mocks.verifySharedCookie.mockImplementation(async (value) => value === "valid-shared-cookie");
    const req = request(articlePath);
    req.cookies.get = (name) =>
      name === "np_shared" ? { value: "valid-shared-cookie" } : undefined;
    const response = await run(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("sends public POST articles through the existing token path", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "1");
    const response = await run({
      ...request(articlePath, { email: "other@example.com" }),
      method: "POST",
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe(
      "Forbidden: this account is not on the allowlist. Sign out at /api/auth/signout to switch accounts.",
    );
  });

  it("preserves quota across public-off redirects, throttles the 241st admission and releases it after 60 seconds", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const req = request(articlePath);
    for (let count = 0; count < 241; count += 1) {
      const response = await run(req);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://reader.example/np-login");
    }
    vi.stubEnv("NEWSPAPER_PUBLIC", "1");
    for (let count = 0; count < 240; count += 1) {
      expect((await run(req)).headers.get("x-middleware-next")).toBe("1");
    }
    const response = await run(req);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe("Too many requests");
    const otherIp = request(articlePath);
    otherIp.headers.set("x-forwarded-for", "203.0.113.99");
    expect((await run(otherIp)).headers.get("x-middleware-next")).toBe("1");
    expect((await run(request("/calendar"))).headers.get("x-middleware-next")).toBe("1");
    now.mockReturnValue(61_000);
    expect((await run(req)).headers.get("x-middleware-next")).toBe("1");
  });

  it("never throttles allowlisted tokens or consumes their anonymous quota", async () => {
    vi.stubEnv("NEWSPAPER_PUBLIC", "1");
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    for (let count = 0; count < 241; count += 1) {
      const response = await run(request(articlePath, { email: "allowed@example.com" }));
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    for (let count = 0; count < 240; count += 1) {
      expect((await run(request(articlePath))).headers.get("x-middleware-next")).toBe("1");
    }
    expect((await run(request(articlePath))).status).toBe(429);
    const allowlistedResponse = await run(request(articlePath, { email: "allowed@example.com" }));
    expect(allowlistedResponse.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", undefined])(
    "authorizes only article reader methods before the handler: %s",
    (method) => {
      expect(
        mocks.options?.callbacks.authorized({
          token: null,
          req: { nextUrl: new URL(`https://reader.example${articlePath}`), method },
        }),
      ).toBe(method === "GET" || method === "HEAD");
    },
  );

  it("treats normalised dot-segment articles like the clean path in both public switch states", async () => {
    const nextUrl = new URL("https://reader.example/a/2026-09-04/junk/%2e%2e/0123456789ab");
    expect(nextUrl.pathname).toBe(articlePath);
    const normalisedRequest = { ...request(articlePath), nextUrl, url: nextUrl.href };

    for (const value of [undefined, "1"]) {
      vi.stubEnv("NEWSPAPER_PUBLIC", value);
      for (const req of [normalisedRequest, request(articlePath)]) {
        expect(mocks.options?.callbacks.authorized({ token: null, req })).toBe(true);
        const response = await run(req);
        if (value === "1") {
          expect(response.status).toBe(200);
          expect(response.headers.get("x-middleware-next")).toBe("1");
        } else {
          expect(response.status).toBe(307);
          expect(response.headers.get("location")).toBe("https://reader.example/np-login");
        }
      }
    }
  });

  it("sends dot segments escaping the article path through token authorization", async () => {
    const nextUrl = new URL("https://reader.example/a/2026-09-04/0123456789ab/../../admin");
    expect(nextUrl.pathname).toBe("/a/admin");
    const req = {
      ...request(articlePath, { email: "other@example.com" }),
      nextUrl,
      url: nextUrl.href,
    };

    for (const value of [undefined, "1"]) {
      vi.stubEnv("NEWSPAPER_PUBLIC", value);
      expect(mocks.options?.callbacks.authorized({ token: null, req })).toBe(false);
      expect(mocks.options?.callbacks.authorized({ token: req.nextauth.token, req })).toBe(true);
      const response = await run(req);
      expect(response.status).toBe(403);
      expect(await response.text()).toBe(
        "Forbidden: this account is not on the allowlist. Sign out at /api/auth/signout to switch accounts.",
      );
    }
  });
});
