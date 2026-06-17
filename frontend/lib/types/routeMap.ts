export type StopType = "pickup" | "delivery";

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface RouteMapLeg {
  legId: number;
  weightKgAtLeg: number;
  /** Loading-meters used on this leg (LDM), from backend packing model */
  ldmAtLeg: number;
  /** Leaflet Polyline positions: [lat, lon][] */
  geometryCoords: [number, number][];
  distanceKm: number;
  durationMinutes: number;
  /** max(weight / max_weight, ldm / max_ldm) on this leg (0..1), from backend */
  loadRatio: number;
}

export type DriverRestType = "break_45" | "rest_11h";

/** Mandatory driver rest stop (EU 561/2006) projected onto the route geometry. */
export interface DriverRestPoint {
  lat: number;
  lon: number;
  restType: DriverRestType;
  afterDrivingMinutes: number;
  legId: number;
  atRouteMinute: number;
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

/** Driver-hours compliance summary (EU 561/2006) for the planner UI. */
export interface DriverComplianceResponse {
  compliant: boolean;
  violations: string[];
  totalDays: number;
  recommendedOvernightStops: number[];
  /** Total driving hours planned across the whole route. */
  totalDrivingHours: number;
  /** Driving hours within the most recent (rolling) 7-day window. */
  weeklyDrivingHours: number;
  /** Conservative weekly driving budget (EU 561/2006 art. 6(2)). */
  weeklyLimitHours: number;
}

export interface RouteMapData {
  sessionId: string;
  origin: GeoPoint;
  legs: RouteMapLeg[];
  stops: RouteStop[];
  /** Mandatory driver breaks/overnights along the route (may be empty). */
  restPoints: DriverRestPoint[];
  vehicleMaxWeightKg: number;
  totalDistanceKm: number;
  totalDurationMinutes: number;
  fromApi: boolean;
}
