import type { GeoPoint, StopType } from "@/lib/types/routeMap";

/** A single stop as presented to the driver. */
export interface BriefingStop {
  /** P1 / D1 — pickup/delivery pin label. */
  pinLabel: string;
  stopType: StopType;
  addressLabel: string;
  location: GeoPoint;
  /** Minutes from route start, or null when ETA is unknown. */
  etaMinutesFromStart: number | null;
  handlingTimeMinutes: number | null;
  /** Deep link to the location on Google Maps. */
  mapsLink: string;
}

/** Aggregated totals for the whole route. */
export interface BriefingTotals {
  distanceKm: number;
  durationMinutes: number;
  stopCount: number;
}

/**
 * Self-contained route summary handed to a driver. Composed entirely on the
 * client from existing session + route-map API data — no dedicated backend
 * service.
 */
export interface DriverRouteBriefing {
  sessionId: string;
  driverName: string;
  vehicleName: string;
  origin: GeoPoint;
  totals: BriefingTotals;
  stops: BriefingStop[];
  /** ISO-8601 timestamp of when the briefing was generated. */
  generatedAt: string;
}
