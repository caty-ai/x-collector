import { describe, expect, it } from "vitest";
import { buildEditionWindow, editionKey } from "../edition";

describe("edition invariants", () => {
  it("tiles the JST delivery window and edition key consistently", () => {
    const editionDate = new Date("2026-03-11T00:00:00.000Z");
    const window = buildEditionWindow(editionDate);

    expect(window.startUtc.toISOString()).toBe("2026-03-09T21:00:00.000Z");
    expect(window.endUtcExclusive.toISOString()).toBe("2026-03-10T21:00:00.000Z");

    const probes = [
      ["2026-03-09T20:59:59.999Z", "2026-03-10"],
      ["2026-03-09T21:00:00.000Z", "2026-03-11"],
      ["2026-03-10T20:59:59.999Z", "2026-03-11"],
      ["2026-03-10T21:00:00.000Z", "2026-03-12"],
      ["2026-04-30T20:59:59.999Z", "2026-05-01"],
      ["2026-04-30T21:00:00.000Z", "2026-05-02"],
    ] as const;

    for (const [iso, expected] of probes) {
      expect(editionKey(new Date(iso)), iso).toBe(expected);
    }

    for (let offset = -72; offset <= 72; offset += 3) {
      const timestamp = new Date(window.startUtc.getTime() + offset * 60 * 60 * 1000);
      const within = timestamp >= window.startUtc && timestamp < window.endUtcExclusive;
      expect(editionKey(timestamp) === "2026-03-11", timestamp.toISOString()).toBe(within);
    }
  });
});
