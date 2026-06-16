import { describe, expect, it } from "vitest";

import {
  getLegColor,
  getLegColorByRatio,
  getMaxLegWeightKg,
  HEAT_MAP_LEGEND,
} from "@/lib/map/legColors";

const BLUE = "#4E9AF1";
const ORANGE = "#F5A623";
const RED = "#E8564A";
const DARK_RED = "#C0392B";

describe("getLegColorByRatio", () => {
  it("returns blue under 30%", () => {
    expect(getLegColorByRatio(0.1)).toBe(BLUE);
  });

  it("returns orange between 30% and 60%", () => {
    expect(getLegColorByRatio(0.45)).toBe(ORANGE);
  });

  it("returns red between 60% and 85%", () => {
    expect(getLegColorByRatio(0.7)).toBe(RED);
  });

  it("returns dark red at or above 85%", () => {
    expect(getLegColorByRatio(0.9)).toBe(DARK_RED);
    expect(getLegColorByRatio(1.5)).toBe(DARK_RED);
  });

  it("treats non-finite or negative input as zero", () => {
    expect(getLegColorByRatio(Number.NaN)).toBe(BLUE);
    expect(getLegColorByRatio(-1)).toBe(BLUE);
  });
});

describe("getLegColor", () => {
  it("prefers the provided load ratio", () => {
    // weight ratio would be ~0.04 (blue) but loadRatio 0.7 wins → red
    expect(getLegColor(1000, 24000, 0.7)).toBe(RED);
  });

  it("falls back to weight / maxWeight when ratio absent", () => {
    expect(getLegColor(18000, 24000)).toBe(RED); // 0.75
    expect(getLegColor(1000, 24000)).toBe(BLUE); // ~0.04
  });

  it("honors an explicit zero ratio as an empty leg (blue)", () => {
    // loadRatio === 0 is a real value (empty leg); it must NOT fall back to weight.
    expect(getLegColor(23000, 24000, 0)).toBe(BLUE);
  });

  it("returns blue when maxWeight is non-positive and no ratio", () => {
    expect(getLegColor(5000, 0)).toBe(BLUE);
  });

  it("yields at least three distinct colors for varied loads", () => {
    const colors = new Set([
      getLegColor(0, 24000, 0.1),
      getLegColor(0, 24000, 0.45),
      getLegColor(0, 24000, 0.7),
      getLegColor(0, 24000, 0.95),
    ]);
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });
});

describe("getMaxLegWeightKg", () => {
  it("returns 1 for an empty list", () => {
    expect(getMaxLegWeightKg([])).toBe(1);
  });

  it("returns the heaviest leg weight", () => {
    expect(
      getMaxLegWeightKg([
        { weightKgAtLeg: 3000 },
        { weightKgAtLeg: 9000 },
        { weightKgAtLeg: 5000 },
      ]),
    ).toBe(9000);
  });
});

describe("HEAT_MAP_LEGEND", () => {
  it("has four levels", () => {
    expect(HEAT_MAP_LEGEND).toHaveLength(4);
  });
});
