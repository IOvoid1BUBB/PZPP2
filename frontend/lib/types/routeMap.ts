export type StopType = "pickup" | "delivery";

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface RouteMapLeg {
  legId: number;
  weightKgAtLeg: number;
  /** Leaflet Polyline positions: [lat, lon][] */
  geometryCoords: [number, number][];
  distanceKm: number;
  durationMinutes: number;
  /** cargo weight on leg / vehicle max weight (0..1), from backend fuel model */
  loadRatio: number;
}

export interface RouteStop {
  id: string;
  offerId: string;
  stopType: StopType;
  sequenceOrder: number;
  location: GeoPoint;
  etaMinutesFromStart: number | null;
  stopCostEur: number | null;
  addressLabel: string;
  handlingTimeMinutes: number | null;
  isCurrent: boolean;
  /** P1 / D1 — computed on the client for pins and timeline */
  pinLabel: string;
}

export interface RouteMapData {
  sessionId: string;
  origin: GeoPoint;
  legs: RouteMapLeg[];
  stops: RouteStop[];
  vehicleMaxWeightKg: number;
  totalDistanceKm: number;
  totalDurationMinutes: number;
  fromApi: boolean;
}
