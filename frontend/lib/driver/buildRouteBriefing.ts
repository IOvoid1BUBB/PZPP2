import type { SessionDetailResponse } from "@/lib/api/sessionClient";
import type {
  BriefingStop,
  DriverRouteBriefing,
} from "@/lib/types/driverBriefing";
import type { GeoPoint, RouteMapData } from "@/lib/types/routeMap";

/** Build a Google Maps deep link for a coordinate. */
export function buildMapsLink(location: GeoPoint): string {
  return `https://maps.google.com/?q=${location.lat},${location.lon}`;
}

interface SessionMeta {
  driverName?: string | null;
  vehicleName?: string | null;
}

function resolveMeta(
  sessionDetail: SessionDetailResponse | SessionMeta | null | undefined,
): { driverName: string; vehicleName: string } {
  if (!sessionDetail) {
    return { driverName: "—", vehicleName: "—" };
  }
  if ("driver_profile" in sessionDetail || "vehicle" in sessionDetail) {
    const detail = sessionDetail as SessionDetailResponse;
    return {
      driverName: detail.driver_profile?.name ?? "—",
      vehicleName: detail.vehicle?.name ?? "—",
    };
  }
  const meta = sessionDetail as SessionMeta;
  return {
    driverName: meta.driverName ?? "—",
    vehicleName: meta.vehicleName ?? "—",
  };
}

/**
 * Pure transform: combine route-map data and session detail into a
 * driver-facing briefing. Deterministic given a fixed `now`.
 */
export function buildRouteBriefing(
  routeMap: RouteMapData,
  sessionDetail: SessionDetailResponse | SessionMeta | null | undefined,
  now: Date = new Date(),
): DriverRouteBriefing {
  const { driverName, vehicleName } = resolveMeta(sessionDetail);

  const stops: BriefingStop[] = routeMap.stops.map((stop) => ({
    pinLabel: stop.pinLabel,
    stopType: stop.stopType,
    addressLabel: stop.addressLabel,
    location: { lat: stop.location.lat, lon: stop.location.lon },
    etaMinutesFromStart: stop.etaMinutesFromStart,
    handlingTimeMinutes: stop.handlingTimeMinutes,
    mapsLink: buildMapsLink(stop.location),
  }));

  return {
    sessionId: routeMap.sessionId,
    driverName,
    vehicleName,
    origin: { lat: routeMap.origin.lat, lon: routeMap.origin.lon },
    totals: {
      distanceKm: routeMap.totalDistanceKm,
      durationMinutes: routeMap.totalDurationMinutes,
      stopCount: stops.length,
    },
    stops,
    generatedAt: now.toISOString(),
  };
}
