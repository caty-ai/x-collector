import type { Session } from "next-auth";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth/options", () => ({ authOptions: {} }));

import { resolveAllowlistedSession } from "@/lib/bff/session-auth";

function session(email?: string): Session {
  return {
    user: email === undefined ? {} : { email },
    expires: "2099-01-01T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.getServerSession.mockReset();
});

describe("resolveAllowlistedSession", () => {
  it("returns null without logging for an anonymous session", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(resolveAllowlistedSession()).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns the same allowlisted session", async () => {
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
    const allowed = session("allowed@example.com");
    mocks.getServerSession.mockResolvedValue(allowed);

    await expect(resolveAllowlistedSession()).resolves.toBe(allowed);
  });

  it("rejects and masks a non-allowlisted email", async () => {
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
    mocks.getServerSession.mockResolvedValue(session("intruder@example.com"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(resolveAllowlistedSession()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[bff-auth] deny email=in***@example.com reason=allowlist_miss",
    );
    expect(warn.mock.calls.flat().join(" ")).not.toContain("intruder@example.com");
  });

  it("rejects a session when the allowlist is unconfigured", async () => {
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", undefined);
    mocks.getServerSession.mockResolvedValue(session("intruder@example.com"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(resolveAllowlistedSession()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[bff-auth] deny email=in***@example.com reason=allowlist_unconfigured",
    );
  });

  it("rejects a session without user.email", async () => {
    vi.stubEnv("ADMIN_EMAIL_ALLOWLIST", "allowed@example.com");
    mocks.getServerSession.mockResolvedValue(session());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(resolveAllowlistedSession()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[bff-auth] deny email=(none) reason=allowlist_miss",
    );
  });
});
