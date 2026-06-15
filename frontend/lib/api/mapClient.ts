/**
 * API client for GET /api/v1/sessions/{id}/route-map.
 * geometry_coords and weight_kg_at_leg come from the backend (OSRM + fuel_calculator).
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

export async function fetchSessionRouteMap(sessionId: string): Promise<RouteMapData> {
  const response = await fetch(`${API_BASE}/api/v1/sessions/${sessionId}/route-map`);
  if (!response.ok) {
    throw new RouteMapFetchError(
      response.status,
      `Nie udało się pobrać mapy trasy (${response.status})`,
    );
  }
  return mapRouteMapResponse((await response.json()) as RouteMapResponseApi);
}

/** Demo route around Warsaw with varied leg weights (≥3 heat-map colors). */
export const DEMO_ROUTE_MAP: RouteMapData = {
  sessionId: "demo",
  origin: { lat: 52.22, lon: 21.01 },
  vehicleMaxWeightKg: 24000,
  totalDistanceKm: 96.4,
  totalDurationMinutes: 142,
  fromApi: false,
  legs: [
    {
      legId: 1,
      weightKgAtLeg: 3800,
      distanceKm: 18.2,
      durationMinutes: 28,
      loadRatio: 0.16,
      geometryCoords: [
        [52.22, 21.01],
        [52.21, 20.95],
        [52.2, 20.9],
        [52.18, 20.85],
      ],
    },
    {
      legId: 2,
      weightKgAtLeg: 9200,
      distanceKm: 14.7,
      durationMinutes: 24,
      loadRatio: 0.38,
      geometryCoords: [
        [52.18, 20.85],
        [52.16, 20.8],
        [52.14, 20.76],
        [52.12, 20.72],
      ],
    },
    {
      legId: 3,
      weightKgAtLeg: 18500,
      distanceKm: 41.1,
      durationMinutes: 58,
      loadRatio: 0.77,
      geometryCoords: [
        [52.12, 20.72],
        [52.06, 20.66],
        [51.99, 20.6],
        [51.95, 20.55],
      ],
    },
    {
      legId: 4,
      weightKgAtLeg: 11200,
      distanceKm: 22.4,
      durationMinutes: 32,
      loadRatio: 0.47,
      geometryCoords: [
        [51.95, 20.55],
        [51.92, 20.5],
        [51.9, 20.45],
        [51.88, 20.4],
      ],
    },
  ],
  stops: attachPinLabels([
    {
      id: "demo-p1",
      offerId: "offer-a",
      stopType: "pickup",
      sequenceOrder: 0,
      location: { lat: 52.18, lon: 20.85 },
      etaMinutesFromStart: 45,
      stopCostEur: 28,
      addressLabel: "Odbiór · 52.1800°, 20.8500°",
      handlingTimeMinutes: 30,
      isCurrent: true,
    },
    {
      id: "demo-d1",
      offerId: "offer-a",
      stopType: "delivery",
      sequenceOrder: 1,
      location: { lat: 52.12, lon: 20.72 },
      etaMinutesFromStart: 120,
      stopCostEur: 32,
      addressLabel: "Dostawa · 52.1200°, 20.7200°",
      handlingTimeMinutes: 25,
      isCurrent: false,
    },
    {
      id: "demo-p2",
      offerId: "offer-b",
      stopType: "pickup",
      sequenceOrder: 2,
      location: { lat: 51.95, lon: 20.55 },
      etaMinutesFromStart: 195,
      stopCostEur: 28,
      addressLabel: "Odbiór · 51.9500°, 20.5500°",
      handlingTimeMinutes: 35,
      isCurrent: false,
    },
    {
      id: "demo-d2",
      offerId: "offer-b",
      stopType: "delivery",
      sequenceOrder: 3,
      location: { lat: 51.88, lon: 20.4 },
      etaMinutesFromStart: 270,
      stopCostEur: 30,
      addressLabel: "Dostawa · 51.8800°, 20.4000°",
      handlingTimeMinutes: 20,
      isCurrent: false,
    },
  ]),
};
