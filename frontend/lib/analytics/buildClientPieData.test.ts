import { describe, expect, it } from "vitest";

import { getClientColorHex } from "@/components/planner/TrailerCanvas";
import type { ProfitBreakdownData } from "@/lib/api/profitClient";
import type { PalletData } from "@/lib/types/load";

import {
  buildClientPieData,
  ESTIMATED_RATE_PER_LDM,
  formatLdm,
  formatPieTooltipValue,
  shouldUseApiRevenue,
  type ClientSummaryInput,
} from "./buildClientPieData";

function makePallet(overrides: Partial<PalletData> = {}): PalletData {
  return {
    id: "pallet-1",
    offerId: "offer-a",
    clientId: "client-a",
    clientName: "Acme",
    clientColor: "#000",
    ldm: 2,
    weightKg: 400,
    dims: { wMm: 800, dMm: 1200, hMm: 1000 },
    stackable: true,
    timeWindow: null,
    ...overrides,
  };
}

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
      fuel: {},
      toll: {},
      stops: {},
      driver: {},
      maintenance: {},
    },
    legs: [],
    legCosts: [],
    offerRevenue: [{ offerId: "offer-a", revenueEur: 1200 }],
    fromApi: true,
    ...overrides,
  };
}

const clientA: ClientSummaryInput = {
  clientId: "client-a",
  offerId: "offer-a",
  name: "Acme",
  ldm: 4,
};

const clientB: ClientSummaryInput = {
  clientId: "client-b",
  offerId: "offer-b",
  name: "Beta",
  ldm: 2,
};

describe("buildClientPieData", () => {
  it("returns empty array when client summary is empty", () => {
    expect(buildClientPieData([], {}, undefined)).toEqual([]);
  });

  it("uses API revenue per client when offer revenue is available", () => {
    const slots = {
      s1: makePallet({ offerId: "offer-a", clientId: "client-a", ldm: 2 }),
      s2: makePallet({ offerId: "offer-a2", clientId: "client-a", ldm: 2 }),
      s3: makePallet({
        offerId: "offer-b",
        clientId: "client-b",
        clientName: "Beta",
        ldm: 2,
      }),
    };
    const data = makeBreakdown({
      offerRevenue: [
        { offerId: "offer-a", revenueEur: 800 },
        { offerId: "offer-a2", revenueEur: 400 },
        { offerId: "offer-b", revenueEur: 600 },
      ],
    });

    const slices = buildClientPieData([clientA, clientB], slots, data);

    expect(slices).toHaveLength(2);
    expect(slices[0]).toMatchObject({
      name: "Acme",
      value: 1200,
      valueSource: "revenue",
      ldm: 4,
    });
    expect(slices[1]).toMatchObject({
      name: "Beta",
      value: 600,
      valueSource: "revenue",
    });
  });

  it("falls back to ldm × estimated rate when API revenue is unavailable", () => {
    const slots = { s1: makePallet() };
    const data = makeBreakdown({ fromApi: false, offerRevenue: [] });

    const slices = buildClientPieData([clientA], slots, data);

    expect(slices[0].value).toBe(Math.round(4 * ESTIMATED_RATE_PER_LDM));
    expect(slices[0].valueSource).toBe("estimated");
  });

  it("falls back to estimated values when fromApi is true but offer revenue is empty", () => {
    const slots = { s1: makePallet() };

    const slices = buildClientPieData(
      [clientA],
      slots,
      makeBreakdown({ fromApi: true, offerRevenue: [] }),
    );

    expect(slices[0].valueSource).toBe("estimated");
    expect(slices[0].value).toBe(Math.round(clientA.ldm * ESTIMATED_RATE_PER_LDM));
  });

  it("assigns segment colors via getClientColorHex(offerId)", () => {
    const slots = { s1: makePallet() };

    const slices = buildClientPieData([clientA], slots, undefined, false);

    expect(slices[0].fill).toBe(getClientColorHex("offer-a", false));
  });

  it("uses dark palette when isDark is true", () => {
    const slots = { s1: makePallet() };

    const slices = buildClientPieData([clientA], slots, undefined, true);

    expect(slices[0].fill).toBe(getClientColorHex("offer-a", true));
  });

  it("ignores pallets from other clients when summing revenue", () => {
    const slots = {
      s1: makePallet({ offerId: "offer-a", clientId: "client-a" }),
      s2: makePallet({
        offerId: "offer-b",
        clientId: "client-b",
        clientName: "Beta",
      }),
    };
    const data = makeBreakdown({
      offerRevenue: [
        { offerId: "offer-a", revenueEur: 500 },
        { offerId: "offer-b", revenueEur: 900 },
      ],
    });

    const slices = buildClientPieData([clientA], slots, data);

    expect(slices).toHaveLength(1);
    expect(slices[0].value).toBe(500);
  });
});

describe("shouldUseApiRevenue", () => {
  it("is true only when breakdown is from API with offer rows", () => {
    expect(shouldUseApiRevenue(undefined)).toBe(false);
    expect(shouldUseApiRevenue(makeBreakdown({ fromApi: false }))).toBe(false);
    expect(
      shouldUseApiRevenue(makeBreakdown({ fromApi: true, offerRevenue: [] })),
    ).toBe(false);
    expect(shouldUseApiRevenue(makeBreakdown())).toBe(true);
  });
});

describe("formatPieTooltipValue", () => {
  it("formats API revenue as EUR", () => {
    expect(
      formatPieTooltipValue({
        clientId: "c1",
        offerId: "o1",
        name: "Acme",
        value: 1500,
        ldm: 4,
        valueSource: "revenue",
        fill: "#000",
      }),
    ).toBe("1500 EUR");
  });

  it("formats estimated share as LDM and EUR", () => {
    const text = formatPieTooltipValue({
      clientId: "c1",
      offerId: "o1",
      name: "Acme",
      value: 750,
      ldm: 4,
      valueSource: "estimated",
      fill: "#000",
    });

    expect(text).toContain("4,0 LDM");
    expect(text).toContain("750 EUR");
    expect(text).toContain("(szac.)");
  });
});

describe("formatLdm", () => {
  it("uses Polish locale with one decimal", () => {
    expect(formatLdm(3.5)).toBe("3,5 LDM");
  });
});
