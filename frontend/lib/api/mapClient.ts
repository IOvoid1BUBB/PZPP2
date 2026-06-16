/**
 * API client for GET /api/v1/sessions/{id}/route-map.
 * geometry_coords and weight_kg_at_leg come from the backend (ORS + fuel_calculator).
 */

import type { RouteMapData, RouteStop, StopType } from "@/lib/types/routeMap";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

interface GeoPointApi {
  lat: number;
  lon: number;
}

interface RouteMapLegApi {
  leg_id: number;
  weight_kg_at_leg: number;
  geometry_coords: number[][];
  distance_km?: number;
  duration_minutes?: number;
  load_ratio?: number;
}

interface RouteMapStopApi {
  id: string;
  offer_id: string;
  stop_type: StopType;
  sequence_order: number;
  location: GeoPointApi;
  eta_minutes_from_start: number | null;
  stop_cost_eur: number | null;
  address_label: string;
  handling_time_minutes: number | null;
  is_current: boolean;
}

interface RouteMapResponseApi {
  session_id: string;
  origin: GeoPointApi;
  legs: RouteMapLegApi[];
  stops: RouteMapStopApi[];
  vehicle_max_weight_kg: number;
  total_distance_km?: number;
  total_duration_minutes?: number;
}

export class RouteMapFetchError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RouteMapFetchError";
    this.status = status;
  }
}

function attachPinLabels(stops: Omit<RouteStop, "pinLabel">[]): RouteStop[] {
  let pickupCount = 0;
  let deliveryCount = 0;

  return stops.map((stop) => {
    const pinLabel =
      stop.stopType === "pickup"
        ? `P${++pickupCount}`
        : `D${++deliveryCount}`;
    return { ...stop, pinLabel };
  });
}

export function mapRouteMapResponse(raw: RouteMapResponseApi): RouteMapData {
  const stops = attachPinLabels(
    raw.stops.map((stop) => ({
      id: stop.id,
      offerId: stop.offer_id,
      stopType: stop.stop_type,
      sequenceOrder: stop.sequence_order,
      location: { lat: stop.location.lat, lon: stop.location.lon },
      etaMinutesFromStart: stop.eta_minutes_from_start,
      stopCostEur: stop.stop_cost_eur,
      addressLabel: stop.address_label,
      handlingTimeMinutes: stop.handling_time_minutes,
      isCurrent: stop.is_current,
    })),
  );

  return {
    sessionId: raw.session_id,
    origin: { lat: raw.origin.lat, lon: raw.origin.lon },
    legs: raw.legs.map((leg) => ({
      legId: leg.leg_id,
      weightKgAtLeg: leg.weight_kg_at_leg,
      geometryCoords: leg.geometry_coords.map(
        (pair) => [pair[0], pair[1]] as [number, number],
      ),
      distanceKm: leg.distance_km ?? 0,
      durationMinutes: leg.duration_minutes ?? 0,
      loadRatio: leg.load_ratio ?? 0,
    })),
    stops,
    vehicleMaxWeightKg: raw.vehicle_max_weight_kg,
    totalDistanceKm: raw.total_distance_km ?? 0,
    totalDurationMinutes: raw.total_duration_minutes ?? 0,
    fromApi: true,
  };
}

export async function fetchSessionRouteMap(sessionId: string): Promise<RouteMapData | null> {
  const response = await fetch(`${API_BASE}/api/v1/sessions/${sessionId}/route-map`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new RouteMapFetchError(
      response.status,
      `Failed to fetch route map (${response.status})`,
    );
  }
  const mapped = mapRouteMapResponse((await response.json()) as RouteMapResponseApi);
  if (mapped.stops.length === 0) {
    return null;
  }
  return mapped;
}
