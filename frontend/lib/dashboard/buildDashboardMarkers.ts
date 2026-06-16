/**
 * @file buildDashboardMarkers.ts
 * Pure functions mapping fleet vehicles and sessions to DashboardMarker descriptors
 * for EuropeMap (react-simple-maps).
 */

import type { FleetVehicle } from "@/lib/api/fleetClient";

export interface ResolvedSessionLocation {
  id: string;
  /** [lon, lat] — origin sesji lub pierwszy stop. */
  coordinates: [number, number];
  vehicleName: string | null;
  status: string;
  /** Czy sesja ma naruszenie compliance / błąd optymalizacji. */
  hasIssue?: boolean;
}

export interface DashboardMarker {
  id: string;
  /** Session id (if from session) or fleet vehicle id */
  sessionId: string;
  fleetVehicleId?: string;
  coordinates: [number, number];
  /** Optional simulated position override (lat/lon degrees). */
  simulatedLat?: number;
  simulatedLon?: number;
  label: string;
  color: "blue" | "red" | "grey" | "amber";
}

/** Warszawa — domyślny środek, gdy brak koordynatów. */
export const DEFAULT_ORIGIN: [number, number] = [21.01, 52.22];

function deriveLabel(vehicleName: string | null, index: number): string {
  if (vehicleName) {
    const initials = vehicleName
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
    if (initials) {
      return initials;
    }
  }
  return `#${index + 1}`;
}

export function buildDashboardMarkers(
  sessions: ResolvedSessionLocation[],
): DashboardMarker[] {
  return sessions.map((session, index) => ({
    id: `marker-${session.id}`,
    sessionId: session.id,
    coordinates: session.coordinates,
    label: deriveLabel(session.vehicleName, index),
    color: session.hasIssue ? "red" : "blue",
  }));
}

/**
 * Build dashboard markers from fleet vehicles.
 * Uses current_lat/current_lon if available, falls back to home, then Warsaw.
 */
export function buildFleetMarkers(vehicles: FleetVehicle[]): DashboardMarker[] {
  return vehicles.map((v) => {
    const lat = v.currentLat ?? v.homeLat ?? 52.22;
    const lon = v.currentLon ?? v.homeLon ?? 21.01;

    const colorMap: Record<FleetVehicle["status"], DashboardMarker["color"]> = {
      idle: "grey",
      in_route: "blue",
      maintenance: "red",
      retired: "grey",
    };

    return {
      id: `fleet-${v.id}`,
      sessionId: v.currentSessionId ?? v.id,
      fleetVehicleId: v.id,
      coordinates: [lon, lat],
      label: v.registration.slice(-4).toUpperCase(),
      color: colorMap[v.status] ?? "grey",
    };
  });
}
