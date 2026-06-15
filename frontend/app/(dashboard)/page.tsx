"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, DollarSign } from "lucide-react";

import { Card, ProgressBar } from "@/components/loadmax/ui";
import { EuropeMap } from "@/components/loadmax/EuropeMap";
import { SquareMarker } from "@/components/loadmax/MapMarkers";
import { fetchDashboard, type DashboardResponse } from "@/lib/api/dashboardClient";
import {
  fetchRankedOffers,
  fetchSessionDetail,
  type SessionDetailResponse,
} from "@/lib/api/sessionClient";
import { fetchSessionRouteMap } from "@/lib/api/mapClient";
import { fetchDriverCompliance } from "@/lib/api/complianceClient";
import {
  buildDashboardMarkers,
  DEFAULT_ORIGIN,
  type DashboardMarker,
  type ResolvedSessionLocation,
} from "@/lib/dashboard/buildDashboardMarkers";
import { buildAlerts, type Alert } from "@/lib/dashboard/buildAlerts";
import type { RankedOfferRow } from "@/lib/types/offers";

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
  const [markers, setMarkers] = useState<DashboardMarker[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SessionDetailResponse | null>(
    null,
  );
  const [rankedOffers, setRankedOffers] = useState<RankedOfferRow[]>([]);
  const [complianceViolations, setComplianceViolations] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 1. Pobierz dashboard + rozwiąż markery z route-map origin.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchDashboard();
        if (cancelled) return;
        setData(response);

        const recent = response.recent_sessions.slice(0, 6);
        const resolved: ResolvedSessionLocation[] = await Promise.all(
          recent.map(async (session) => {
            let coordinates = DEFAULT_ORIGIN;
            try {
              const routeMap = await fetchSessionRouteMap(session.id);
              const first = routeMap.stops[0];
              coordinates = first
                ? [first.location.lon, first.location.lat]
                : [routeMap.origin.lon, routeMap.origin.lat];
            } catch {
              /* brak trasy — domyślny origin */
            }
            return {
              id: session.id,
              coordinates,
              vehicleName: session.vehicle_name,
              status: session.status,
              hasIssue: session.status === "optimizing",
            };
          }),
        );
        if (cancelled) return;
        setMarkers(buildDashboardMarkers(resolved));

        if (recent.length > 0) {
          setSelectedSessionId((current) => current ?? recent[0].id);
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

  const kpis: KpiTile[] = useMemo(() => {
    if (!data) return [];
    return [
      {
        value: `${Math.round(data.kpis.total_estimated_profit_eur).toLocaleString("pl-PL")} EUR`,
        label: "Dzisiejszy zysk netto",
      },
      { value: `${data.kpis.average_fill_pct.toFixed(0)}%`, label: "Średni LFILL" },
      { value: String(data.kpis.active_sessions), label: "Aktywne sesje" },
      { value: String(data.kpis.market_offers_count), label: "Oferty na rynku" },
    ];
  }, [data]);

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
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4">
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
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div className="grid grid-cols-2 gap-4">
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
                  <p className="text-xs text-ui-muted">Aktywna sesja</p>
                  <p className="text-lg font-semibold text-ui-primary">
                    {selectedDetail.vehicle.name}
                  </p>
                  <p className="text-sm text-ui-secondary">
                    Kierowca: {selectedDetail.driver_profile.name}
                  </p>
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
            ) : (
              <p className="text-center text-base text-ui-muted">
                Wybierz pojazd z mapy
              </p>
            )}
          </Card>
        </div>

        <Card className="h-[520px] overflow-hidden p-0">
          <EuropeMap center={[18, 52.2]} scale={2600}>
            {markers.map((marker) => (
              <SquareMarker
                key={marker.id}
                coordinates={marker.coordinates}
                label={marker.label}
                color={marker.color}
                onClick={() => setSelectedSessionId(marker.sessionId)}
              />
            ))}
          </EuropeMap>
        </Card>
      </div>

      {/* Prawa: feed alertów */}
      <Card className="max-h-[720px] overflow-y-auto p-0">
        {alerts.map((alert) => (
          <AlertItem key={alert.id} alert={alert} />
        ))}
      </Card>
    </div>
  );
}
