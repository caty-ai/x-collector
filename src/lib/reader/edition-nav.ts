export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRoundTripIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function todayJstIsoDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function resolveEditionDate(
  raw: string | string[] | null | undefined,
  now = new Date(),
  fallback?: string,
): string {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (candidate && isRoundTripIsoDate(candidate)) return candidate;
  if (fallback && isRoundTripIsoDate(fallback)) return fallback;
  return todayJstIsoDate(now);
}

export function shiftIsoDate(date: string, deltaDays: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

export function buildEditionPath(date: string): string {
  return `/calendar?date=${date}`;
}

export function formatEditionDateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("ja-JP-u-ca-japanese", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function isAcceptablePublicDate(date: string, now = new Date()): boolean {
  if (!isRoundTripIsoDate(date) || date < "2020-01-01") return false;
  return date <= shiftIsoDate(todayJstIsoDate(now), 1);
}
