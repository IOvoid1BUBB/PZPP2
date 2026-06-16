/**
 * Types and API client for POST /api/v1/sessions/{id}/profit.
 * Maps snake_case backend response → camelCase for React components.
 */

import { toNumber, toOptionalNumber } from "@/lib/api/coerce";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export interface CostFormulaMeta {
  litersTotal?: number;
  fuelPrice?: number;
  distanceKm?: number;
  stopCount?: number;
  perStopCost?: number;
  daysOnRoad?: number;
  dailyAllowance?: number;
  maintRate?: number;
}

export interface LegFuelRow {
  legId: number;
  fuelConsumption: number;
}

export interface LegCostRow {
  legIndex: number;
  distanceKm: number;
  durationMinutes: number;
  weightKgAtLeg: number;
  loadRatio: number;
  consumptionL100km: number;
  liters: number;
  costEur: number;
}

export interface OfferRevenueRow {
  offerId: string;
  revenueEur: number;
}

export interface ProfitBreakdownData {
  revenueEur: number;
  fuelEur: number;
  tollEur: number;
  stopCostsEur: number;
  driverEur: number;
  maintenanceEur: number;
  netProfitEur: number;
  stopCount: number;
  formulas: {
    fuel: CostFormulaMeta;
    toll: CostFormulaMeta;
    stops: CostFormulaMeta;
    driver: CostFormulaMeta;
    maintenance: CostFormulaMeta;
  };
  legs: LegFuelRow[];
  legCosts: LegCostRow[];
  offerRevenue: OfferRevenueRow[];
  /** True when data comes from API; false for local demo fallback. */
  fromApi: boolean;
}

interface CostFormulaApi {
  liters_total?: number | null;
  fuel_price?: number | null;
  distance_km?: number | null;
  stop_count?: number | null;
  per_stop_cost?: number | null;
  days_on_road?: number | null;
  daily_allowance?: number | null;
  maint_rate?: number | null;
}

interface SessionProfitBreakdownApi {
  revenue_eur: number;
  fuel_eur: number;
  toll_eur: number;
  stop_costs_eur: number;
  driver_eur: number;
  maintenance_eur: number;
  net_profit_eur: number;
  stop_count: number;
  formulas: {
    fuel: CostFormulaApi;
    toll: CostFormulaApi;
    stops: CostFormulaApi;
    driver: CostFormulaApi;
    maintenance: CostFormulaApi;
  };
  legs: Array<{ leg_id: number; fuel_consumption: number }>;
  leg_costs?: Array<{
    leg_index: number;
    distance_km: number;
    duration_minutes: number;
    weight_kg_at_leg: number;
    load_ratio: number;
    consumption_l100km: number;
    liters: number;
    cost_eur: number;
  }>;
  offer_revenue: Array<{ offer_id: string; revenue_eur: number }>;
}

function mapFormula(raw: CostFormulaApi): CostFormulaMeta {
  return {
    litersTotal: toOptionalNumber(raw.liters_total),
    fuelPrice: toOptionalNumber(raw.fuel_price),
    distanceKm: toOptionalNumber(raw.distance_km),
    stopCount: toOptionalNumber(raw.stop_count),
    perStopCost: toOptionalNumber(raw.per_stop_cost),
    daysOnRoad: toOptionalNumber(raw.days_on_road),
    dailyAllowance: toOptionalNumber(raw.daily_allowance),
    maintRate: toOptionalNumber(raw.maint_rate),
  };
}

export function mapProfitBreakdown(raw: SessionProfitBreakdownApi): ProfitBreakdownData {
  return {
    revenueEur: toNumber(raw.revenue_eur),
    fuelEur: toNumber(raw.fuel_eur),
    tollEur: toNumber(raw.toll_eur),
    stopCostsEur: toNumber(raw.stop_costs_eur),
    driverEur: toNumber(raw.driver_eur),
    maintenanceEur: toNumber(raw.maintenance_eur),
    netProfitEur: toNumber(raw.net_profit_eur),
    stopCount: toNumber(raw.stop_count),
    formulas: {
      fuel: mapFormula(raw.formulas.fuel),
      toll: mapFormula(raw.formulas.toll),
      stops: mapFormula(raw.formulas.stops),
      driver: mapFormula(raw.formulas.driver),
      maintenance: mapFormula(raw.formulas.maintenance),
    },
    legs: raw.legs.map((leg) => ({
      legId: leg.leg_id,
      fuelConsumption: toNumber(leg.fuel_consumption),
    })),
    legCosts: (raw.leg_costs ?? []).map((leg) => ({
      legIndex: leg.leg_index,
      distanceKm: leg.distance_km,
      durationMinutes: leg.duration_minutes,
      weightKgAtLeg: leg.weight_kg_at_leg,
      loadRatio: leg.load_ratio,
      consumptionL100km: leg.consumption_l100km,
      liters: leg.liters,
      costEur: leg.cost_eur,
    })),
    offerRevenue: raw.offer_revenue.map((row) => ({
      offerId: row.offer_id,
      revenueEur: toNumber(row.revenue_eur),
    })),
    fromApi: true,
  };
}

export class ProfitFetchError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ProfitFetchError";
    this.status = status;
  }
}

/**
 * Compute session profit breakdown on the backend and return chart-ready data.
 * Requires route stops on the session (422 when empty).
 */
export async function fetchSessionProfit(
  sessionId: string,
): Promise<ProfitBreakdownData> {
  const response = await fetch(`${API_BASE}/api/v1/sessions/${sessionId}/profit`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new ProfitFetchError(
      response.status,
      `Failed to fetch profit breakdown (${response.status})`,
    );
  }

  return mapProfitBreakdown((await response.json()) as SessionProfitBreakdownApi);
}

/**
 * Ensures leg rows exist and sum to formulas.fuel.litersTotal (demo/API-consistent).
 */
export function resolveLegRows(data: ProfitBreakdownData): LegFuelRow[] {
  if (data.fromApi && data.legs.length > 0) {
    return data.legs;
  }

  const totalLiters = data.formulas.fuel.litersTotal;
  if (totalLiters == null || totalLiters <= 0) {
    return data.legs;
  }

  const legCount = Math.max(
    1,
    data.legs.length || Math.min(Math.max(data.stopCount, 1), 6),
  );

  const existingSum = data.legs.reduce(
    (sum, leg) => sum + leg.fuelConsumption,
    0,
  );
  if (
    data.legs.length === legCount &&
    Math.abs(existingSum - totalLiters) < 0.6
  ) {
    return data.legs;
  }

  const weights = Array.from({ length: legCount }, (_, index) => legCount - index);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

  const rows = weights.map((weight, index) => ({
    legId: index + 1,
    fuelConsumption:
      Math.round(((totalLiters * weight) / weightSum) * 10) / 10,
  }));

  const diff =
    Math.round((totalLiters - rows.reduce((s, r) => s + r.fuelConsumption, 0)) * 10) /
    10;
  if (rows.length > 0 && diff !== 0) {
    rows[rows.length - 1] = {
      ...rows[rows.length - 1],
      fuelConsumption:
        Math.round((rows[rows.length - 1].fuelConsumption + diff) * 10) / 10,
    };
  }

  return rows;
}
