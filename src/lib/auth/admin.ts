const normalizeEmail = (value: string): string => {
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

export const isAdminRoute = (pathname: string): boolean => {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
};

export const isAdminEmailAllowed = (email?: string | null): boolean => {
  const allowlist = getAllowlist();
  if (allowlist.size === 0) return false; // fail-close
  if (!email) return false;
  return allowlist.has(normalizeEmail(email));
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
