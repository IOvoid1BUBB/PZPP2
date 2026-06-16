/**
 * @file interpolatePosition.ts
 * Pure function for computing a simulated driver position along a route.
 * All math is client-side — no backend streaming required.
 */

export interface SimStop {
  lat: number;
  lon: number;
  cumulative_km: number;
  address_label?: string | null;
}

export interface SimulatedPosition {
  lat: number;
  lon: number;
  progressPct: number;
  currentStopIndex: number;
  totalStops: number;
}

/**
 * Interpolate the vehicle position along a sequence of route stops.
 *
 * @param stops        Ordered stops with cumulative_km field.
 * @param simulationStartedAt  ISO datetime string when simulation began.
 * @param speedKmh     Simulated speed in km/h (default 60).
 * @returns Interpolated position, or null if no stops or simulation not started.
 */
export function interpolatePosition(
  stops: SimStop[],
  simulationStartedAt: string | null,
  speedKmh = 60,
): SimulatedPosition | null {
  if (!stops.length || !simulationStartedAt) return null;

  const startMs = new Date(simulationStartedAt).getTime();
  const elapsedMs = Date.now() - startMs;
  if (elapsedMs < 0) return null;

  const elapsedHours = elapsedMs / 3_600_000;
  const coveredKm = elapsedHours * speedKmh;

  const totalKm = stops[stops.length - 1]?.cumulative_km ?? 0;

  if (totalKm <= 0) {
    // No route distance — sit at the first stop
    const first = stops[0]!;
    return { lat: first.lat, lon: first.lon, progressPct: 0, currentStopIndex: 0, totalStops: stops.length };
  }

  if (coveredKm >= totalKm) {
    // Trip complete — at the last stop
    const last = stops[stops.length - 1]!;
    return {
      lat: last.lat,
      lon: last.lon,
      progressPct: 100,
      currentStopIndex: stops.length - 1,
      totalStops: stops.length,
    };
  }

  // Find the segment we are on
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1]!;
    const curr = stops[i]!;
    if (coveredKm <= curr.cumulative_km) {
      const segLen = curr.cumulative_km - prev.cumulative_km;
      const t = segLen > 0 ? (coveredKm - prev.cumulative_km) / segLen : 0;
      return {
        lat: prev.lat + t * (curr.lat - prev.lat),
        lon: prev.lon + t * (curr.lon - prev.lon),
        progressPct: Math.round((coveredKm / totalKm) * 100),
        currentStopIndex: i - 1,
        totalStops: stops.length,
      };
    }
  }

  // Fallback — last stop
  const last = stops[stops.length - 1]!;
  return {
    lat: last.lat,
    lon: last.lon,
    progressPct: 100,
    currentStopIndex: stops.length - 1,
    totalStops: stops.length,
  };
}
