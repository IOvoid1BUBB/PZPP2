"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { DriverRouteBriefing } from "@/components/driver/DriverRouteBriefing";
import {
  DEMO_ROUTE_MAP,
  fetchSessionRouteMap,
  RouteMapFetchError,
} from "@/lib/api/mapClient";
import { getCompanyColorHex } from "@/lib/colors/companyColors";
import {
  getLegColor,
  getMaxLegWeightKg,
  HEAT_MAP_LEGEND,
} from "@/lib/map/legColors";
import type { RouteMapData, RouteStop } from "@/lib/types/routeMap";

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTime(minutes: number | null): string {
  if (minutes == null) {
    return "—";
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) {
    return `${mins} min`;
  }
  return `${hours} h ${mins} min`;
}

function formatEur(value: number | null): string {
  if (value == null) {
    return "—";
  }
  return `${value.toLocaleString("pl-PL", { maximumFractionDigits: 2 })} EUR`;
}

function createStopIcon(pinLabel: string, borderColor: string): L.DivIcon {
  const kind = pinLabel.startsWith("P") ? "P" : "D";
  return L.divIcon({
    className: "route-map-pin-wrapper",
    html: `<div class="route-map-pin" style="border-color:${borderColor}" aria-label="${kind} ${pinLabel.slice(1)}"><span class="route-map-pin-kind">${kind}</span><span class="route-map-pin-num">${pinLabel.slice(1)}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function boundsFromData(data: RouteMapData): L.LatLngBoundsExpression {
  const points: [number, number][] = [
    [data.origin.lat, data.origin.lon],
    ...data.stops.map((s) => [s.location.lat, s.location.lon] as [number, number]),
  ];
  for (const leg of data.legs) {
    for (const coord of leg.geometryCoords) {
      points.push(coord);
    }
  }
  return points;
}

function MapFlyBridge({
  onMapReady,
  bounds,
}: {
  onMapReady: (map: L.Map) => void;
  bounds: L.LatLngBoundsExpression;
}) {
  const map = useMap();
  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);

  useEffect(() => {
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, bounds]);

  return null;
}

function HeatMapLegend() {
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-t border-[var(--ui-border)] px-4 py-3 text-xs text-[var(--ui-text-secondary)]"
      aria-label="Legenda obciążenia odcinków"
    >
      <span className="font-medium text-[var(--ui-text-primary)]">Obciążenie</span>
      {HEAT_MAP_LEGEND.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-6 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

interface StopTimelineProps {
  stops: RouteStop[];
  onStopClick: (stop: RouteStop) => void;
}

function StopTimeline({ stops, onStopClick }: StopTimelineProps) {
  return (
    <ul className="divide-y divide-[var(--ui-border)]">
      {stops.map((stop) => (
        <li key={stop.id}>
          <button
            type="button"
            onClick={() => onStopClick(stop)}
            className={`w-full px-4 py-3 text-left transition-colors hover:bg-[var(--ui-surface-raised)] ${
              stop.isCurrent ? "bg-[var(--ui-accent-muted)]" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold text-[var(--ui-text-primary)]">
                {stop.pinLabel}
              </span>
              <Badge variant={stop.stopType === "pickup" ? "info" : "success"}>
                {stop.stopType === "pickup" ? "Odbiór" : "Dostawa"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-[var(--ui-text-secondary)]">
              {stop.addressLabel}
            </p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-[var(--ui-text-muted)]">
              <div>
                <dt>ETA</dt>
                <dd className="text-[var(--ui-text-secondary)]">
                  {formatTime(stop.etaMinutesFromStart)}
                </dd>
              </div>
              <div>
                <dt>Obsługa</dt>
                <dd className="text-[var(--ui-text-secondary)]">
                  {stop.handlingTimeMinutes != null
                    ? `${stop.handlingTimeMinutes} min`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Koszt</dt>
                <dd className="text-[var(--ui-text-secondary)]">
                  {formatEur(stop.stopCostEur)}
                </dd>
              </div>
            </dl>
          </button>
        </li>
      ))}
    </ul>
  );
}

export interface RouteMapClientProps {
  sessionId: string;
}

export default function RouteMapClient({ sessionId }: RouteMapClientProps) {
  const [data, setData] = useState<RouteMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemoFallback, setIsDemoFallback] = useState(false);
  const [simulating, setSimulating] = useState(false);

  const mapRef = useRef<L.Map | null>(null);
  const abortRef = useRef(false);

  const handleMapReady = useCallback((map: L.Map) => {
    mapRef.current = map;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const routeMap = await fetchSessionRouteMap(sessionId);
        if (!cancelled) {
          setData(routeMap);
          setIsDemoFallback(false);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof RouteMapFetchError && err.status === 422) {
          setData({ ...DEMO_ROUTE_MAP, sessionId });
          setIsDemoFallback(true);
          setError(null);
          return;
        }
        setData({ ...DEMO_ROUTE_MAP, sessionId });
        setIsDemoFallback(true);
        setError(
          err instanceof Error
            ? err.message
            : "Nie udało się wczytać mapy trasy.",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        abortRef.current = true;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const routeData = data ?? DEMO_ROUTE_MAP;
  const maxWeightKg = useMemo(
    () => getMaxLegWeightKg(routeData.legs),
    [routeData.legs],
  );

  const mapCenter = useMemo((): [number, number] => {
    if (routeData.stops.length > 0) {
      const first = routeData.stops[0];
      return [first.location.lat, first.location.lon];
    }
    return [routeData.origin.lat, routeData.origin.lon];
  }, [routeData]);

  const mapBounds = useMemo(
    () => boundsFromData(routeData),
    [routeData],
  );

  const flyToStop = useCallback((stop: RouteStop) => {
    mapRef.current?.flyTo([stop.location.lat, stop.location.lon], 12, {
      duration: 0.8,
    });
  }, []);

  const runSimulation = useCallback(async () => {
    const map = mapRef.current;
    if (!map || routeData.stops.length === 0) {
      return;
    }

    abortRef.current = false;
    setSimulating(true);

    try {
      for (const stop of routeData.stops) {
        if (abortRef.current) {
          break;
        }
        map.flyTo([stop.location.lat, stop.location.lon], 11, {
          duration: 0.8,
        });
        await sleep(800);
      }
    } finally {
      setSimulating(false);
    }
  }, [routeData.stops]);

  if (loading) {
    return (
      <Card className="grid min-h-[420px] place-items-center p-8">
        <p className="text-sm text-[var(--ui-text-secondary)]">
          Wczytywanie mapy trasy…
        </p>
      </Card>
    );
  }

  return (
    <div className="grid min-h-[calc(100vh-10rem)] gap-4 lg:grid-cols-[2fr_1fr]">
      <Card className="flex min-h-[480px] flex-col overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ui-border)] px-4 py-3">
          <div>
            <CardTitle>Mapa trasy</CardTitle>
            {isDemoFallback ? (
              <CardDescription>
                Dane demonstracyjne — dodaj oferty i zatrzymania do sesji.
              </CardDescription>
            ) : (
              <CardDescription>
                Odcinki wg obciążenia (OSRM + waga z kalkulatora paliwa).
              </CardDescription>
            )}
          </div>
          <Button
            variant="secondary"
            disabled={simulating || routeData.stops.length === 0}
            onClick={() => void runSimulation()}
          >
            {simulating ? "Symulacja…" : "Symuluj"}
          </Button>
        </div>

        {!isDemoFallback ? (
          <div className="border-b border-[var(--ui-border)] px-4 py-3">
            <DriverRouteBriefing sessionId={sessionId} variant="compact" />
          </div>
        ) : null}

        {error ? (
          <p className="px-4 py-2 text-sm text-[var(--ui-error)]">{error}</p>
        ) : null}

        <div className="relative min-h-[420px] flex-1">
          <MapContainer
            center={mapCenter}
            zoom={8}
            className="route-map-leaflet"
            scrollWheelZoom
          >
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
            <MapFlyBridge onMapReady={handleMapReady} bounds={mapBounds} />
            {routeData.legs.map((leg) => (
              <Polyline
                key={leg.legId}
                positions={leg.geometryCoords}
                pathOptions={{
                  color: getLegColor(
                    leg.weightKgAtLeg,
                    maxWeightKg,
                    leg.loadRatio,
                  ),
                  weight: 4,
                  opacity: 0.85,
                }}
              />
            ))}
            {routeData.stops.map((stop) => (
              <Marker
                key={stop.id}
                position={[stop.location.lat, stop.location.lon]}
                icon={createStopIcon(
                  stop.pinLabel,
                  getCompanyColorHex(stop.offerId),
                )}
              />
            ))}
          </MapContainer>
        </div>

        <HeatMapLegend />
      </Card>

      <Card className="flex min-h-[480px] flex-col overflow-hidden p-0">
        <div className="border-b border-[var(--ui-border)] px-4 py-3">
          <CardTitle>Stop Timeline</CardTitle>
          <CardDescription>
            Kliknij wiersz, aby przelecieć do punktu na mapie.
          </CardDescription>
        </div>
        <div className="flex-1 overflow-y-auto">
          {routeData.stops.length === 0 ? (
            <p className="p-4 text-sm text-[var(--ui-text-secondary)]">
              Brak zaplanowanych postojów.
            </p>
          ) : (
            <StopTimeline stops={routeData.stops} onStopClick={flyToStop} />
          )}
        </div>
      </Card>
    </div>
  );
}
