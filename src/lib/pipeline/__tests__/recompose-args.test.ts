import { describe, expect, it } from "vitest";
import { parseArgs } from "../../../collector/recompose-args";
import { getDateKeyInJst } from "../../../collector/prod-schedule-utils";

describe("parseArgs", () => {
  it("defaults to today in JST and a write run", () => {
    expect(parseArgs([])).toEqual({ dateKeyJst: getDateKeyInJst(), dryRun: false });
  });

  it("accepts equals and separated flag forms", () => {
    expect(parseArgs(["--dry-run", "--date-jst=2026-09-04", "--out=result.md"])).toEqual({
      dateKeyJst: "2026-09-04",
      dryRun: true,
      outFile: "result.md",
    });
    expect(parseArgs(["--date-jst", "2026-09-05", "--out", "next.md"])).toEqual({
      dateKeyJst: "2026-09-05",
      dryRun: false,
      outFile: "next.md",
    });
  });

  it("rejects invalid dates, missing output values, and unknown arguments", () => {
    expect(() => parseArgs(["--date-jst=2026/09/04"])).toThrow("Invalid date format");
    expect(() => parseArgs(["--out"])).toThrow("Missing value for --out");
    expect(() => parseArgs(["--out="])).toThrow("Missing value for --out");
    expect(() => parseArgs(["--bogus"])).toThrow("Unknown argument: --bogus");
  });
});
