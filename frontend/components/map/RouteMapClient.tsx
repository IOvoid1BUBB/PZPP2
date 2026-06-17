"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";

import { Map as MapIcon } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { DriverRouteBriefing } from "@/components/driver/DriverRouteBriefing";
import { RouteTimeline } from "@/components/planner/RouteTimeline";
import {
  fetchSessionRouteMap,
} from "@/lib/api/mapClient";
import { getCompanyColorHex } from "@/lib/colors/companyColors";
import {
  getLegColor,
  HEAT_MAP_LEGEND,
} from "@/lib/map/legColors";
import type {
  DriverRestType,
  RouteMapData,
  RouteStop,
} from "@/lib/types/routeMap";

const REST_PIN_COLOR = "#7B2D8B";

// CartoDB Positron — jasny minimalistyczny motyw pasujący do UI (#e6e7ef tło)
const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

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

function createOriginIcon(): L.DivIcon {
  return L.divIcon({
    className: "route-map-pin-wrapper",
    html: `<div class="route-map-pin route-map-pin--origin" style="border-color:#1a38f5;background:#1a38f5" aria-label="Baza"><span class="route-map-pin-kind" style="color:#fff">⌂</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
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

function createRestIcon(restType: DriverRestType): L.DivIcon {
  const glyph = restType === "break_45" ? "☕" : "🌙";
  const label = restType === "break_45" ? "Przerwa 45 min" : "Nocleg 11h";
  return L.divIcon({
    className: "route-map-pin-wrapper",
    html: `<div class="route-map-pin route-map-pin--rest" style="border-color:${REST_PIN_COLOR};background:${REST_PIN_COLOR}" aria-label="${label}"><span class="route-map-pin-kind" style="color:#fff">${glyph}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function formatRestHours(afterDrivingMinutes: number): string {
  const hours = Math.round((afterDrivingMinutes / 60) * 10) / 10;
  return hours.toLocaleString("pl-PL", { maximumFractionDigits: 1 });
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
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ backgroundColor: REST_PIN_COLOR }}
        />
        Przerwa kierowcy
      </span>
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
  isPreview?: boolean;
  isRefreshing?: boolean;
}

export default function RouteMapClient({
  sessionId,
  isPreview,
  isRefreshing,
}: RouteMapClientProps) {
  const [data, setData] = useState<RouteMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
          if (routeMap === null) {
            setError(null);
          }
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
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

  const routeData = data;
  // Fallback denominator only — backend now always provides a ready loadRatio.
  const maxWeightKg = useMemo(
    () => routeData?.vehicleMaxWeightKg ?? 0,
    [routeData],
  );

  const mapCenter = useMemo((): [number, number] => {
    if (routeData && routeData.stops.length > 0) {
      const first = routeData.stops[0];
      return [first.location.lat, first.location.lon];
    }
    if (routeData) {
      return [routeData.origin.lat, routeData.origin.lon];
    }
    return [52.22, 21.01]; // Warszawa — fallback przed załadowaniem danych
  }, [routeData]);

  const mapBounds = useMemo(
    () => (routeData ? boundsFromData(routeData) : ([[52.22, 21.01]] as L.LatLngBoundsExpression)),
    [routeData],
  );

  const flyToStop = useCallback((stop: RouteStop) => {
    mapRef.current?.flyTo([stop.location.lat, stop.location.lon], 12, {
      duration: 0.8,
    });
  }, []);

  const runSimulation = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !routeData || routeData.stops.length === 0) {
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
  }, [routeData]);

  if (loading) {
    return (
      <Card className="grid min-h-[40vh] place-items-center p-8 md:min-h-[420px]">
        <p className="text-sm text-[var(--ui-text-secondary)]">
          Wczytywanie mapy trasy…
        </p>
      </Card>
    );
  }

  if (error || !routeData) {
    // Distinguish "no offers yet" (normal empty state) from real errors
    const isEmpty = !error && (!routeData || routeData.stops.length === 0);
    return (
      <Card className="grid min-h-[40vh] place-items-center p-8 md:min-h-[420px]">
        {isEmpty ? (
          <EmptyState
            icon={MapIcon}
            title="Dodaj oferty, aby zobaczyć trasę"
            description="Mapa pojawi się po przypisaniu co najmniej jednej oferty."
          />
        ) : (
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--ui-error,#dc2626)]">
              {error ?? "Brak danych trasy"}
            </p>
            <p className="mt-2 text-xs text-[var(--ui-text-secondary)]">
              Dodaj oferty do sesji i uruchom optymalizację, aby zobaczyć mapę trasy.
            </p>
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="grid min-h-[calc(100vh-10rem)] gap-4 lg:grid-cols-[2fr_1fr]">
      <Card className="flex min-h-[480px] flex-col overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ui-border)] px-4 py-3">
          <div>
            <CardTitle>Mapa trasy</CardTitle>
            <CardDescription>
              Odcinki wg obciążenia (ORS HGV + waga z kalkulatora paliwa).
            </CardDescription>
          </div>
          <Button
            variant="secondary"
            disabled={simulating || routeData.stops.length === 0}
            onClick={() => void runSimulation()}
          >
            {simulating ? "Symulacja…" : "Symuluj"}
          </Button>
        </div>

        <div className="border-b border-[var(--ui-border)] px-4 py-3">
          <DriverRouteBriefing sessionId={sessionId} variant="compact" />
        </div>

        {error ? (
          <p className="px-4 py-2 text-sm text-[var(--ui-error)]">{error}</p>
        ) : null}

        <div className="relative min-h-[40vh] flex-1 md:min-h-[420px]">
          {/* Preview badge — shown while route is being debounce-refreshed */}
          {isPreview && (
            <div
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                zIndex: 1000,
                background: "rgba(245,158,11,0.9)",
                color: "#fff",
                fontSize: 11,
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: 6,
                border: "1.5px dashed rgba(245,158,11,0.6)",
                pointerEvents: "none",
              }}
            >
              Podgląd trasy
            </div>
          )}
          {isRefreshing && (
            <div
              className="absolute inset-0 z-[999] flex items-center justify-center bg-white/40 backdrop-blur-[1px]"
              aria-live="polite"
              aria-busy="true"
            >
              <span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-ui-secondary shadow-sm">
                <span className="inline-block size-3 animate-spin rounded-full border border-ui-muted border-t-transparent" />
                Aktualizuję trasę…
              </span>
            </div>
          )}
          <MapContainer
            center={mapCenter}
            zoom={5}
            className="route-map-leaflet"
            scrollWheelZoom
          >
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
            <MapFlyBridge onMapReady={handleMapReady} bounds={mapBounds} />
            <Marker
              position={[routeData.origin.lat, routeData.origin.lon]}
              icon={createOriginIcon()}
              data-testid="route-origin-marker"
            />
            {routeData.legs.map((leg) => (
              <Polyline
                key={leg.legId}
                positions={leg.geometryCoords}
                pathOptions={{
                  color: getLegColor(
                    leg.weightKgAtLeg,
                    maxWeightKg,
                    leg.loadRatio ?? undefined,
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
            {(routeData.restPoints ?? []).map((rest, index) => (
              <Marker
                key={`rest-${rest.legId}-${rest.atRouteMinute}-${index}`}
                position={[rest.lat, rest.lon]}
                icon={createRestIcon(rest.restType)}
              >
                <Popup>
                  {rest.restType === "break_45"
                    ? `Przerwa obowiązkowa 45 min (po ${formatRestHours(rest.afterDrivingMinutes)} h jazdy)`
                    : `Nocleg 11h (po ${formatRestHours(rest.afterDrivingMinutes)} h jazdy)`}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        <HeatMapLegend />
      </Card>

      <div className="flex min-h-[480px] flex-col gap-4">
        <Card className="flex flex-1 flex-col overflow-hidden p-0">
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

        <Card className="flex flex-col overflow-hidden p-0">
          <div className="border-b border-[var(--ui-border)] px-4 py-3">
            <CardTitle>Oś czasu trasy</CardTitle>
            <CardDescription>
              Baza, postoje oraz obowiązkowe przerwy w kolejności
              chronologicznej.
            </CardDescription>
          </div>
          <div className="overflow-y-auto">
            <RouteTimeline
              stops={routeData.stops}
              restPoints={routeData.restPoints ?? []}
              totalDurationMinutes={routeData.totalDurationMinutes}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
