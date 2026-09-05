import type { NextAuthOptions } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetAllowlistWarningForTests,
  decideTokenAccess,
  evaluateSignIn,
  isAdminEmailAllowed,
  normalizeEmail,
  warnIfAllowlistUnconfigured,
} from "@/lib/auth/admin";
import { describeLoginError, firstSearchParam } from "@/lib/auth/login-error";
import { authOptions } from "@/lib/auth/options";

type SignInCallback = NonNullable<NonNullable<NextAuthOptions["callbacks"]>["signIn"]>;
type SignInInput = Parameters<SignInCallback>[0];
type SessionCallback = NonNullable<NonNullable<NextAuthOptions["callbacks"]>["session"]>;
type SessionInput = Parameters<SessionCallback>[0];

const startupWarning =
  "[auth-signin] ADMIN_EMAIL_ALLOWLIST is unset or empty; Google sign-in is denied for everyone (fail-close). Set ADMIN_EMAIL_ALLOWLIST to a comma-separated list of Google primary addresses.";

function getSignInCallback(): SignInCallback {
  const callback = authOptions.callbacks?.signIn;
  if (!callback) throw new Error("signIn callback is not configured");
  return callback;
}

function getSessionCallback(): SessionCallback {
  const callback = authOptions.callbacks?.session;
  if (!callback) throw new Error("session callback is not configured");
  return callback;
}

function signInInput(input: {
  userEmail?: string | null;
  provider?: string | null;
  profileEmail?: string;
  emailVerified?: unknown;
} = {}): SignInInput {
  const provider = input.provider === undefined ? "google" : input.provider;
  return {
    user: {
      id: "user-1",
      email: input.userEmail === undefined ? "admin@example.com" : input.userEmail,
      name: "Admin",
      image: null,
    },
    account:
      provider === null
        ? null
        : {
            provider,
            type: "oauth",
            providerAccountId: "provider-user-1",
          },
    profile: {
      ...(input.profileEmail === undefined ? { email: "admin@example.com" } : { email: input.profileEmail }),
      ...(input.emailVerified === undefined
        ? { email_verified: true }
        : { email_verified: input.emailVerified }),
    },
  } as SignInInput;
}

function sessionInput(email: string | null): SessionInput {
  return {
    session: {
      user: { email, name: "Admin", image: null },
      expires: "2099-01-01T00:00:00.000Z",
    },
    token: { email },
  } as SessionInput;
}

beforeEach(() => {
  vi.restoreAllMocks();
  __resetAllowlistWarningForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetAllowlistWarningForTests();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("ADMIN_EMAIL_ALLOWLIST decisions", () => {
  it("normalizes case, whitespace, quotes, mailto, Slack mailto, and angle brackets", () => {
    vi.stubEnv(
      "ADMIN_EMAIL_ALLOWLIST",
      ' " Admin@Example.com ", mailto:second@example.com, <third@example.com>, <mailto:fourth@example.com|Fourth> ',
    );

    expect(normalizeEmail(" Admin@Example.com ")).toBe("admin@example.com");
    expect(isAdminEmailAllowed("admin@example.com")).toBe(true);
    expect(isAdminEmailAllowed("SECOND@EXAMPLE.COM")).toBe(true);
    expect(isAdminEmailAllowed("third@example.com")).toBe(true);
    expect(isAdminEmailAllowed("fourth@example.com")).toBe(true);
    expect(
      evaluateSignIn({
        email: " ADMIN@example.com ",
        emailVerified: true,
        userEmail: "admin@example.com",
      }),
    ).toEqual({ allowed: true });
  });

  it("distinguishes an allowlist miss from an unconfigured allowlist", () => {
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "other@example.com");
    expect(
      evaluateSignIn({
        email: "admin@example.com",
        emailVerified: true,
        userEmail: "admin@example.com",
      }),
    ).toEqual({ allowed: false, reason: "allowlist_miss" });

    for (const value of [undefined, "", "  , ,  "]) {
      vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", value);
      expect(
        evaluateSignIn({
          email: "admin@example.com",
          emailVerified: true,
          userEmail: "admin@example.com",
        }),
      ).toEqual({ allowed: false, reason: "allowlist_unconfigured" });
    }
  });

  it("denies unverified and missing addresses", () => {
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "admin@example.com");

    for (const emailVerified of [false, undefined, null, "true"] as const) {
      expect(
        evaluateSignIn({
          email: "admin@example.com",
          emailVerified: emailVerified as boolean | null | undefined,
          userEmail: "admin@example.com",
        }),
      ).toEqual({ allowed: false, reason: "email_unverified" });
    }

    for (const email of [null, ""] as const) {
      expect(evaluateSignIn({ email, emailVerified: true, userEmail: email })).toEqual({
        allowed: false,
        reason: "email_missing",
      });
    }
  });
});

describe("NextAuth wiring", () => {
  it("routes sign-in errors to the login page", () => {
    expect(authOptions.pages?.error).toBe("/login");
  });

  it("returns strict booleans for allowed and non-allowlisted Google accounts", async () => {
    const signIn = getSignInCallback();
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "admin@example.com");

    expect(await signIn(signInInput())).toBe(true);
    expect(
      await signIn(
        signInInput({
          userEmail: "outsider@example.com",
          profileEmail: "outsider@example.com",
        }),
      ),
    ).toBe(false);
  });

  it("denies non-Google, incomplete, and non-literally-verified profiles", async () => {
    const signIn = getSignInCallback();
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "admin@example.com");

    expect(await signIn(signInInput({ provider: "github" }))).toBe(false);
    for (const emailVerified of [false, null, "true"] as const) {
      expect(await signIn(signInInput({ emailVerified }))).toBe(false);
    }
    const missingVerified = signInInput();
    delete (missingVerified.profile as Record<string, unknown>)["email_verified"];
    expect(await signIn(missingVerified)).toBe(false);

    const missingProfileEmail = signInInput();
    delete (missingProfileEmail.profile as Record<string, unknown>)["email"];
    expect(await signIn(missingProfileEmail)).toBe(false);

    const missingUserEmail = signInInput();
    delete (missingUserEmail.user as unknown as Record<string, unknown>)["email"];
    expect(await signIn(missingUserEmail)).toBe(false);
    expect(await signIn(signInInput({ userEmail: null }))).toBe(false);
    expect(await signIn(signInInput({ userEmail: "" }))).toBe(false);
  });

  it("denies a missing account as unverified and logs the provider safely", async () => {
    const signIn = getSignInCallback();
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "admin@example.com");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await signIn(signInInput({ provider: null }))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[auth-signin] deny provider=(none) email=ad***@example.com reason=email_unverified",
    );
  });

  it("binds verification to the same user address", async () => {
    const signIn = getSignInCallback();
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "profile@example.com");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(
      await signIn(
        signInInput({
          userEmail: "user@example.com",
          profileEmail: "profile@example.com",
        }),
      ),
    ).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[auth-signin] deny provider=google email=pr***@example.com reason=email_mismatch",
    );
  });

  it("returns the original session for allowed tokens and an empty session for denied tokens", async () => {
    const session = getSessionCallback();
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "admin@example.com");
    const allowedInput = sessionInput("admin@example.com");

    expect(await session(allowedInput)).toBe(allowedInput.session);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const denied = await session(sessionInput("outsider@example.com"));
    expect(Object.keys(denied)).toHaveLength(0);
    expect(denied).not.toHaveProperty("user");
    expect(warn).toHaveBeenCalledWith(
      "[auth-session] deny email=ou***@example.com reason=allowlist_miss",
    );
  });
});

describe("allowlist warnings", () => {
  it("warns once per module instance and returns only void", () => {
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(warnIfAllowlistUnconfigured()).toBeUndefined();
    expect(warnIfAllowlistUnconfigured()).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(startupWarning);
  });

  it("does not warn when configured", () => {
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "admin@example.com");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(warnIfAllowlistUnconfigured()).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not emit the startup warning during a production build import", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("AUTH_SECRET", "build-auth-secret");
    vi.stubEnv("AUTH_GOOGLE_ID", "build-google-id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "build-google-secret");
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await import("../options");

    expect(warn).not.toHaveBeenCalledWith(startupWarning);
  });

  it("emits the startup warning exactly once during a production server import", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    vi.stubEnv("AUTH_SECRET", "server-auth-secret");
    vi.stubEnv("AUTH_GOOGLE_ID", "server-google-id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "server-google-secret");
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await import("../options");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(startupWarning);
  });
});

describe("token access decisions", () => {
  it("allows listed tokens and selects text or JSON denial by path", () => {
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "admin@example.com");

    expect(decideTokenAccess({ pathname: "/sources", email: "admin@example.com" })).toBe("next");
    expect(decideTokenAccess({ pathname: "/sources", email: "other@example.com" })).toBe(
      "forbidden_text",
    );
    expect(decideTokenAccess({ pathname: "/api/admin/x", email: "other@example.com" })).toBe(
      "forbidden_json",
    );
  });

  it("denies every path when the allowlist is unconfigured", () => {
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "  ,  ");

    expect(decideTokenAccess({ pathname: "/sources", email: "admin@example.com" })).toBe(
      "forbidden_text",
    );
    expect(decideTokenAccess({ pathname: "/api/admin/x", email: "admin@example.com" })).toBe(
      "forbidden_json",
    );
  });
});

describe("login error messages", () => {
  it("uses the first search parameter value", () => {
    expect(firstSearchParam(["AccessDenied", "x"])).toBe("AccessDenied");
    expect(firstSearchParam(undefined)).toBeUndefined();
  });

  it("maps only known fixed strings and never reflects unknown values", () => {
    expect(describeLoginError("AccessDenied")).toBe(
      "This Google account is not on the allowlist. Ask the administrator to add your address, or sign in with a different account.",
    );
    expect(describeLoginError("OAuthCallback")).toBe("Sign-in failed. Please try again.");
    expect(describeLoginError("OAuthCallback")).not.toContain("OAuthCallback");
    expect(describeLoginError(undefined)).toBeNull();
    expect(describeLoginError("")).toBeNull();
  });
});
