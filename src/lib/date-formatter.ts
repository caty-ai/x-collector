export const JST_TIME_ZONE = "Asia/Tokyo";

function toDate(input: string | Date): Date {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date input: ${input}`);
  }
  return date;
}

/**
 * API returns UTC ISO strings; UI must convert in one shared formatter
 * (docs/api-contract-ui-v1.md section 4, note #4).
 */
export function formatUtcToJstDateTime(input: string | Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: JST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(toDate(input));
}

export function formatUtcToJstDate(input: string | Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: JST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(toDate(input));
}
