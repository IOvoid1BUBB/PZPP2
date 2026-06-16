import type { DashboardSessionSummary } from "@/lib/api/dashboardClient";
import type { FleetVehicle } from "@/lib/api/fleetClient";

const STATUS_PRIORITY = ["dispatched", "confirmed", "optimizing", "draft"] as const;

/** Prefer a session that reflects live fleet activity over an empty draft. */
export function pickFocusSessionId(
  sessions: DashboardSessionSummary[],
  fleet: FleetVehicle[],
): string | null {
  const inRoute = fleet.find((v) => v.status === "in_route" && v.currentSessionId);
  if (inRoute?.currentSessionId && sessions.some((s) => s.id === inRoute.currentSessionId)) {
    return inRoute.currentSessionId;
  }

  for (const status of STATUS_PRIORITY) {
    const match = sessions.find((s) => s.status === status && s.offer_count > 0);
    if (match) return match.id;
  }

  for (const status of STATUS_PRIORITY) {
    const match = sessions.find((s) => s.status === status);
    if (match) return match.id;
  }

  return sessions[0]?.id ?? null;
}

export function sessionStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Szkic sesji";
    case "optimizing":
      return "Optymalizacja trasy";
    case "confirmed":
      return "Potwierdzona trasa";
    case "dispatched":
      return "Trasa w drodze";
    default:
      return "Sesja";
  }
}

export function centerFromMarkers(
  markers: Array<{ coordinates: [number, number] }>,
  fallback: [number, number] = [18, 52.2],
): [number, number] {
  if (markers.length === 0) return fallback;
  const lons = markers.map((m) => m.coordinates[0]);
  const lats = markers.map((m) => m.coordinates[1]);
  return [
    (Math.min(...lons) + Math.max(...lons)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}
