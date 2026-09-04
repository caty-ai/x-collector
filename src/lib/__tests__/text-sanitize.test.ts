import { describe, expect, it } from "vitest";
import {
  sanitizeToWellFormed,
} from "../pipeline/text-sanitize";
import {
  splitSummaryLines,
  truncateWithEllipsis,
} from "../pipeline/compose-edition-script";

function isWellFormedString(value: string): boolean {
  const nativeCheck = (value as unknown as { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof nativeCheck === "function") {
    return nativeCheck.call(value);
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }

  return true;
}

describe("text sanitization invariants", () => {
  it("keeps surrogate-pair truncation well formed at boundary cut points", () => {
    const truncationInput = `abc${"\u{1f600}"}def`;
    const truncationMaxChars = 5;
    const result = truncateWithEllipsis(truncationInput, truncationMaxChars);

    expect(result.length).toBeLessThanOrEqual(truncationMaxChars);
    expect(isWellFormedString(result)).toBe(true);
    expect(result.endsWith("…")).toBe(true);
  });

  it("keeps a single sentence with a surrogate pair as one well-formed line", () => {
    const parts = splitSummaryLines(`abcd${"\u{1f600}"}efg`);

    expect(parts).toHaveLength(1);
    expect(parts.every(isWellFormedString)).toBe(true);
  });

  it("sanitizes lone surrogates and strips NULs without leaving malformed output", () => {
    const sanitized = sanitizeToWellFormed(
      `abc${String.fromCharCode(0xd800)}def${String.fromCharCode(0)}ghi`,
    );

    expect(isWellFormedString(sanitized.result)).toBe(true);
    expect(sanitized.result.includes(String.fromCharCode(0))).toBe(false);
    expect(sanitized.replacedCount).toBeGreaterThan(0);
  });

  it("preserves already well-formed content on no-op paths", () => {
    const normal = "normal short string";

    expect(truncateWithEllipsis(normal, 100)).toBe(normal);
    expect(sanitizeToWellFormed(normal).result).toBe(normal);
  });
});
