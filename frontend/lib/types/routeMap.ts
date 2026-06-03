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
  fromApi: boolean;
}
