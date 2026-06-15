import { describe, expect, it } from "vitest";

import { aggregateWeeklyEurLdm } from "@/lib/market/aggregateWeeklyEurLdm";
import type { MarketOffer } from "@/lib/api/marketClient";

// 2026-06-15 to poniedziałek 12:00 UTC.
const NOW = new Date("2026-06-15T12:00:00Z").getTime();

function offer(
  timeWindowOpen: string | null,
  eurPerLdm: number,
  id = Math.random().toString(36).slice(2),
): MarketOffer {
  return {
    id,
    pickup: { lon: 21, lat: 52 },
    delivery: { lon: 13, lat: 52 },
    ldm: 2,
    weightKg: 200,
    priceEur: eurPerLdm * 2,
    timeWindowOpen,
    timeWindowClose: null,
    handlingTimeMinutes: null,
    stackable: true,
    isWithinCorridor: false,
    eurPerLdm,
  };
}

describe("aggregateWeeklyEurLdm", () => {
  it("returns four week buckets ordered oldest → newest", () => {
    const buckets = aggregateWeeklyEurLdm([], NOW);
    expect(buckets).toHaveLength(4);
    expect(buckets.map((b) => b.label)).toEqual([
      "Week 1",
      "Week 2",
      "Week 3",
      "Week 4",
    ]);
  });

  it("averages EUR/LDM per day within the current week", () => {
    const offers = [
      offer("2026-06-15T08:00:00Z", 2.0),
      offer("2026-06-15T09:00:00Z", 4.0),
    ];
    const buckets = aggregateWeeklyEurLdm(offers, NOW);
    const currentWeek = buckets[buckets.length - 1]; // Week 4 = bucket 0
    expect(currentWeek.avgValue).toBe(3.0);
    // poniedziałek → indeks 0
    expect(currentWeek.bars[0]).toBe(3.0);
  });

  it("buckets offers into the correct prior week", () => {
    const offers = [offer("2026-06-08T10:00:00Z", 1.5)];
    const buckets = aggregateWeeklyEurLdm(offers, NOW);
    const lastWeek = buckets[buckets.length - 2]; // bucket 1
    expect(lastWeek.avgValue).toBe(1.5);
    expect(buckets[buckets.length - 1].avgValue).toBe(0);
  });

  it("ignores offers without timestamps or with non-positive EUR/LDM", () => {
    const offers = [offer(null, 2.0), offer("2026-06-15T08:00:00Z", 0)];
    const buckets = aggregateWeeklyEurLdm(offers, NOW);
    expect(buckets.every((b) => b.avgValue === 0)).toBe(true);
  });
});
