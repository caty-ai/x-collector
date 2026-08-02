const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const PROD_RUNTIME_TIMEZONE = process.env.PROD_RUNTIME_TIMEZONE || "Asia/Tokyo";

export function formatRuntimeTimestamp(
  base = new Date(),
  timeZone = PROD_RUNTIME_TIMEZONE,
): string {
  const local = base.toLocaleString("sv-SE", {
    timeZone,
    hour12: false,
  });
  return `${local} (${timeZone}) / utc=${base.toISOString()}`;
}

export function getDateKeyInJst(base = new Date()): string {
  return new Date(base.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function validateDateKeyJst(raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid date format: ${raw}. Expected YYYY-MM-DD`);
  }
  return raw;
}

export function toStep4DateJst(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000+09:00`);
}

export function toPipelineDateUtc(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  { min = 1, max }: { min?: number; max?: number } = {},
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  if (parsed < min) {
    console.warn(
      `[prod-schedule] WARN value=${parsed} is below min=${min}; using fallback=${fallback}`,
    );
    return fallback;
  }
  if (typeof max === "number" && parsed > max) {
    console.warn(`[prod-schedule] WARN value=${parsed} exceeds max=${max}; clamped to max=${max}`);
    return max;
  }
  return parsed;
}

export function assertRequiredEnv(keys: string[]): void {
  const missing = keys.filter((key) => !process.env[key] || !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
}
