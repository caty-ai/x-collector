export const normalizeEmail = (value: string): string => {
  let normalized = value.trim().toLowerCase();

  // tolerate copied values like "email@example.com" / 'email@example.com'
  normalized = normalized.replace(/^['\"]+|['\"]+$/g, "");

  // tolerate Slack copied mailto format: <mailto:foo@example.com|foo@example.com>
  const slackMailtoMatch = normalized.match(/^<mailto:([^|>]+)\|[^>]+>$/);
  if (slackMailtoMatch?.[1]) {
    normalized = slackMailtoMatch[1];
  }

  if (normalized.startsWith("mailto:")) {
    normalized = normalized.slice("mailto:".length);
  }

  // tolerate angle-bracketed email: <foo@example.com>
  normalized = normalized.replace(/^<|>$/g, "");

  return normalized.trim();
};

const getAllowlist = (): Set<string> => {
  const raw = process.env.ADMIN_EMAIL_ALLOWLIST;
  if (!raw) return new Set();

  return new Set(
    raw
      .split(",")
      .map((email) => normalizeEmail(email))
      .filter((email) => email.length > 0),
  );
};

export type SignInDenyReason =
  | "email_missing"
  | "email_unverified"
  | "email_mismatch"
  | "allowlist_unconfigured"
  | "allowlist_miss";

export type SignInDecision =
  | { allowed: true }
  | { allowed: false; reason: SignInDenyReason };

export type TokenAccessDecision = "next" | "forbidden_json" | "forbidden_text";

const allowlistWarning =
  "[auth-signin] ADMIN_EMAIL_ALLOWLIST is unset or empty; Google sign-in is denied for everyone (fail-close). Set ADMIN_EMAIL_ALLOWLIST to a comma-separated list of Google primary addresses.";

let allowlistWarningShown = false;

export const isAdminRoute = (pathname: string): boolean => {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
};

export const isAdminEmailAllowed = (email?: string | null): boolean => {
  const allowlist = getAllowlist();
  if (allowlist.size === 0) return false; // fail-close
  if (!email) return false;
  return allowlist.has(normalizeEmail(email));
};

export const isAllowlistConfigured = (): boolean => getAllowlist().size > 0;

export const evaluateSignIn = (input: {
  email?: string | null;
  emailVerified?: boolean | null;
  userEmail: string | null;
}): SignInDecision => {
  if (!input.email || input.userEmail === null || input.userEmail === "") {
    return { allowed: false, reason: "email_missing" };
  }
  if (input.emailVerified !== true) {
    return { allowed: false, reason: "email_unverified" };
  }
  if (normalizeEmail(input.email) !== normalizeEmail(input.userEmail)) {
    return { allowed: false, reason: "email_mismatch" };
  }
  if (!isAllowlistConfigured()) {
    return { allowed: false, reason: "allowlist_unconfigured" };
  }
  if (!isAdminEmailAllowed(input.email)) {
    return { allowed: false, reason: "allowlist_miss" };
  }
  return { allowed: true };
};

export const warnIfAllowlistUnconfigured = (): void => {
  if (allowlistWarningShown || isAllowlistConfigured()) return;

  allowlistWarningShown = true;
  console.warn(allowlistWarning);
};

export const __resetAllowlistWarningForTests = (): void => {
  allowlistWarningShown = false;
};

export const decideTokenAccess = (input: {
  pathname: string;
  email: string | null | undefined;
}): TokenAccessDecision => {
  if (isAdminEmailAllowed(input.email)) return "next";
  return input.pathname.startsWith("/api/") ? "forbidden_json" : "forbidden_text";
};

export const maskEmailForLog = (email?: string | null): string => {
  if (!email) return "(none)";
  const normalized = normalizeEmail(email);
  const [localPart, domain = ""] = normalized.split("@");

  const maskedLocal =
    localPart.length <= 2
      ? `${localPart[0] ?? "*"}*`
      : `${localPart.slice(0, 2)}***`;

  return domain ? `${maskedLocal}@${domain}` : maskedLocal;
};
