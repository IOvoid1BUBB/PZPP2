import type { LegCostRow } from "@/lib/api/profitClient";
import { getLegColor, getMaxLegWeightKg } from "@/lib/map/legColors";

export interface LegConsumptionBarRow {
  key: string;
  label: string;
  consumptionL100km: number;
  loadRatio: number;
  fill: string;
  distanceKm: number;
  liters: number;
  costEur: number;
}

/** 0-based leg index → "Leg 1", "Leg 2", … */
export function formatLegLabel(legIndex: number): string {
  return `Leg ${legIndex + 1}`;
}

export function buildLegConsumptionData(
  legCosts: LegCostRow[],
): LegConsumptionBarRow[] {
  if (legCosts.length === 0) {
    return [];
  }

  const maxWeightKg = getMaxLegWeightKg(
    legCosts.map((leg) => ({ weightKgAtLeg: leg.weightKgAtLeg })),
  );

  return legCosts.map((leg) => ({
    key: `leg-${leg.legIndex}`,
    label: formatLegLabel(leg.legIndex),
    consumptionL100km: leg.consumptionL100km,
    loadRatio: leg.loadRatio,
    fill: getLegColor(leg.weightKgAtLeg, maxWeightKg, leg.loadRatio),
    distanceKm: leg.distanceKm,
    liters: leg.liters,
    costEur: leg.costEur,
  }));
}

export function getLegConsumptionYDomain(
  rows: LegConsumptionBarRow[],
): { yMin: number; yMax: number } {
  if (rows.length === 0) {
    return { yMin: 0, yMax: 50 };
  }

  const peak = Math.max(...rows.map((row) => row.consumptionL100km));
  return {
    yMin: 0,
    yMax: Math.ceil((peak * 1.15) / 5) * 5,
  };
}

export function formatConsumption(value: number): string {
  return `${value.toLocaleString("pl-PL", { maximumFractionDigits: 1 })} L/100km`;
}

export function formatLoadRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}% obciążenia`;
}
