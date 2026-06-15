import { describe, expect, it } from "vitest";

import type { LegCostRow } from "@/lib/api/profitClient";
import { getLegColorByRatio } from "@/lib/map/legColors";
import {
  buildLegConsumptionData,
  formatConsumption,
  formatLegLabel,
  formatLoadRatio,
  getLegConsumptionYDomain,
} from "./buildLegConsumptionData";

function makeLegCost(
  overrides: Partial<LegCostRow> = {},
  legIndex = 0,
): LegCostRow {
  return {
    legIndex,
    distanceKm: 100,
    durationMinutes: 60,
    weightKgAtLeg: 5000,
    loadRatio: 0.2,
    consumptionL100km: 22.5,
    liters: 22.5,
    costEur: 45,
    ...overrides,
  };
}

describe("formatLegLabel", () => {
  it("maps 0-based index to Leg 1..n", () => {
    expect(formatLegLabel(0)).toBe("Leg 1");
    expect(formatLegLabel(2)).toBe("Leg 3");
  });
});

describe("buildLegConsumptionData", () => {
  it("returns empty array when leg_costs is empty", () => {
    expect(buildLegConsumptionData([])).toEqual([]);
  });

  it("maps one row per leg_cost with consumption and heat-map fill", () => {
    const legCosts = [
      makeLegCost({ loadRatio: 0.1, consumptionL100km: 18.5 }, 0),
      makeLegCost({ loadRatio: 0.75, consumptionL100km: 28.2 }, 1),
    ];

    const rows = buildLegConsumptionData(legCosts);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      key: "leg-0",
      label: "Leg 1",
      consumptionL100km: 18.5,
      loadRatio: 0.1,
      fill: getLegColorByRatio(0.1),
    });
    expect(rows[1]).toMatchObject({
      key: "leg-1",
      label: "Leg 2",
      consumptionL100km: 28.2,
      fill: getLegColorByRatio(0.75),
    });
  });

  it("preserves leg_costs order and count", () => {
    const legCosts = [
      makeLegCost({ legIndex: 0 }, 0),
      makeLegCost({ legIndex: 1 }, 1),
      makeLegCost({ legIndex: 2 }, 2),
    ];

    expect(buildLegConsumptionData(legCosts)).toHaveLength(legCosts.length);
  });
});

describe("getLegConsumptionYDomain", () => {
  it("pads peak consumption to a 5 L/100km grid", () => {
    const rows = buildLegConsumptionData([
      makeLegCost({ consumptionL100km: 23.4 }),
      makeLegCost({ consumptionL100km: 31.2 }, 1),
    ]);

    expect(getLegConsumptionYDomain(rows)).toEqual({ yMin: 0, yMax: 40 });
  });

  it("falls back when there are no rows", () => {
    expect(getLegConsumptionYDomain([])).toEqual({ yMin: 0, yMax: 50 });
  });
});

describe("formatters", () => {
  it("formats consumption and load ratio for tooltips", () => {
    expect(formatConsumption(22.5)).toBe("22,5 L/100km");
    expect(formatLoadRatio(0.42)).toBe("42% obciążenia");
  });
});
