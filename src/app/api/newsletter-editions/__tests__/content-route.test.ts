import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { resetNewsletterBearerWarningsForTests } from "@/lib/auth/newsletter-api-key";

const mocks = vi.hoisted(() => ({
  editionFindFirst: vi.fn(),
}));

vi.mock("@prisma/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@prisma/client")>()),
  PrismaClient: class {
    newsletterEdition = { findFirst: mocks.editionFindFirst };
  },
}));

import { GET } from "@/app/api/newsletter-editions/[id]/content/route";

const edition = {
  id: "edition-1",
  slug: "daily-news-20260908",
  status: "published",
  contentMd: "# Published",
};

function req(authorization = "Bearer test-key", id = "edition-1"): NextRequest {
  return new NextRequest(`https://api.example/api/newsletter-editions/${id}/content`, {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetNewsletterBearerWarningsForTests();
  vi.stubEnv("NEWSLETTER_API_KEY", "test-key");
  mocks.editionFindFirst.mockResolvedValue(edition);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("newsletter content upstream route", () => {
  it("fails closed in production without a configured key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEWSLETTER_API_KEY", "");
    vi.stubEnv("DIGEST_API_KEY", "");
    vi.stubEnv("FEED_API_KEY", "");

    const response = await GET(req(""), { params: { id: "edition-1" } });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "api key not configured" });
    expect(mocks.editionFindFirst).not.toHaveBeenCalled();
  });

  it("rejects a wrong Bearer value", async () => {
    const response = await GET(req("Bearer wrong"), { params: { id: "edition-1" } });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unauthorized. Provide header: Authorization: Bearer <API_KEY>",
    });
    expect(mocks.editionFindFirst).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header", async () => {
    const response = await GET(req(""), { params: { id: "edition-1" } });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unauthorized. Provide header: Authorization: Bearer <API_KEY>",
    });
    expect(mocks.editionFindFirst).not.toHaveBeenCalled();
  });

  it("authorizes before the lookup for an unknown id", async () => {
    mocks.editionFindFirst.mockResolvedValue(null);

    const response = await GET(req("Bearer wrong", "does-not-exist"), {
      params: { id: "does-not-exist" },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unauthorized. Provide header: Authorization: Bearer <API_KEY>",
    });
    expect(mocks.editionFindFirst).not.toHaveBeenCalled();
  });

  it("stays open outside production when no key is configured", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEWSLETTER_API_KEY", "");
    vi.stubEnv("DIGEST_API_KEY", "");
    vi.stubEnv("FEED_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await GET(req(""), { params: { id: "edition-1" } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(edition.contentMd);
    expect(mocks.editionFindFirst).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[newsletter-content-api] API auth disabled outside production; missing env: NEWSLETTER_API_KEY | DIGEST_API_KEY | FEED_API_KEY",
    );
  });

  it("returns markdown and edition headers with a valid key", async () => {
    const response = await GET(req(), { params: { id: "edition-1" } });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(edition.contentMd);
    expect(Object.fromEntries(response.headers.entries())).toEqual({
      "content-type": "text/markdown; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-edition-id": "edition-1",
      "x-edition-slug": "daily-news-20260908",
      "x-edition-status": "published",
    });
    expect(mocks.editionFindFirst).toHaveBeenCalledOnce();
    expect(mocks.editionFindFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: "edition-1" }, { slug: "edition-1" }] },
      select: { id: true, slug: true, status: true, contentMd: true },
    });
  });

  it("returns 404 when the edition does not exist", async () => {
    mocks.editionFindFirst.mockResolvedValue(null);

    const response = await GET(req(), { params: { id: "edition-1" } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Edition not found" });
  });

  it("returns 404 when contentMd is null", async () => {
    mocks.editionFindFirst.mockResolvedValue({ ...edition, contentMd: null });

    const response = await GET(req(), { params: { id: "edition-1" } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Edition exists but contentMd is empty" });
  });
});
