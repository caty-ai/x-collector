import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

afterEach(() => vi.unstubAllEnvs());

const request = () => new NextRequest("https://reader.example/llms.txt");

describe("GET /llms.txt", () => {
  it("returns public plain text with the specified headers", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("uses the configured masthead and tagline", async () => {
    vi.stubEnv("NEWSPAPER_MASTHEAD", "夕刊AIタイムズ");
    vi.stubEnv("NEWSPAPER_TAGLINE", "今日のAIニュースを日本語で。");

    const body = await (await GET(request())).text();

    expect(body.split("\n")[0]).toBe("# 夕刊AIタイムズ");
    expect(body.split("\n")[2]).toBe("> 今日のAIニュースを日本語で。");
  });

  it.each([
    ["https://site.example/path", "https://auth.example/path", "https://site.example"],
    [undefined, "https://auth.example/path", "https://auth.example"],
    [undefined, undefined, "https://reader.example"],
  ])("resolves site %s and auth %s to origin %s", async (site, auth, origin) => {
    vi.stubEnv("NEWSPAPER_SITE_URL", site);
    vi.stubEnv("NEXTAUTH_URL", auth);

    const body = await (await GET(request())).text();

    expect(body).toContain(`[Latest edition (markdown)](${origin}/api/bff/newsletter-editions/latest?format=markdown)`);
    expect(body).toContain(`[Edition by date (markdown)](${origin}/api/bff/newsletter-editions/latest?format=markdown&date=YYYY-MM-DD)`);
    expect(body).toContain(`[Reader page (HTML)](${origin}/calendar?date=YYYY-MM-DD)`);
  });

  it("never exposes upstream URLs or API secrets", async () => {
    const secrets = {
      RAILWAY_API_BASE_URL: "https://railway.example",
      NEWSLETTER_API_KEY: "short-key-xyz",
      DIGEST_API_KEY: "digest-xyz",
      FEED_API_KEY: "feed-xyz",
      NEXTAUTH_SECRET: "auth-xyz",
      MCP_API_KEY: "mcp-xyz",
      FAMILY_FEED_API_KEY: "family-xyz",
    };
    for (const [name, value] of Object.entries(secrets)) vi.stubEnv(name, value);

    const body = await (await GET(request())).text();

    for (const value of Object.values(secrets)) expect(body).not.toContain(value);
  });

  it("includes all required sections and ends with a single LF newline", async () => {
    const body = await (await GET(request())).text();

    for (const heading of ["## Editions", "## Edition format", "## Access"]) {
      expect(body.split("\n")).toContain(heading);
    }
    expect(body).toMatch(/[^\n]\n$/);
    expect(body).not.toContain("\r");
  });
});
