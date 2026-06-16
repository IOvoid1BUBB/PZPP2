/**
 * Resolve session origin from a fleet vehicle's home base, falling back to Warsaw.
 */

import { fetchFleetVehicles } from "@/lib/api/fleetClient";
import { DEFAULT_SESSION_ORIGIN } from "@/lib/api/sessionClient";

export interface SessionOrigin {
  lat: number;
  lon: number;
}

export interface FleetSessionContext {
  origin: SessionOrigin;
  fleetVehicleId?: string;
}

/**
 * Pick the first non-retired fleet vehicle of `vehicleType` with a configured home base.
 */
export async function resolveFleetSessionContext(
  vehicleType: string,
): Promise<FleetSessionContext> {
  try {
    const fleet = await fetchFleetVehicles();
    const match = fleet.find(
      (v) =>
        v.typeKey === vehicleType &&
        v.status !== "retired" &&
        v.homeLat != null &&
        v.homeLon != null,
    );
    if (match?.homeLat != null && match.homeLon != null) {
      return {
        origin: { lat: match.homeLat, lon: match.homeLon },
        fleetVehicleId: match.id,
      };
    }
  } catch {
    /* fleet endpoint optional — fall back to default origin */
  }
  return { origin: { ...DEFAULT_SESSION_ORIGIN } };
}

/**
 * Build createSession params using a fleet vehicle's home base when available.
 */
export function buildCreateSessionParams(
  vehicleId: string,
  options: {
    driverProfileId?: string;
    vehicleType?: string;
    origin?: SessionOrigin;
    fleetVehicleId?: string;
  },
): {
  vehicle_id: string;
  driver_profile_id?: string;
  origin_lat?: number;
  origin_lon?: number;
  fleet_vehicle_id?: string;
} {
  const origin = options.origin ?? DEFAULT_SESSION_ORIGIN;
  return {
    vehicle_id: vehicleId,
    driver_profile_id: options.driverProfileId,
    origin_lat: origin.lat,
    origin_lon: origin.lon,
    ...(options.fleetVehicleId ? { fleet_vehicle_id: options.fleetVehicleId } : {}),
  };
}
