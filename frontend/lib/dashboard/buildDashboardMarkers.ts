/**
 * @file buildDashboardMarkers.ts
 * Czysta funkcja mapująca rozwiązane sesje (z koordynatami origin/pierwszego
 * stopu) na deskryptory markerów dla EuropeMap.
 */

export interface ResolvedSessionLocation {
  id: string;
  /** [lon, lat] — origin sesji lub pierwszy stop. */
  coordinates: [number, number];
  vehicleName: string | null;
  status: string;
  /** Czy sesja ma naruszenie compliance / błąd optymalizacji. */
  hasIssue?: boolean;
  currentLocation?: string;
  destination?: string;
  lfilPct?: number;
}

export interface DashboardMarker {
  id: string;
  sessionId: string;
  coordinates: [number, number];
  label: string;
  color: "blue" | "red";
}

/** Warszawa — domyślny środek, gdy brak koordynatów. */
export const DEFAULT_ORIGIN: [number, number] = [21.01, 52.22];

/** Parse backend location labels into map coordinates [lon, lat]. */
export function parseDashboardCoordinates(location: string): [number, number] | null {
  const labeled = location.match(/([\d.]+)°N,\s*([\d.]+)°E/);
  if (labeled) {
    return [Number.parseFloat(labeled[2]), Number.parseFloat(labeled[1])];
  }

  const plain = location.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  if (plain) {
    return [Number.parseFloat(plain[2]), Number.parseFloat(plain[1])];
  }

  return null;
}

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
