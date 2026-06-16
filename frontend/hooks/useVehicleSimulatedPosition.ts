"use client";

/**
 * @file useVehicleSimulatedPosition.ts
 * Hook that fetches route stops once and then interpolates the vehicle's
 * position every 60 s using client-side linear interpolation.
 * No backend polling after the initial fetch.
 */

import { useEffect, useRef, useState } from "react";
import { interpolatePosition, type SimulatedPosition } from "@/lib/simulation/interpolatePosition";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const UPDATE_INTERVAL_MS = 60_000;

interface RouteStopsApiResponse {
  session_id: string | null;
  simulation_started_at: string | null;
  stops: Array<{
    sequence: number;
    lat: number;
    lon: number;
    address_label: string | null;
    stop_type: string;
    cumulative_km: number;
  }>;
}

export function useVehicleSimulatedPosition(
  fleetVehicleId: string | null,
  speedKmh = 60,
): SimulatedPosition | null {
  const [position, setPosition] = useState<SimulatedPosition | null>(null);
  const stopsRef = useRef<RouteStopsApiResponse | null>(null);

  useEffect(() => {
    if (!fleetVehicleId) {
      setPosition(null);
      return;
    }

    let cancelled = false;

    async function fetchStops() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/fleet/${fleetVehicleId}/route-stops`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as RouteStopsApiResponse;
        stopsRef.current = data;
        const pos = interpolatePosition(data.stops, data.simulation_started_at, speedKmh);
        if (!cancelled) setPosition(pos);
      } catch {
        // Simulation endpoint optional — don't break the UI
      }
    }

    void fetchStops();

    // Update position every 60 s using the cached stops (no re-fetch)
    const interval = setInterval(() => {
      const data = stopsRef.current;
      if (!data) return;
      const pos = interpolatePosition(data.stops, data.simulation_started_at, speedKmh);
      setPosition(pos);
    }, UPDATE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fleetVehicleId, speedKmh]);

  return position;
}
