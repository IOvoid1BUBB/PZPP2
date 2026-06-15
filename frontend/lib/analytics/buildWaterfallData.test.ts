import { describe, expect, it } from "vitest";

import type { ProfitBreakdownData } from "@/lib/api/profitClient";
import {
  buildFormula,
  buildWaterfallData,
  COLOR_COST,
  COLOR_PROFIT,
  COLOR_REVENUE,
  formatEur,
  getBarFill,
  getWaterfallYDomain,
} from "./buildWaterfallData";

function makeBreakdown(
  overrides: Partial<ProfitBreakdownData> = {},
): ProfitBreakdownData {
  return {
    revenueEur: 2000,
    fuelEur: 400,
    tollEur: 150,
    stopCostsEur: 80,
    driverEur: 200,
    maintenanceEur: 50,
    netProfitEur: 1120,
    stopCount: 3,
    formulas: {
      fuel: { litersTotal: 200, fuelPrice: 2 },
      toll: { distanceKm: 500 },
      stops: { stopCount: 3, perStopCost: 27 },
      driver: { daysOnRoad: 4, dailyAllowance: 50 },
      maintenance: { distanceKm: 500, maintRate: 0.1 },
    },
    legs: [{ legId: 1, fuelConsumption: 200 }],
    offerRevenue: [{ offerId: "offer-1", revenueEur: 2000 }],
    fromApi: true,
    ...overrides,
  };
}

describe("buildFormula", () => {
  it("builds fuel formula as liters × price", () => {
    expect(buildFormula("fuel", { litersTotal: 120, fuelPrice: 1.85 })).toBe(
      "120L × 1.85 EUR/L",
    );
  });

  it("builds toll formula as km × rate label", () => {
    expect(buildFormula("toll", { distanceKm: 420 })).toBe(
      "420 km × stawka per kraj",
    );
  });

  it("builds driver formula as days × allowance", () => {
    expect(
      buildFormula("driver", { daysOnRoad: 3, dailyAllowance: 45 }),
    ).toBe("3 dni × 45 EUR/dzień");
  });

  it("builds maintenance formula as km × rate", () => {
    expect(
      buildFormula("maintenance", { distanceKm: 600, maintRate: 0.12 }),
    ).toBe("600 km × 0.12 EUR/km");
  });

  it("returns undefined when formula inputs are missing", () => {
    expect(buildFormula("fuel", {})).toBeUndefined();
    expect(buildFormula("toll", {})).toBeUndefined();
    expect(buildFormula("driver", {})).toBeUndefined();
    expect(buildFormula("maintenance", {})).toBeUndefined();
  });
});

describe("getBarFill", () => {
  it("uses fixed hex colors for revenue and costs", () => {
    expect(getBarFill("revenue", 100)).toBe(COLOR_REVENUE);
    expect(getBarFill("cost", -50)).toBe(COLOR_COST);
  });

  it("uses profit purple for positive net and red for negative", () => {
    expect(getBarFill("profit", 300)).toBe(COLOR_PROFIT);
    expect(getBarFill("profit", -120)).toBe(COLOR_COST);
  });
});

describe("buildWaterfallData", () => {
  it("returns 7 bars when stop_count is at least 2", () => {
    const rows = buildWaterfallData(makeBreakdown({ stopCount: 2 }));

    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.label)).toEqual([
      "Przychód",
      "Paliwo",
      "Myto",
      "Przystanki",
      "Kierowca",
      "Serwis",
      "Zysk netto",
    ]);
  });

  it("omits Przystanki bar when stop_count is below 2", () => {
    const rows = buildWaterfallData(makeBreakdown({ stopCount: 1, stopCostsEur: 0 }));

    expect(rows).toHaveLength(6);
    expect(rows.some((row) => row.key === "stops")).toBe(false);
  });

  it("computes startY and range for floating waterfall segments", () => {
    const rows = buildWaterfallData(
      makeBreakdown({
        revenueEur: 1000,
        fuelEur: 200,
        tollEur: 100,
        stopCostsEur: 50,
        driverEur: 150,
        maintenanceEur: 50,
        netProfitEur: 450,
        stopCount: 2,
      }),
    );

    expect(rows[0]).toMatchObject({ key: "revenue", startY: 0, range: [0, 1000] });
    expect(rows[1]).toMatchObject({ key: "fuel", startY: 800, range: [800, 1000] });
    expect(rows[2]).toMatchObject({ key: "toll", startY: 700, range: [700, 800] });
    expect(rows[3]).toMatchObject({ key: "stops", startY: 650, range: [650, 700] });
    expect(rows[6]).toMatchObject({
      key: "profit",
      startY: 0,
      range: [0, 450],
      displayValue: 450,
      fill: COLOR_PROFIT,
    });
  });

  it("marks negative net profit with red fill and negative startY", () => {
    const rows = buildWaterfallData(
      makeBreakdown({
        revenueEur: 500,
        fuelEur: 300,
        tollEur: 100,
        stopCostsEur: 0,
        driverEur: 150,
        maintenanceEur: 50,
        netProfitEur: -100,
        stopCount: 1,
      }),
    );

    const profit = rows.find((row) => row.key === "profit");
    expect(profit).toMatchObject({
      displayValue: -100,
      startY: -100,
      range: [-100, 0],
      fill: COLOR_COST,
    });
  });

  it("attaches formulas to cost bars", () => {
    const rows = buildWaterfallData(makeBreakdown());

    expect(rows.find((row) => row.key === "fuel")?.formula).toBe("200L × 2 EUR/L");
    expect(rows.find((row) => row.key === "toll")?.formula).toBe(
      "500 km × stawka per kraj",
    );
    expect(rows.find((row) => row.key === "driver")?.formula).toBe(
      "4 dni × 50 EUR/dzień",
    );
    expect(rows.find((row) => row.key === "maintenance")?.formula).toBe(
      "500 km × 0.1 EUR/km",
    );
  });

  it("shows signed negative values on cost displayValue", () => {
    const rows = buildWaterfallData(makeBreakdown());
    const fuel = rows.find((row) => row.key === "fuel");

    expect(fuel?.displayValue).toBe(-400);
  });
});

describe("getWaterfallYDomain", () => {
  it("pads Y domain above revenue peak and below negative profit", () => {
    const rows = buildWaterfallData(
      makeBreakdown({ revenueEur: 1000, netProfitEur: -80, stopCount: 1 }),
    );
    const domain = getWaterfallYDomain(rows, 1000, -80);

    expect(domain.yMax).toBeGreaterThanOrEqual(1000);
    expect(domain.yMin).toBeLessThanOrEqual(-80);
  });
});

describe("formatEur", () => {
  it("prefixes positive signed values with plus", () => {
    expect(formatEur(430, true)).toMatch(/^\+/);
  });

  it("keeps minus sign for negative values", () => {
    expect(formatEur(-120)).toContain("-");
  });
});
