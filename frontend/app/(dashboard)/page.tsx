"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, DollarSign } from "lucide-react";

import { Card, ProgressBar } from "@/components/loadmax/ui";
import { EuropeMap } from "@/components/loadmax/EuropeMap";
import { SquareMarker } from "@/components/loadmax/MapMarkers";
import {
  fetchDashboard,
  type ActiveSessionSummary,
  type DashboardNotification,
  type DashboardResponse,
} from "@/lib/api/dashboardClient";
import {
  buildDashboardMarkers,
  DEFAULT_ORIGIN,
  parseDashboardCoordinates,
  type DashboardMarker,
  type ResolvedSessionLocation,
} from "@/lib/dashboard/buildDashboardMarkers";

const alertIcon: Record<DashboardNotification["type"], typeof CalendarDays> = {
  info: CalendarDays,
  warning: Clock,
  opportunity: DollarSign,
};

function AlertItem({ alert }: { alert: DashboardNotification }) {
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

function toMapSessions(sessions: ActiveSessionSummary[]): ResolvedSessionLocation[] {
  return sessions.slice(0, 6).map((session) => ({
    id: session.session_id,
    coordinates: parseDashboardCoordinates(session.current_location) ?? DEFAULT_ORIGIN,
    vehicleName: session.vehicle_name,
    status: session.status,
    hasIssue: session.status === "optimizing" || session.has_time_window_risk,
  }));
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [markers, setMarkers] = useState<DashboardMarker[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchDashboard();
        if (cancelled) return;
        setData(response);
        setMarkers(buildDashboardMarkers(toMapSessions(response.active_sessions)));

        if (response.active_sessions.length > 0) {
          setSelectedSessionId(
            (current) => current ?? response.active_sessions[0].session_id,
          );
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

  const selectedSession = useMemo(
    () =>
      data?.active_sessions.find((session) => session.session_id === selectedSessionId) ??
      null,
    [data, selectedSessionId],
  );

  const kpis: KpiTile[] = useMemo(() => {
    if (!data) return [];
    return [
      {
        value: `${Math.round(data.today_net_profit_eur).toLocaleString("pl-PL")} EUR`,
        label: "Dzisiejszy zysk netto",
      },
      { value: `${data.avg_lfill_pct.toFixed(0)}%`, label: "Średni LFILL" },
      { value: String(data.active_sessions.length), label: "Aktywne sesje" },
      { value: `${data.empty_runs_pct.toFixed(0)}%`, label: "Puste trasy" },
    ];
  }, [data]);

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
            {selectedSession ? (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-xs text-ui-muted">Aktywna sesja</p>
                  <p className="text-lg font-semibold text-ui-primary">
                    {selectedSession.vehicle_name}
                  </p>
                  <p className="text-sm text-ui-secondary">
                    {selectedSession.current_location} → {selectedSession.destination}
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ui-muted">LFILL</span>
                    <span className="font-semibold text-ui-accent">
                      {selectedSession.lfil_pct.toFixed(0)}%
                    </span>
                  </div>
                  <ProgressBar value={selectedSession.lfil_pct} className="mt-1.5" />
                </div>
                {selectedSession.has_time_window_risk && (
                  <p className="text-xs text-ui-warning">Ryzyko okna czasowego</p>
                )}
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

      <Card className="max-h-[720px] overflow-y-auto p-0">
        {data.notifications.map((alert) => (
          <AlertItem key={alert.id} alert={alert} />
        ))}
      </Card>
    </div>
  );
}
