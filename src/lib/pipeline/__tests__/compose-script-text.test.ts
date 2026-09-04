import { describe, expect, it } from "vitest";
import {
  clipSummary,
  splitSummaryLines,
  truncateWithEllipsis,
} from "../compose-script-text";

function isWellFormedString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

describe("splitSummaryLines", () => {
  it("splits Japanese and whitespace-delimited ASCII terminators", () => {
    expect(splitSummaryLines("一文目。二文目！三文目？" )).toEqual(["一文目。", "二文目！", "三文目？"]);
    expect(splitSummaryLines("First. Second! Third?" )).toEqual(["First.", "Second!", "Third?"]);
  });

  it("keeps dots inside versions, filenames, decimals, and URLs", () => {
    const text = "Use 2.0, v1.2.3, settings.local.json, and https://a.b/c.d today.";
    expect(splitSummaryLines(text)).toEqual([text]);
  });

  it("does not split one- or two-digit list markers", () => {
    expect(splitSummaryLines("1. item" )).toEqual(["1. item"]);
    expect(splitSummaryLines("(12. foo)" )).toEqual(["(12. foo)"]);
  });

  it("keeps terminator runs and closing characters with their sentence", () => {
    expect(splitSummaryLines("驚いた!? 次です。" )).toEqual(["驚いた!?", "次です。"]);
    expect(splitSummaryLines("「完了。」 次。" )).toEqual(["「完了。」", "次。"]);
    expect(splitSummaryLines("Done.) Next.” End.]" )).toEqual(["Done.)", "Next.”", "End.]"]);
  });

  it("guards common abbreviations and lowercase continuations", () => {
    expect(splitSummaryLines("Acme Inc. announced it." )).toEqual(["Acme Inc. announced it."]);
    expect(splitSummaryLines("Use e.g. this form." )).toEqual(["Use e.g. this form."]);
    expect(splitSummaryLines("U.S. officials spoke." )).toEqual(["U.S. officials spoke."]);
    expect(splitSummaryLines("A vs. B differs." )).toEqual(["A vs. B differs."]);
    expect(splitSummaryLines("This is the end. Next begins." )).toEqual([
      "This is the end.",
      "Next begins.",
    ]);
  });

  it("documents accepted numeric sentence heuristics", () => {
    expect(splitSummaryLines("The index fell to 12. Markets reacted." )).toEqual([
      "The index fell to 12. Markets reacted.",
    ]);
    expect(splitSummaryLines("The score is 42. Next one follows." )).toEqual([
      "The score is 42. Next one follows.",
    ]);
    expect(splitSummaryLines("100. item" )).toEqual(["100.", "item"]);
  });

  it("uses one empty fallback for whitespace and punctuation-only input", () => {
    expect(splitSummaryLines("  ")).toEqual(["概要情報なし。"]);
    expect(splitSummaryLines("。。。" )).toEqual(["概要情報なし。"]);
  });

  it("keeps a single long sentence as one well-formed line", () => {
    const text = `long${"😀".repeat(30)}sentence`;
    const result = splitSummaryLines(text);
    expect(result).toEqual([text]);
    expect(result.every(isWellFormedString)).toBe(true);
  });

  it("does not cap at three sentences and folds over eight without losing text", () => {
    expect(splitSummaryLines("一。二。三。四。五。" )).toHaveLength(5);
    const text = Array.from({ length: 20 }, (_, index) => `${index + 1}個。`).join("");
    const lines = splitSummaryLines(text);
    expect(lines).toHaveLength(8);
    expect(lines.join(" ").replace(/ /g, "")).toBe(text);
  });
});

describe("clipSummary", () => {
  it("returns short text unchanged", () => {
    expect(clipSummary("short", 10)).toBe("short");
  });

  it("clips at the last sentence boundary within the limit when at least half remains", () => {
    expect(clipSummary("12345。6789012345。tail", 12)).toBe("12345。");
  });

  it("falls back to a bounded ellipsis when the boundary is too early", () => {
    const result = clipSummary("短。abcdefghijklmnop", 10);
    expect(result).toBe("短。abcdefg…");
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("keeps surrogate pairs intact at fallback cut points", () => {
    const result = truncateWithEllipsis("abc😀def", 5);
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result.endsWith("…")).toBe(true);
    expect(isWellFormedString(result)).toBe(true);
  });
});
