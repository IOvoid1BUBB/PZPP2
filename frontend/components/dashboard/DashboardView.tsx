"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, DollarSign } from "lucide-react";

import { Card } from "@/components/loadmax/ui";
import { EuropeMap } from "@/components/loadmax/EuropeMap";
import { SquareMarker } from "@/components/loadmax/MapMarkers";
import {
  fetchDashboard,
  type DashboardNotification,
  type DashboardResponse,
} from "@/lib/api/dashboardClient";
import { listSessions } from "@/lib/api/sessionClient";
import {
  buildDashboardMarkers,
  type DashboardMarker,
} from "@/lib/dashboard/buildDashboardMarkers";
import {
  buildOperationalMapSessions,
  buildKpiTiles,
  plannerSessionHref,
} from "@/lib/dashboard/dashboardPageHelpers";
import { useSessionStore } from "@/lib/stores/sessionStore";

const alertIcon: Record<DashboardNotification["type"], typeof CalendarDays> = {
  free_space: CalendarDays,
  time_window_risk: AlertTriangle,
  hot_offer: DollarSign,
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

function MapSessionPopup({
  marker,
  onClose,
}: {
  marker: DashboardMarker & {
    currentLocation?: string;
    destination?: string;
    lfilPct?: number;
    vehicleName?: string | null;
    status?: string;
  };
  onClose: () => void;
}) {
  return (
    <div
      className="absolute bottom-4 left-4 right-4 z-10 rounded-xl border border-ui-border/70 bg-ui-surface p-4 shadow-lg"
      role="dialog"
      aria-label="Szczegóły trasy"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ui-muted">
            {marker.status === "dispatched" ? "Pojazd w trasie" : "Aktywna trasa"}
          </p>
          <p className="text-base font-semibold text-ui-primary">
            {marker.vehicleName ?? marker.label}
          </p>
          {marker.currentLocation && marker.destination && (
            <p className="mt-1 text-sm text-ui-secondary">
              {marker.currentLocation} → {marker.destination}
            </p>
          )}
          {marker.lfilPct != null && (
            <p className="mt-2 text-xs text-ui-muted">
              LFILL:{" "}
              <span className="font-semibold text-ui-accent">
                {marker.lfilPct.toFixed(0)}%
              </span>
            </p>
          )}
          <Link
            href={plannerSessionHref(marker.sessionId)}
            className="mt-3 inline-block text-sm font-medium text-ui-accent hover:underline"
          >
            Otwórz w plannerze →
          </Link>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-sm text-ui-muted hover:text-ui-primary"
          aria-label="Zamknij"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function DashboardView() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const plannerSessionId = useSessionStore((state) => state.sessionId);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashboard] = await Promise.all([
        fetchDashboard(),
        listSessions({ status: "dispatched", date: "today" }),
      ]);
      setData(dashboard);

      const mapSessions = buildOperationalMapSessions(dashboard.active_sessions);
      const preferredId =
        plannerSessionId && mapSessions.some((s) => s.id === plannerSessionId)
          ? plannerSessionId
          : mapSessions[0]?.id ?? null;
      setSelectedSessionId((current) => {
        if (current && mapSessions.some((s) => s.id === current)) {
          return current;
        }
        return preferredId;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Nie udało się wczytać dashboardu.",
      );
    } finally {
      setLoading(false);
    }
  }, [plannerSessionId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    function onFocus() {
      void loadDashboard();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadDashboard]);

  const mapSessions = useMemo(() => {
    if (!data) return [];
    return buildOperationalMapSessions(data.active_sessions);
  }, [data]);

  const markers = useMemo(() => buildDashboardMarkers(mapSessions), [mapSessions]);

  const markerDetails = useMemo(() => {
    const byId = new Map(mapSessions.map((session) => [session.id, session]));
    return markers.map((marker) => {
      const session = byId.get(marker.sessionId);
      return {
        ...marker,
        vehicleName: session?.vehicleName,
        currentLocation: session?.currentLocation,
        destination: session?.destination,
        lfilPct: session?.lfilPct,
        status: session?.status,
      };
    });
  }, [markers, mapSessions]);

  const selectedMarker = useMemo(
    () => markerDetails.find((marker) => marker.sessionId === selectedSessionId) ?? null,
    [markerDetails, selectedSessionId],
  );

  const kpis = useMemo(() => (data ? buildKpiTiles(data) : []), [data]);

  if (loading) {
    return (
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {kpis.map((kpi) => (
            <Card key={kpi.label} className="p-5">
              <p className="text-2xl font-bold text-ui-accent">{kpi.value}</p>
              <p className="mt-2 text-pretty text-sm text-ui-muted">{kpi.label}</p>
            </Card>
          ))}
        </div>

        <Card className="relative h-[520px] overflow-hidden p-0">
          {mapSessions.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6">
              <p className="text-center text-base text-ui-muted">
                Brak aktywnych tras dziś
              </p>
            </div>
          ) : (
            <>
              <EuropeMap center={[18, 52.2]} scale={2600}>
                {markerDetails.map((marker) => (
                  <SquareMarker
                    key={marker.id}
                    coordinates={marker.coordinates}
                    label={marker.label}
                    color={marker.color}
                    onClick={() => setSelectedSessionId(marker.sessionId)}
                  />
                ))}
              </EuropeMap>
              {selectedMarker && (
                <MapSessionPopup
                  marker={selectedMarker}
                  onClose={() => setSelectedSessionId(null)}
                />
              )}
            </>
          )}
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
