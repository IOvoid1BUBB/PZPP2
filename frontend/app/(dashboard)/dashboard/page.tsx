"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Clock, DollarSign } from "lucide-react";

import { Card, ProgressBar } from "@/components/loadmax/ui";
import { EuropeMap } from "@/components/loadmax/EuropeMap";
import { SquareMarker } from "@/components/loadmax/MapMarkers";
import { EmptyState } from "@/components/ui/EmptyState";
import { fetchDashboard, type DashboardResponse } from "@/lib/api/dashboardClient";
import {
  fetchRankedOffers,
  fetchSessionDetail,
  type SessionDetailResponse,
} from "@/lib/api/sessionClient";
import { fetchDriverCompliance } from "@/lib/api/complianceClient";
import { fetchFleetVehicles, fetchFleetVehicle, type FleetVehicle } from "@/lib/api/fleetClient";
import {
  buildFleetMarkers,
  type DashboardMarker,
} from "@/lib/dashboard/buildDashboardMarkers";
import { buildAlerts, type Alert } from "@/lib/dashboard/buildAlerts";
import {
  centerFromMarkers,
  pickFocusSessionId,
  sessionStatusLabel,
} from "@/lib/dashboard/pickFocusSession";
import { interpolatePosition, type SimStop } from "@/lib/simulation/interpolatePosition";
import type { RankedOfferRow } from "@/lib/types/offers";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const SIM_UPDATE_MS = 60_000;

interface RouteStopsResponse {
  session_id: string | null;
  simulation_started_at: string | null;
  stops: Array<SimStop & { address_label?: string | null }>;
}

const alertIcon: Record<Alert["type"], typeof CalendarDays> = {
  info: CalendarDays,
  warning: Clock,
  opportunity: DollarSign,
};

function AlertItem({ alert }: { alert: Alert }) {
  const Icon = alertIcon[alert.type];
  return (
    <div className="border-b border-ui-border/60 px-5 py-4 last:border-0">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-ui-secondary" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-pretty text-sm font-semibold text-ui-primary">
            {alert.title}
          </h3>
          <p className="mt-1 text-pretty text-sm leading-relaxed text-ui-secondary">
            {alert.body}
          </p>
          {alert.link &&
            (alert.href ? (
              <Link
                href={alert.href}
                className="mt-2 inline-block text-sm font-medium text-ui-accent hover:underline"
              >
                {alert.link}
              </Link>
            ) : (
              <span className="mt-2 inline-block text-sm font-medium text-ui-accent">
                {alert.link}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

interface KpiTile {
  value: string;
  label: string;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [fleetVehicles, setFleetVehicles] = useState<FleetVehicle[]>([]);
  const [markers, setMarkers] = useState<DashboardMarker[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedFleetVehicleId, setSelectedFleetVehicleId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SessionDetailResponse | null>(null);
  const [selectedFleetVehicle, setSelectedFleetVehicle] = useState<FleetVehicle | null>(null);
  const [rankedOffers, setRankedOffers] = useState<RankedOfferRow[]>([]);
  const [complianceViolations, setComplianceViolations] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Map: fleetVehicleId → cached route stops data for simulation
  const routeStopsCache = useRef<Map<string, RouteStopsResponse>>(new Map());
  // Mutable markers ref for the simulation interval
  const markersRef = useRef<DashboardMarker[]>([]);

  function applySimulatedPositions(baseMarkers: DashboardMarker[]): DashboardMarker[] {
    return baseMarkers.map((m) => {
      if (!m.fleetVehicleId) return m;
      const routeData = routeStopsCache.current.get(m.fleetVehicleId);
      if (!routeData) return m;
      const pos = interpolatePosition(routeData.stops, routeData.simulation_started_at);
      if (!pos) return m;
      const stop = routeData.stops[pos.currentStopIndex];
      const stopLabel = stop?.address_label
        ? ` · ${stop.address_label}`
        : "";
      return {
        ...m,
        coordinates: [pos.lon, pos.lat],
        simulatedLat: pos.lat,
        simulatedLon: pos.lon,
        label: `${m.label}${stopLabel}`,
      };
    });
  }

  // 1. Pobierz dashboard + fleet vehicles — markery z pozycji floty.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [response, fleetVehicles] = await Promise.all([
          fetchDashboard(),
          fetchFleetVehicles().catch(() => [] as FleetVehicle[]),
        ]);
        if (cancelled) return;
        setData(response);
        setFleetVehicles(fleetVehicles);

        // Build base markers from fleet vehicles
        const baseMarkers = buildFleetMarkers(fleetVehicles);

        // Fetch route stops for in_route vehicles
        await Promise.all(
          fleetVehicles
            .filter((v) => v.status === "in_route")
            .map(async (v) => {
              try {
                const res = await fetch(`${API_BASE}/api/v1/fleet/${v.id}/route-stops`);
                if (res.ok) {
                  const data = (await res.json()) as RouteStopsResponse;
                  routeStopsCache.current.set(v.id, data);
                }
              } catch {
                // optional
              }
            }),
        );

        if (cancelled) return;
        const withSim = applySimulatedPositions(baseMarkers);
        markersRef.current = baseMarkers; // store static markers for interval
        setMarkers(withSim);

        const recent = response.recent_sessions.slice(0, 6);
        if (recent.length > 0) {
          const focusId = pickFocusSessionId(recent, fleetVehicles);
          if (focusId) {
            setSelectedSessionId((current) => current ?? focusId);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Nie udało się wczytać dashboardu.",
          );
        }
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
  }, []);

  // Update all in_route vehicle positions every 60 s (no re-fetch)
  useEffect(() => {
    const interval = setInterval(() => {
      setMarkers(applySimulatedPositions(markersRef.current));
    }, SIM_UPDATE_MS);
    return () => clearInterval(interval);
  }, []);

  // 2. Szczegóły wybranej sesji + ranked offers + compliance (dla alertów).
  useEffect(() => {
    if (!selectedSessionId) {
      setSelectedDetail(null);
      setRankedOffers([]);
      setComplianceViolations(0);
      return;
    }

    let cancelled = false;

    void fetchSessionDetail(selectedSessionId)
      .then((detail) => {
        if (!cancelled) setSelectedDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setSelectedDetail(null);
      });

    void fetchRankedOffers(selectedSessionId, 10)
      .then((response) => {
        if (!cancelled) setRankedOffers(response.offers);
      })
      .catch(() => {
        if (!cancelled) setRankedOffers([]);
      });

    void fetchDriverCompliance(selectedSessionId)
      .then((result) => {
        if (!cancelled) setComplianceViolations(result.violations.length);
      })
      .catch(() => {
        if (!cancelled) setComplianceViolations(0);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  // 3. Load fleet vehicle detail on marker click (for vehicles without active sessions).
  useEffect(() => {
    if (!selectedFleetVehicleId) {
      setSelectedFleetVehicle(null);
      return;
    }
    let cancelled = false;
    void fetchFleetVehicle(selectedFleetVehicleId)
      .then((v) => { if (!cancelled) setSelectedFleetVehicle(v); })
      .catch(() => { if (!cancelled) setSelectedFleetVehicle(null); });
    return () => { cancelled = true; };
  }, [selectedFleetVehicleId]);

  const kpis: KpiTile[] = useMemo(() => {
    if (!data) return [];
    const profit =
      data.kpis.total_estimated_profit_eur > 0
        ? Math.round(data.kpis.total_estimated_profit_eur).toLocaleString("pl-PL")
        : "0";
    return [
      {
        value: `${profit} EUR`,
        label: "Dzisiejszy zysk netto",
      },
      {
        value: `${Math.min(100, data.kpis.average_fill_pct).toFixed(0)}%`,
        label: "Średni LFILL (załadowane)",
      },
      {
        value: String(data.kpis.vehicles_in_route),
        label: "Pojazdy w trasie",
      },
      { value: String(data.kpis.market_offers_count), label: "Oferty na rynku" },
    ];
  }, [data]);

  const mapCenter = useMemo(
    () => centerFromMarkers(markers),
    [markers],
  );

  const alerts: Alert[] = useMemo(() => {
    if (!data) return [];
    return buildAlerts({
      sessions: data.recent_sessions,
      kpis: data.kpis,
      rankedOffers,
      activeSessionId: selectedSessionId,
      complianceViolations,
    });
  }, [data, rankedOffers, selectedSessionId, complianceViolations]);

  if (loading) {
    return (
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="h-24 animate-pulse bg-ui-raised" />
            ))}
          </div>
          <Card className="h-[520px] animate-pulse bg-ui-raised" />
        </div>
        <Card className="h-[400px] animate-pulse bg-ui-raised" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-sm text-ui-error" role="alert">
        {error ?? "Brak danych dashboardu."}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
      {/* Lewa: KPI + karta pojazdu + mapa */}
      <div className="flex min-w-0 flex-col gap-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
            {kpis.map((kpi) => (
              <Card key={kpi.label} className="p-5">
                <p className="text-2xl font-bold text-ui-accent">{kpi.value}</p>
                <p className="mt-2 text-pretty text-sm text-ui-muted">{kpi.label}</p>
              </Card>
            ))}
          </div>

          <Card className="flex min-h-[180px] flex-col justify-center p-6">
            {selectedDetail ? (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-xs text-ui-muted">
                    {sessionStatusLabel(selectedDetail.status)}
                  </p>
                  <p className="text-lg font-semibold text-ui-primary">
                    {selectedDetail.vehicle.name}
                  </p>
                  <p className="text-sm text-ui-secondary">
                    Kierowca: {selectedDetail.driver_profile.name}
                  </p>
                  {selectedDetail.metrics.estimated_net_profit_eur != null ? (
                    <p className="text-sm text-ui-muted">
                      Szac. zysk:{" "}
                      {Math.round(selectedDetail.metrics.estimated_net_profit_eur).toLocaleString(
                        "pl-PL",
                      )}{" "}
                      EUR
                    </p>
                  ) : null}
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ui-muted">LFILL</span>
                    <span className="font-semibold text-ui-accent">
                      {selectedDetail.metrics.fill_pct.toFixed(0)}%
                    </span>
                  </div>
                  <ProgressBar value={selectedDetail.metrics.fill_pct} className="mt-1.5" />
                </div>
                <Link
                  href="/planner"
                  className="text-sm font-medium text-ui-accent hover:underline"
                >
                  Otwórz planner →
                </Link>
              </div>
            ) : selectedFleetVehicle ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-ui-muted">Pojazd floty</p>
                <p className="text-lg font-semibold text-ui-primary">
                  {selectedFleetVehicle.registration}
                </p>
                <p className="text-sm text-ui-secondary">{selectedFleetVehicle.typeName}</p>
                <p className="text-sm text-ui-muted capitalize">
                  Status: {selectedFleetVehicle.status}
                </p>
                <p className="text-xs text-ui-muted">
                  {selectedFleetVehicle.maxLdm} LDM · {(selectedFleetVehicle.maxWeightKg / 1000).toFixed(1)} t
                </p>
              </div>
            ) : (
              <p className="text-center text-base text-ui-muted">
                Wybierz pojazd z mapy
              </p>
            )}
          </Card>
        </div>

        <Card className="h-[520px] overflow-hidden p-0">
          <EuropeMap center={mapCenter} scale={750}>
            {markers.map((marker) => (
              <SquareMarker
                key={marker.id}
                coordinates={marker.coordinates}
                label={marker.label}
                color={marker.color}
                onClick={() => {
                  if (marker.fleetVehicleId) {
                    setSelectedFleetVehicleId(marker.fleetVehicleId);
                    const fleetVehicle = fleetVehicles.find(
                      (v) => v.id === marker.fleetVehicleId,
                    );
                    const sessionId = fleetVehicle?.currentSessionId ?? null;
                    if (sessionId) {
                      setSelectedSessionId(sessionId);
                    } else {
                      setSelectedSessionId(null);
                    }
                  } else {
                    setSelectedSessionId(marker.sessionId);
                    setSelectedFleetVehicleId(null);
                  }
                }}
              />
            ))}
          </EuropeMap>
        </Card>
      </div>

      {/* Prawa: feed alertów */}
      <Card className="max-h-[720px] overflow-y-auto p-0">
        {alerts.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={CalendarDays}
              title="Brak aktywnych tras dziś"
              description="Zaplanuj pierwszą trasę, aby zobaczyć alerty i podpowiedzi rynkowe."
              action={
                <Link
                  href="/planner"
                  className="inline-flex min-h-11 items-center rounded-full bg-ui-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                >
                  Zaplanuj trasę
                </Link>
              }
            />
          </div>
        ) : (
          alerts.map((alert) => <AlertItem key={alert.id} alert={alert} />)
        )}
      </Card>
    </div>
  );
}
