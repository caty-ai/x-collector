import { afterEach, describe, expect, it, vi } from "vitest";

import { decideTokenAccess } from "@/lib/auth/admin";
import {
  decideReaderAccess,
  isNewspaperPublic,
  isReaderPath,
} from "@/lib/auth/public-newspaper";

afterEach(() => vi.unstubAllEnvs());

describe("isNewspaperPublic", () => {
  it.each(["1", "true", " TRUE "])("accepts %j", (value) => {
    expect(isNewspaperPublic({ NEWSPAPER_PUBLIC: value })).toBe(true);
  });

  it.each([undefined, "", "0", "false", "yes", "on"])("rejects %j", (value) => {
    expect(isNewspaperPublic({ NEWSPAPER_PUBLIC: value })).toBe(false);
  });
});

it("recognizes only the calendar reader path", () => {
  expect(isReaderPath("/calendar")).toBe(true);
  expect(isReaderPath("/calendar/ask-ai-widget.js")).toBe(true);
  expect(isReaderPath("/calendarish")).toBe(false);
});

it.each([
  [{ isPublic: true, hasToken: false, tokenAllowlisted: false, hasSharedCookie: false }, "next"],
  [{ isPublic: false, hasToken: true, tokenAllowlisted: true, hasSharedCookie: false }, "next"],
  [{ isPublic: false, hasToken: false, tokenAllowlisted: false, hasSharedCookie: true }, "next"],
  [
    { isPublic: false, hasToken: false, tokenAllowlisted: false, hasSharedCookie: false },
    "redirect_np_login",
  ],
  [
    { isPublic: false, hasToken: true, tokenAllowlisted: false, hasSharedCookie: false },
    "redirect_np_login",
  ],
] as const)("decides reader access for %j", (input, expected) => {
  expect(decideReaderAccess({ pathname: "/calendar", ...input })).toBe(expected);
});

it("is a pure-function check: middleware never evaluates /api/bff/*; BFF gating is in-route", () => {
  vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
  expect(decideTokenAccess({ pathname: "/feed", email: "other@example.com" })).toBe(
    "forbidden_text",
  );
  expect(decideTokenAccess({ pathname: "/api/bff/feed", email: "other@example.com" })).toBe(
    "forbidden_json",
  );
});
