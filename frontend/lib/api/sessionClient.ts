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

import type { VehicleConfig } from "@/lib/types/load";

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
  max_ldm: number;
  max_weight_kg: number;
  trailer_length_cm: number;
  trailer_width_cm: number;
  fuel_per_100km_base: number;
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

// ─── Mapowanie snake_case → camelCase ───────────────────────────────────────

function mapVehicle(raw: VehicleApiRecord): VehicleConfig {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    maxLdm: raw.max_ldm,
    maxWeightKg: raw.max_weight_kg,
    trailerLengthCm: raw.trailer_length_cm,
    trailerWidthCm: raw.trailer_width_cm,
    fuelPer100kmBase: raw.fuel_per_100km_base,
    maxStops: raw.max_stops,
    // payload_slots klucze bez zmian per spec
    payloadSlots: raw.payload_slots as VehicleConfig["payloadSlots"],
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
