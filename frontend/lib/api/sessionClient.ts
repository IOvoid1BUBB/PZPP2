/**
 * @file sessionClient.ts
 *
 * Klient API dla zasobów sesji i pojazdów.
 * Wzorowany na lib/api/plannerClient.ts.
 *
 * Endpointy:
 *   GET  /api/v1/vehicles   → fetchVehicles()
 *   POST /api/v1/sessions   → createSession()
 */

import { normalizePayloadSlots } from "@/lib/load/capacity";
import { toNumber, toOptionalNumber } from "@/lib/api/coerce";
import type { VehicleConfig } from "@/lib/types/load";
import type {
  BulkSessionOffersPayload,
  SolverResult,
  UUID,
} from "@/lib/types/solver";
  OfferScore,
  RankedOfferRow,
  RankedOffersResponse,
} from "@/lib/types/offers";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

// ─── Defaults ───────────────────────────────────────────────────────────────

/**
 * UUID profilu kierowcy "standard" — seed z:
 * backend/alembic/versions/20250518_0003_driver_profiles.py (PROFILE_STANDARD_ID)
 */
const DEFAULT_DRIVER_PROFILE_ID = "11111111-1111-4111-8111-111111110001";

/**
 * Punkt startowy: Warszawa (zgodny z market_simulator i testami geo).
 */
const DEFAULT_ORIGIN_LON = 21.01;
const DEFAULT_ORIGIN_LAT = 52.22;

/**
 * Bounding box docelowego regionu: Polska / środkowa Europa.
 */
const DEFAULT_BBOX: [number, number, number, number] = [18.0, 49.0, 24.0, 55.0];

// ─── Types ──────────────────────────────────────────────────────────────────

/** Kształt odpowiedzi z GET /api/v1/vehicles (snake_case z backendu) */
interface VehicleApiRecord {
  id: string;
  name: string;
  type: "master_l2" | "master_l3" | "master_l4" | "man_solo";
  max_ldm: number | string;
  max_weight_kg: number;
  trailer_length_cm: number;
  trailer_width_cm: number;
  fuel_per_100km_base: number | string;
  max_stops: number;
  payload_slots: Record<string, unknown>;
}

export interface CreateSessionParams {
  vehicle_id: string;
  driver_profile_id?: string;
  origin_lon?: number;
  origin_lat?: number;
  target_region_bbox?: [number, number, number, number];
}

export interface SessionResponse {
  id: string;
  status: string;
}

export interface SessionFullResponse {
  id: string;
  status: string;
}

export interface DriverProfileRecord {
  id: string;
  code: string;
  name: string;
  hourly_cost_eur: number;
  idle_fuel_l_per_hour: number;
  stop_admin_fee_eur: number;
}

export interface SessionDetailResponse {
  id: string;
  status: "draft" | "optimizing" | "confirmed" | "dispatched";
  created_at: string;
  vehicle: {
    id: string;
    name: string;
    type: string;
  };
  driver_profile: DriverProfileRecord;
  offers: Array<{ id: string; price_eur: number; ldm: number; weight_kg: number }>;
  stops: Array<{ id: string; stop_type: string; sequence_order: number }>;
  metrics: {
    used_ldm: number;
    fill_pct: number;
    used_weight_kg: number;
    weight_pct: number;
    total_distance_km: number;
    estimated_net_profit_eur: number | null;
    stop_count: number;
    client_count: number;
    stop_costs_eur: number;
  };
}

export interface SimulateOffersResult {
  requested: number;
  inserted: number;
  skipped: number;
}

export interface SolverRunResult {
  session_id: string;
  solver_run_id: string;
  selected_offer_ids: string[];
  objective_value: number;
  solver_status: string;
  is_optimal: boolean;
  solve_time_ms: number;
  current_offer_ids: string[];
}

export interface SolverStatusResponse {
  status: string;
  elapsed_ms: number;
  best_objective: number | null;
  result: SolverRunResult | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AddOfferError extends Error {
  readonly code: string;
  readonly freeLdm?: number;
  readonly requiredLdm?: number;

  constructor(
    message: string,
    code: string,
    options?: { freeLdm?: number; requiredLdm?: number },
  ) {
    super(message);
    this.name = "AddOfferError";
    this.code = code;
    this.freeLdm = options?.freeLdm;
    this.requiredLdm = options?.requiredLdm;
  }
}

interface OfferScoreApiRecord {
  offer_id: string;
  total_score: number | string;
  revenue_density_score: number | string;
  detour_penalty_score: number | string;
  fill_contribution_score: number | string;
  time_window_score: number | string;
  added_km: number | string;
  estimated_added_cost_eur: number | string;
  ldm?: number | string;
  weight_kg?: number | string;
  price_eur?: number | string;
  stackable?: boolean;
  pickup_label?: string;
  delivery_label?: string;
}

interface RankedOffersApiResponse {
  session_id: string;
  limit: number;
  scored_count: number;
  offers: OfferScoreApiRecord[];
}

interface AddOfferErrorBody {
  error?: string;
  detail?: string;
  free_ldm?: number;
  required_ldm?: number;
  request_id?: string;
}

// ─── Mapowanie snake_case → camelCase ───────────────────────────────────────

function mapOfferScore(raw: OfferScoreApiRecord): OfferScore {
  return {
    offer_id: raw.offer_id,
    total_score: toNumber(raw.total_score),
    revenue_density_score: toNumber(raw.revenue_density_score),
    detour_penalty_score: toNumber(raw.detour_penalty_score),
    fill_contribution_score: toNumber(raw.fill_contribution_score),
    time_window_score: toNumber(raw.time_window_score),
    added_km: toNumber(raw.added_km),
    estimated_added_cost_eur: toNumber(raw.estimated_added_cost_eur),
  };
}

export function enrichRankedOfferRow(
  score: OfferScore,
  raw?: Partial<OfferScoreApiRecord>,
): RankedOfferRow {
  return {
    ...score,
    ldm: toOptionalNumber(raw?.ldm),
    weight_kg: toOptionalNumber(raw?.weight_kg),
    price_eur: toOptionalNumber(raw?.price_eur),
    stackable: raw?.stackable,
    pickup_label: raw?.pickup_label,
    delivery_label: raw?.delivery_label,
  };
}

function mapVehicle(raw: VehicleApiRecord): VehicleConfig {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    maxLdm: toNumber(raw.max_ldm),
    maxWeightKg: raw.max_weight_kg,
    trailerLengthCm: raw.trailer_length_cm,
    trailerWidthCm: raw.trailer_width_cm,
    fuelPer100kmBase: toNumber(raw.fuel_per_100km_base),
    maxStops: raw.max_stops,
    payloadSlots: normalizePayloadSlots(raw.payload_slots),
  };
}

// ─── API calls ──────────────────────────────────────────────────────────────

/**
 * Pobierz listę dostępnych pojazdów.
 * Wynik jest cache'owany przez komponent — nie wykonuj wielokrotnie bez potrzeby.
 */
export async function fetchVehicles(): Promise<VehicleConfig[]> {
  const response = await fetch(`${API_BASE}/api/v1/vehicles`);
  if (!response.ok) {
    throw new Error(`Nie udało się pobrać listy pojazdów (${response.status})`);
  }
  const raw = (await response.json()) as VehicleApiRecord[];
  return raw.map(mapVehicle);
}

/**
 * Utwórz nową sesję konsolidacji.
 *
 * WAŻNE: Backend (SessionCreate) wymaga pełnego body z driver_profile_id
 * i target_region_bbox — bez nich API zwróci 422.
 */
export async function createSession(
  params: CreateSessionParams,
): Promise<SessionResponse> {
  const body = {
    vehicle_id: params.vehicle_id,
    driver_profile_id: params.driver_profile_id ?? DEFAULT_DRIVER_PROFILE_ID,
    origin_lon: params.origin_lon ?? DEFAULT_ORIGIN_LON,
    origin_lat: params.origin_lat ?? DEFAULT_ORIGIN_LAT,
    target_region_bbox: params.target_region_bbox ?? DEFAULT_BBOX,
  };

  const response = await fetch(`${API_BASE}/api/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Nie udało się utworzyć sesji (${response.status})`);
  }

  return (await response.json()) as SessionResponse;
}

// ─── Solver / offers bulk ─────────────────────────────────────────────────────

interface SolverApiResponse {
  session_id: string;
  solver_run_id: string;
  status: SolverResult["status"];
  objective_value?: number | null;
  solve_time_ms?: number | null;
  selected_offer_ids: string[];
  is_optimal?: boolean;
}

function mapSolverResponse(raw: SolverApiResponse): SolverResult {
  return {
    sessionId: raw.session_id,
    solverRunId: raw.solver_run_id,
    status: raw.status,
    selectedOfferIds: raw.selected_offer_ids,
    isOptimal: raw.is_optimal ?? raw.status === "ok",
    objectiveValue: raw.objective_value ?? null,
    solveTimeMs: raw.solve_time_ms ?? null,
  };
}

function optimizeUrl(sessionId: string): string {
  return `${API_BASE}/api/v1/sessions/${sessionId}/optimize`;
}

/**
 * Uruchom optymalizator VRP dla sesji (POST /optimize).
 */
export async function runSolverOptimize(
  sessionId: string,
  candidateOfferIds: UUID[],
  signal?: AbortSignal,
): Promise<SolverResult> {
  const response = await fetch(optimizeUrl(sessionId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ candidate_offer_ids: candidateOfferIds }),
  });

  if (!response.ok) {
    throw new Error(`Optymalizacja nie powiodła się (${response.status})`);
  }

  const raw = (await response.json()) as SolverApiResponse;
  return mapSolverResponse(raw);
}

/**
 * Anuluj bieżące żądanie optymalizacji (DELETE /optimize).
 */
export async function cancelSolverOptimize(sessionId: string): Promise<void> {
  const response = await fetch(optimizeUrl(sessionId), { method: "DELETE" });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Anulowanie optymalizacji nie powiodło się (${response.status})`);
  }
}

/**
 * Zastąp listę ofert w sesji (PUT /offers, bulk).
 */
export async function bulkUpdateSessionOffers(
  sessionId: string,
  offerIds: UUID[],
): Promise<void> {
  const body: BulkSessionOffersPayload = { offer_ids: offerIds };
  const response = await fetch(`${API_BASE}/api/v1/sessions/${sessionId}/offers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Aktualizacja ofert sesji nie powiodła się (${response.status})`);
  }
/**
 * Pobierz oferty posortowane malejąco wg total_score.
 */
export async function fetchRankedOffers(
  sessionId: string,
  limit = 50,
): Promise<RankedOffersResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/sessions/${sessionId}/ranked-offers?limit=${limit}`,
  );

  if (!response.ok) {
    throw new Error(
      `Nie udało się pobrać ofert (${response.status})`,
    );
  }

  const raw = (await response.json()) as RankedOffersApiResponse;

  return {
    session_id: raw.session_id,
    limit: raw.limit,
    scored_count: raw.scored_count,
    offers: raw.offers.map((record) =>
      enrichRankedOfferRow(mapOfferScore(record), record),
    ),
  };
}

/**
 * Przypisz ofertę do sesji konsolidacji.
 */
export async function addOfferToSession(
  sessionId: string,
  offerId: string,
): Promise<SessionFullResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/sessions/${sessionId}/offers/${offerId}`,
    { method: "POST" },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as AddOfferErrorBody;

    if (response.status === 409 && body.error === "insufficient_ldm") {
      throw new AddOfferError(
        body.detail ?? "Insufficient loading meter capacity.",
        "insufficient_ldm",
        { freeLdm: body.free_ldm, requiredLdm: body.required_ldm },
      );
    }

    throw new AddOfferError(
      body.detail ?? `Błąd dodawania (${response.status})`,
      body.error ?? "unknown",
    );
  }

  return (await response.json()) as SessionFullResponse;
}

export async function fetchDriverProfiles(): Promise<DriverProfileRecord[]> {
  const response = await fetch(`${API_BASE}/api/v1/driver-profiles`);
  if (!response.ok) {
    throw new Error(`Nie udało się pobrać profili kierowców (${response.status})`);
  }
  return (await response.json()) as DriverProfileRecord[];
}

export async function fetchSessionDetail(sessionId: string): Promise<SessionDetailResponse> {
  const response = await fetch(`${API_BASE}/api/v1/sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error(`Nie udało się pobrać sesji (${response.status})`);
  }
  const raw = (await response.json()) as SessionDetailResponse & {
    metrics: Record<string, unknown>;
    offers: Array<Record<string, unknown>>;
  };

  return {
    ...raw,
    offers: raw.offers.map((offer) => ({
      id: String(offer.id),
      price_eur: toNumber(offer.price_eur),
      ldm: toNumber(offer.ldm),
      weight_kg: toNumber(offer.weight_kg),
    })),
    metrics: {
      used_ldm: toNumber(raw.metrics.used_ldm),
      fill_pct: toNumber(raw.metrics.fill_pct),
      used_weight_kg: toNumber(raw.metrics.used_weight_kg),
      weight_pct: toNumber(raw.metrics.weight_pct),
      total_distance_km: toNumber(raw.metrics.total_distance_km),
      estimated_net_profit_eur:
        raw.metrics.estimated_net_profit_eur == null
          ? null
          : toNumber(raw.metrics.estimated_net_profit_eur),
      stop_count: toNumber(raw.metrics.stop_count),
      client_count: toNumber(raw.metrics.client_count),
      stop_costs_eur: toNumber(raw.metrics.stop_costs_eur),
    },
  };
}

export async function simulateMarketOffers(
  sessionId: string,
  count = 200,
): Promise<SimulateOffersResult> {
  const response = await fetch(
    `${API_BASE}/api/v1/sessions/${sessionId}/simulate?count=${count}`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error(`Nie udało się wygenerować ofert (${response.status})`);
  }
  return (await response.json()) as SimulateOffersResult;
}

export async function getSessionOptimizeStatus(
  sessionId: string,
): Promise<SolverStatusResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/sessions/${sessionId}/optimize/status`,
  );
  if (!response.ok) {
    throw new Error(`Nie udało się odczytać statusu optymalizacji (${response.status})`);
  }
  return (await response.json()) as SolverStatusResponse;
}

export async function runSessionOptimize(
  sessionId: string,
  timeLimitSeconds = 10,
): Promise<SolverRunResult> {
  const response = await fetch(`${API_BASE}/api/v1/sessions/${sessionId}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidate_offer_ids: [], time_limit_seconds: timeLimitSeconds }),
  });
  if (!response.ok) {
    throw new Error(`Optymalizacja nie powiodła się (${response.status})`);
  }

  const started = (await response.json()) as SolverStatusResponse;
  if (started.result) {
    return started.result;
  }

  const deadline = Date.now() + (timeLimitSeconds + 30) * 1000;
  while (Date.now() < deadline) {
    await sleep(300);
    const status = await getSessionOptimizeStatus(sessionId);
    if (status.status === "RUNNING") {
      continue;
    }
    if (status.result) {
      return status.result;
    }
    throw new Error(
      status.status === "UNKNOWN"
        ? "Optymalizacja zakończona błędem (routing lub solver)."
        : `Optymalizacja zakończona bez wyniku (status: ${status.status}).`,
    );
  }

  throw new Error("Przekroczono czas oczekiwania na wynik optymalizacji.");
}

export async function cancelSessionOptimize(sessionId: string): Promise<SolverRunResult> {
  const response = await fetch(`${API_BASE}/api/v1/sessions/${sessionId}/optimize`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`Anulowanie optymalizacji nie powiodło się (${response.status})`);
  }
  return (await response.json()) as SolverRunResult;
}

export async function replaceSessionOffers(
  sessionId: string,
  offerIds: string[],
): Promise<SessionDetailResponse> {
  const response = await fetch(`${API_BASE}/api/v1/sessions/${sessionId}/offers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offer_ids: offerIds }),
  });
  if (!response.ok) {
    throw new Error(`Nie udało się zaktualizować ofert (${response.status})`);
  }
  return (await response.json()) as SessionDetailResponse;
}

export async function updateSessionStatus(
  sessionId: string,
  status: SessionDetailResponse["status"],
): Promise<SessionDetailResponse> {
  const response = await fetch(`${API_BASE}/api/v1/sessions/${sessionId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    throw new Error(`Nie udało się zmienić statusu sesji (${response.status})`);
  }
  return (await response.json()) as SessionDetailResponse;
}
