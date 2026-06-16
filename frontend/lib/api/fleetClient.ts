/**
 * @file fleetClient.ts
 * Klient API floty (GET/POST/PUT/DELETE /api/v1/fleet).
 */

import { toNumber } from "@/lib/api/coerce";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export interface FleetVehicle {
  id: string;
  typeId: string;
  typeKey: string;
  typeName: string;
  registration: string;
  displayName: string;
  status: "idle" | "in_route" | "maintenance" | "retired";
  maxLdm: number;
  maxWeightKg: number;
  trailerLengthCm: number;
  trailerWidthCm: number;
  payloadSlots: Record<string, unknown>;
  homeLat: number | null;
  homeLon: number | null;
  currentLat: number | null;
  currentLon: number | null;
  currentSessionId: string | null;
  createdAt: string;
}

export interface CreateFleetVehiclePayload {
  type_id: string;
  registration: string;
  display_name: string;
  home_lat?: number | null;
  home_lon?: number | null;
}

export interface UpdateFleetVehiclePayload {
  registration?: string;
  display_name?: string;
  status?: string;
  home_lat?: number | null;
  home_lon?: number | null;
}

interface FleetVehicleApiRecord {
  id: string;
  type_id: string;
  type_key: string;
  type_name: string;
  registration: string;
  display_name: string;
  status: string;
  max_ldm: number | string;
  max_weight_kg: number;
  trailer_length_cm: number;
  trailer_width_cm: number;
  payload_slots: Record<string, unknown>;
  home_lat: number | string | null;
  home_lon: number | string | null;
  current_lat: number | string | null;
  current_lon: number | string | null;
  current_session_id: string | null;
  created_at: string;
}

function mapFleetVehicle(raw: FleetVehicleApiRecord): FleetVehicle {
  return {
    id: raw.id,
    typeId: raw.type_id,
    typeKey: raw.type_key,
    typeName: raw.type_name,
    registration: raw.registration,
    displayName: raw.display_name,
    status: raw.status as FleetVehicle["status"],
    maxLdm: toNumber(raw.max_ldm),
    maxWeightKg: raw.max_weight_kg,
    trailerLengthCm: raw.trailer_length_cm,
    trailerWidthCm: raw.trailer_width_cm,
    payloadSlots: raw.payload_slots,
    homeLat: raw.home_lat != null ? toNumber(raw.home_lat) : null,
    homeLon: raw.home_lon != null ? toNumber(raw.home_lon) : null,
    currentLat: raw.current_lat != null ? toNumber(raw.current_lat) : null,
    currentLon: raw.current_lon != null ? toNumber(raw.current_lon) : null,
    currentSessionId: raw.current_session_id,
    createdAt: raw.created_at,
  };
}

export async function fetchFleetVehicles(): Promise<FleetVehicle[]> {
  const response = await fetch(`${API_BASE}/api/v1/fleet`);
  if (!response.ok) {
    throw new Error(`Failed to fetch fleet (${response.status})`);
  }
  const raw = (await response.json()) as FleetVehicleApiRecord[];
  return raw.map(mapFleetVehicle);
}

export async function fetchFleetVehicle(id: string): Promise<FleetVehicle> {
  const response = await fetch(`${API_BASE}/api/v1/fleet/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch fleet vehicle (${response.status})`);
  }
  return mapFleetVehicle((await response.json()) as FleetVehicleApiRecord);
}

export async function createFleetVehicle(
  payload: CreateFleetVehiclePayload,
): Promise<FleetVehicle> {
  const response = await fetch(`${API_BASE}/api/v1/fleet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(body.detail ?? `Nie udało się dodać pojazdu (${response.status})`);
  }
  return mapFleetVehicle((await response.json()) as FleetVehicleApiRecord);
}

export async function updateFleetVehicle(
  id: string,
  patch: UpdateFleetVehiclePayload,
): Promise<FleetVehicle> {
  const response = await fetch(`${API_BASE}/api/v1/fleet/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(`Nie udało się zaktualizować pojazdu (${response.status})`);
  }
  return mapFleetVehicle((await response.json()) as FleetVehicleApiRecord);
}

export async function deleteFleetVehicle(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/fleet/${id}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Nie udało się usunąć pojazdu (${response.status})`);
  }
}

export async function endFleetTrip(id: string): Promise<FleetVehicle> {
  const response = await fetch(`${API_BASE}/api/v1/fleet/${id}/end-trip`, {
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error(`Nie udało się zakończyć trasy (${response.status})`);
  }
  return mapFleetVehicle((await response.json()) as FleetVehicleApiRecord);
}
