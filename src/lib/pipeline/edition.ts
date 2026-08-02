import { getMasthead } from "../masthead";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const JST_OFFSET_MS = 9 * HOUR_MS;
const EDITION_KEY_SHIFT_MS = 18 * HOUR_MS;

export interface EditionWindow {
  dateKeyJst: string;
  startUtc: Date;
  endUtcExclusive: Date;
}

export function formatDateKey(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getUTCDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateKeyJst(date: Date): string {
  return formatDateKey(new Date(date.getTime() + JST_OFFSET_MS));
}

// Delivery-date label for the half-open window [X-1 06:00 JST, X 06:00 JST).
export function editionKey(timestamp: Date): string {
  return dateKeyJst(new Date(timestamp.getTime() + EDITION_KEY_SHIFT_MS));
}

export function buildEditionWindow(editionDate: Date): EditionWindow {
  const key = formatDateKey(editionDate);
  const endUtcExclusive = new Date(`${key}T06:00:00.000+09:00`);

  return {
    dateKeyJst: key,
    startUtc: new Date(endUtcExclusive.getTime() - DAY_MS),
    endUtcExclusive,
  };
}

// Slugs are intentionally masthead-independent URL and identity keys.
export function buildEditionSlug(date: Date): string {
  return `ai-daily-news-${formatDateKey(date).replace(/-/g, "")}`;
}

// builds "YYYY年MM月DD日 <masthead>" from a UTC-midnight Date (editionDate)
export function buildEditionTitle(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getUTCDate()}`.padStart(2, "0");
  return `${yyyy}年${mm}月${dd}日 ${getMasthead()}`;
}
