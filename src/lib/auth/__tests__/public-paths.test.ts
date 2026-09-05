import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PUBLIC_ARTICLE_PATH_RE,
  isPublicArticlePath,
  isPublicArticleRequest,
} from "@/lib/auth/public-paths";

const articlePath = "/a/2026-09-04/0123456789ab";

describe("public article boundary", () => {
  it.each([articlePath, `${articlePath}/`])("accepts exact article path %s", (pathname) => {
    expect(PUBLIC_ARTICLE_PATH_RE.test(pathname)).toBe(true);
    expect(isPublicArticlePath(pathname)).toBe(true);
    expect(isPublicArticleRequest(pathname, "GET")).toBe(true);
    expect(isPublicArticleRequest(pathname, "HEAD")).toBe(true);
  });

  it.each([
    "/a",
    "/a/",
    "/ax",
    "/a-foo",
    "/alerts",
    "/alert-sources",
    "/admin",
    "/a/2026-09-04",
    "/a/2026-09-04/abc",
    "/a/2026-09-04/0123456789ab/extra",
    "/a/2026-09-04/0123456789AB",
    "/a/2026-9-4/0123456789ab",
    "/a/%32%30%32%36-09-04/0123456789ab",
    "/%61/2026-09-04/0123456789ab",
    "/a/2026-09-04/%30123456789ab",
    "/a/2026-09-04/0123456789ab?x=1",
    "/a/2026-09-04/0123456789ab/..",
    "/a/2026-09-04/0123456789ab/%2e%2e",
  ])("rejects malformed or unrelated pathname %s", (pathname) => {
    expect(isPublicArticlePath(pathname)).toBe(false);
    expect(isPublicArticleRequest(pathname, "GET")).toBe(false);
    expect(isPublicArticleRequest(pathname, "HEAD")).toBe(false);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS", undefined])(
    "rejects method %s",
    (method) => {
      expect(isPublicArticleRequest(articlePath, method)).toBe(false);
    },
  );

  it.each(["get", "head"])("normalizes method %s", (method) => {
    expect(isPublicArticleRequest(articlePath, method)).toBe(true);
  });

  it("keeps the middleware matcher open for articles and exempt for PNG assets", () => {
    const source = readFileSync(new URL("../../../middleware.ts", import.meta.url), "utf8");
    const matcherSource = source.split("export const config =")[1];
    const literals = matcherSource.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
    const paths = literals.map((literal) => JSON.parse(literal) as string);
    const pagePattern = paths.find((path) => path.startsWith("/((?!"));
    expect(pagePattern).toBeDefined();
    const matcher = new RegExp(`^${pagePattern!}$`);
    expect(matcher.test("/og-default.png")).toBe(false);
    expect(matcher.test(articlePath)).toBe(true);
  });
});
