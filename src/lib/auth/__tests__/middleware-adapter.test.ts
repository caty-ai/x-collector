import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifySharedCookie: vi.fn(),
  handler: undefined as undefined | ((request: unknown) => Promise<Response>),
  options: undefined as
    | undefined
    | {
        callbacks: {
          authorized(input: { token: unknown; req: { nextUrl: URL } }): boolean;
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

type MinimalRequest = {
  nextUrl: URL;
  url: string;
  cookies: { get(name: string): { value: string } | undefined };
  nextauth: { token: { email?: string } | null };
};

function request(pathname: string, token: { email?: string } | null = null): MinimalRequest {
  const url = `https://reader.example${pathname}`;
  return {
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
  vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
  mocks.verifySharedCookie.mockReset().mockResolvedValue(false);
});

afterEach(() => {
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
