import type { ProfitBreakdownData } from "@/lib/api/profitClient";

/** Hard HEX — Recharts SVG fill cannot use CSS variables in dark mode. */
export const COLOR_REVENUE = "#1D9E75";
export const COLOR_COST = "#E24B4A";
export const COLOR_PROFIT = "#534AB7";

export type WaterfallBarKind = "revenue" | "cost" | "profit";

export interface WaterfallBarRow {
  key: string;
  label: string;
  /** Signed EUR value for labels and tooltips. */
  displayValue: number;
  /** Absolute bar height in EUR. */
  amount: number;
  /** Y-axis base for the floating waterfall segment. */
  startY: number;
  /** Recharts floating bar domain segment [yMin, yMax]. */
  range: [number, number];
  barKind: WaterfallBarKind;
  fill: string;
  formula?: string;
}

type FormulaKey = keyof ProfitBreakdownData["formulas"];

function toRange(startY: number, amount: number): [number, number] {
  return [startY, startY + amount];
}

export function getBarFill(barKind: WaterfallBarKind, displayValue: number): string {
  if (barKind === "revenue") return COLOR_REVENUE;
  if (barKind === "cost") return COLOR_COST;
  return displayValue >= 0 ? COLOR_PROFIT : COLOR_COST;
}

export function buildFormula(
  key: FormulaKey,
  meta: ProfitBreakdownData["formulas"][FormulaKey],
): string | undefined {
  switch (key) {
    case "fuel":
      if (meta.litersTotal != null && meta.fuelPrice != null) {
        return `${meta.litersTotal}L × ${meta.fuelPrice} EUR/L`;
      }
      return undefined;
    case "toll":
      if (meta.distanceKm != null) {
        return `${meta.distanceKm} km × stawka per kraj`;
      }
      return undefined;
    case "stops":
      if (meta.stopCount != null && meta.perStopCost != null) {
        return `${meta.stopCount} przystanków × ~${meta.perStopCost} EUR`;
      }
      return undefined;
    case "driver":
      if (meta.daysOnRoad != null && meta.dailyAllowance != null) {
        return `${meta.daysOnRoad} dni × ${meta.dailyAllowance} EUR/dzień`;
      }
      return undefined;
    case "maintenance":
      if (meta.distanceKm != null && meta.maintRate != null) {
        return `${meta.distanceKm} km × ${meta.maintRate} EUR/km`;
      }
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Builds 6 or 7 waterfall bars: Przychód, Paliwo, Myto, Przystanki (≥2 stops),
 * Kierowca, Serwis, Zysk netto — with startY for floating bar placement.
 */
export function buildWaterfallData(data: ProfitBreakdownData): WaterfallBarRow[] {
  const rows: WaterfallBarRow[] = [];
  let cursor = data.revenueEur;

  rows.push({
    key: "revenue",
    label: "Przychód",
    displayValue: data.revenueEur,
    amount: data.revenueEur,
    startY: 0,
    range: toRange(0, data.revenueEur),
    barKind: "revenue",
    fill: getBarFill("revenue", data.revenueEur),
  });

  const costItems: Array<{
    key: string;
    label: string;
    value: number;
    formulaKey: FormulaKey;
  }> = [
    { key: "fuel", label: "Paliwo", value: data.fuelEur, formulaKey: "fuel" },
    { key: "toll", label: "Myto", value: data.tollEur, formulaKey: "toll" },
    ...(data.stopCount >= 2
      ? [
          {
            key: "stops",
            label: "Przystanki",
            value: data.stopCostsEur,
            formulaKey: "stops" as const,
          },
        ]
      : []),
    {
      key: "driver",
      label: "Kierowca",
      value: data.driverEur,
      formulaKey: "driver",
    },
    {
      key: "maintenance",
      label: "Serwis",
      value: data.maintenanceEur,
      formulaKey: "maintenance",
    },
  ];

  for (const item of costItems) {
    cursor -= item.value;
    rows.push({
      key: item.key,
      label: item.label,
      displayValue: -item.value,
      amount: item.value,
      startY: cursor,
      range: toRange(cursor, item.value),
      barKind: "cost",
      fill: getBarFill("cost", -item.value),
      formula: buildFormula(item.formulaKey, data.formulas[item.formulaKey]),
    });
  }

  const net = data.netProfitEur;
  const profitStartY = net >= 0 ? 0 : net;

  rows.push({
    key: "profit",
    label: "Zysk netto",
    displayValue: net,
    amount: Math.abs(net),
    startY: profitStartY,
    range: toRange(profitStartY, Math.abs(net)),
    barKind: "profit",
    fill: getBarFill("profit", net),
  });

  return rows;
}

export function getWaterfallYDomain(
  rows: WaterfallBarRow[],
  revenueEur: number,
  netProfitEur: number,
): { yMin: number; yMax: number } {
  const peak = Math.max(
    revenueEur,
    ...rows.map((row) => row.startY + row.amount),
  );
  const floor = Math.min(0, ...rows.map((row) => row.startY), netProfitEur);

  return {
    yMax: Math.ceil((peak * 1.12) / 100) * 100,
    yMin: floor < 0 ? Math.floor((floor * 1.12) / 100) * 100 : 0,
  };
}

export function formatEur(value: number, signed = false): string {
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("pl-PL")} EUR`;
}
