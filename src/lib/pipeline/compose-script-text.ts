import { isHighSurrogate, isLowSurrogate } from "./text-sanitize";

export const EMPTY_SUMMARY = "概要情報なし。";

const JAPANESE_TERMINATORS = new Set(["。", "！", "？"]);
const ASCII_TERMINATORS = new Set([".", "!", "?"]);
const CLOSING_CHARACTERS = new Set([
  "」",
  "』",
  "）",
  ")",
  '"',
  "'",
  "”",
  "’",
  "】",
  "〕",
  "〙",
  "〉",
  "》",
  "]",
]);
const ABBREVIATIONS = new Set(
  [
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "no", "vs", "etc", "inc",
    "ltd", "co", "corp", "e.g", "i.e", "u.s", "u.k", "a.m", "p.m", "fig", "vol",
    "sept", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "jun", "jul", "aug",
  ].map((value) => value.replace(/\./g, "")),
);

function isSentenceTerminator(character: string): boolean {
  return JAPANESE_TERMINATORS.has(character) || ASCII_TERMINATORS.has(character);
}

function isAsciiDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isBareShortNumberBeforePeriod(text: string, periodIndex: number): boolean {
  let start = periodIndex;
  let digitCount = 0;

  while (start > 0 && digitCount < 3 && isAsciiDigit(text[start - 1])) {
    start -= 1;
    digitCount += 1;
  }

  if (digitCount < 1 || digitCount > 2) return false;
  if (start === 0) return true;
  return !/[A-Za-z0-9_]/.test(text[start - 1]);
}

function precedingAsciiToken(text: string, periodIndex: number): string {
  let start = periodIndex;
  while (start > 0 && /[A-Za-z.]/.test(text[start - 1])) start -= 1;
  return text.slice(start, periodIndex + 1).replace(/\./g, "").toLowerCase();
}

function isSuppressedAsciiPeriod(text: string, periodIndex: number, afterBoundary: number): boolean {
  if (isBareShortNumberBeforePeriod(text, periodIndex)) return true;
  const leadingWord = precedingAsciiToken(text, periodIndex);
  if (ABBREVIATIONS.has(leadingWord)) return true;

  let next = afterBoundary;
  while (next < text.length && /\s/.test(text[next])) next += 1;
  return leadingWord.length > 0 && next < text.length && /[a-z]/.test(text[next]);
}

function sentenceBoundaryEnds(text: string): number[] {
  const boundaries: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (!isSentenceTerminator(character)) continue;

    let terminatorEnd = index + 1;
    while (terminatorEnd < text.length && isSentenceTerminator(text[terminatorEnd])) {
      terminatorEnd += 1;
    }

    let end = terminatorEnd;
    while (end < text.length && CLOSING_CHARACTERS.has(text[end])) end += 1;

    const run = text.slice(index, terminatorEnd);
    const containsJapanese = Array.from(run).some((value) => JAPANESE_TERMINATORS.has(value));
    const followedByWhitespaceOrEnd = end === text.length || /\s/.test(text[end]);
    const suppressedPeriod =
      run === "." && !containsJapanese && isSuppressedAsciiPeriod(text, index, end);

    if ((containsJapanese || followedByWhitespaceOrEnd) && !suppressedPeriod) {
      boundaries.push(end);
      index = end - 1;
    }
  }

  return boundaries;
}

function isSplitSurrogatePair(input: string, cutIndex: number): boolean {
  if (cutIndex <= 0 || cutIndex >= input.length) return false;
  return (
    isHighSurrogate(input.charCodeAt(cutIndex - 1)) && isLowSurrogate(input.charCodeAt(cutIndex))
  );
}

/**
 * Cut-point is surrogate-pair-safe, but output is not guaranteed well-formed
 * for already-ill-formed input. Call sanitizeToWellFormed before persistence.
 */
export function truncateWithEllipsis(input: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (input.length <= maxChars) return input;
  const cutIndex = Math.max(0, maxChars - 1);
  const safeCutIndex = isSplitSurrogatePair(input, cutIndex) ? cutIndex - 1 : cutIndex;
  return `${input.slice(0, safeCutIndex).trimEnd()}…`;
}

function containsSummaryText(value: string): boolean {
  for (const character of value) {
    if (!/\s/.test(character) && !isSentenceTerminator(character) && !CLOSING_CHARACTERS.has(character)) {
      return true;
    }
  }
  return false;
}

export function splitSummaryLines(text: string): string[] {
  const summary = text.trim();
  if (!summary) return [EMPTY_SUMMARY];

  const lines: string[] = [];
  let start = 0;

  for (const end of sentenceBoundaryEnds(summary)) {
    const sentence = summary.slice(start, end).trim();
    if (sentence && containsSummaryText(sentence)) lines.push(sentence);
    start = end;
  }

  const remainder = summary.slice(start).trim();
  if (remainder && containsSummaryText(remainder)) lines.push(remainder);

  if (lines.length === 0) return [EMPTY_SUMMARY];
  if (lines.length <= 8) return lines;
  return [...lines.slice(0, 7), lines.slice(7).join(" ")];
}

export function clipSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const minimumBoundaryLength = Math.ceil(maxChars / 2);
  const eligibleBoundaries = sentenceBoundaryEnds(text).filter((end) => end <= maxChars);
  const boundary = eligibleBoundaries[eligibleBoundaries.length - 1];

  if (boundary !== undefined) {
    const clipped = text.slice(0, boundary).trimEnd();
    if (clipped.length >= minimumBoundaryLength) return clipped;
  }

  return truncateWithEllipsis(text, maxChars);
}
