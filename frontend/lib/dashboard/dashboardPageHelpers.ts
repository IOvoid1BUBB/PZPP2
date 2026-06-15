import type { ActiveSessionSummary, DashboardResponse } from "@/lib/api/dashboardClient";
import {
  DEFAULT_ORIGIN,
  parseDashboardCoordinates,
  type ResolvedSessionLocation,
} from "@/lib/dashboard/buildDashboardMarkers";

const MAP_STATUSES = new Set(["optimizing", "confirmed", "dispatched"]);

export interface KpiTile {
  value: string;
  label: string;
}

export function buildKpiTiles(data: DashboardResponse): KpiTile[] {
  return [
    {
      value: `${Math.round(data.today_net_profit_pln).toLocaleString("pl-PL")} PLN`,
      label: "Dzienny zysk netto",
    },
    { value: `${data.avg_lfill_pct.toFixed(0)}%`, label: "Średni LFILL" },
    { value: `${data.empty_runs_pct.toFixed(0)}%`, label: "Puste przebiegi" },
  ];
}

export function plannerSessionHref(sessionId: string): string {
  return `/planner?session=${sessionId}`;
}

/** Sessions on the map: operational rows (optimizing / confirmed / dispatched). */
export function buildOperationalMapSessions(
  activeSessions: ActiveSessionSummary[],
): ResolvedSessionLocation[] {
  return activeSessions
    .filter((session) => MAP_STATUSES.has(session.status))
    .map((session) => ({
      id: session.session_id,
      coordinates:
        parseDashboardCoordinates(session.current_location) ?? DEFAULT_ORIGIN,
      vehicleName: session.vehicle_name,
      status: session.status,
      hasIssue:
        session.status === "optimizing" || session.has_time_window_risk,
      currentLocation: session.current_location,
      destination: session.destination,
      lfilPct: session.lfil_pct,
    }));
}

/** @deprecated Use buildOperationalMapSessions — kept for tests migration. */
export function buildDispatchedMapSessions(
  activeSessions: ActiveSessionSummary[],
  _dispatchedSessions: { id: string }[] = [],
): ResolvedSessionLocation[] {
  return buildOperationalMapSessions(activeSessions).filter(
    (session) => session.status === "dispatched",
  );
}

export function findActiveSession(
  activeSessions: ActiveSessionSummary[],
  sessionId: string | null,
): ActiveSessionSummary | null {
  if (!sessionId) return null;
  return activeSessions.find((session) => session.session_id === sessionId) ?? null;
}
