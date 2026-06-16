"use client";

/**
 * Planning lab — layout with debounced route refresh
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { DriverHoursWarning } from "@/components/planner/DriverHoursWarning";
import { SlotEditor } from "@/components/planner/SlotEditor";
import { SolverPanel } from "@/components/sessions/SolverPanel";
import { VehicleSelector } from "@/components/planner/VehicleSelector";
import { useHydratedSessionId } from "@/hooks/useHydratedSessionId";
import { usePlannerLayout } from "@/hooks/usePlannerLayout";
import { useSessionStore } from "@/lib/stores/sessionStore";
import { useVehicleStore } from "@/lib/stores/vehicleStore";
import { useLoadStore } from "@/lib/stores/loadStore";

const RouteMapClient = dynamic(
  () => import("@/components/map/RouteMapClient"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[340px] items-center justify-center rounded-2xl border border-ui-border/70 bg-ui-raised text-sm text-ui-secondary">
        Ładowanie mapy trasy…
      </div>
    ),
  },
);

const ROUTE_DEBOUNCE_MS = 800;

export default function PlannerPage() {
  const sessionId = useHydratedSessionId();
  const { reload } = usePlannerLayout();
  const selectedVehicle = useVehicleStore((state) => state.selectedVehicle);
  const storeVehicle = useLoadStore((state) => state.vehicle);
  const hasVehicle = Boolean(selectedVehicle ?? storeVehicle);
  // vehicleDbId for SolverPanel pre-session temp session creation
  const vehicleDbId = selectedVehicle?.id ?? storeVehicle?.id ?? null;

  const [mapKey, setMapKey] = useState(0);
  // Bumped after a solver apply so PalletLibrary refetches ranked-offers (5.3/5.4).
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [isRefreshingRoute, setIsRefreshingRoute] = useState(false);
  const [confirmedBanner, setConfirmedBanner] = useState(false);
  // mapSessionId: the session to show on the route map (may be temp preview session from SlotEditor)
  const [mapSessionId, setMapSessionId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep mapSessionId synced with the real sessionId
  useEffect(() => {
    if (sessionId) setMapSessionId(sessionId);
  }, [sessionId]);

  /**
   * Called by SlotEditor whenever an offer is added or removed.
   * Debounces 800ms then triggers map re-render.
   */
  const handleOfferChange = useCallback(() => {
    const activeSessionId = useSessionStore.getState().sessionId ?? sessionId;
    if (!activeSessionId) return;
    setIsRefreshingRoute(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setMapKey((k) => k + 1);
      setIsRefreshingRoute(false);
    }, ROUTE_DEBOUNCE_MS);
  }, [sessionId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSolverApplied = useCallback(() => {
    void reload();
    setMapKey((k) => k + 1);
    setLibraryRefresh((v) => v + 1);
    setIsRefreshingRoute(false);
  }, [reload]);

  const handleRouteConfirmed = useCallback(() => {
    setConfirmedBanner(true);
    void reload();
  }, [reload]);

  // Show VehicleSelector only when no vehicle AND no active session.
  // A session from Fleet already implies a vehicle — the layout hook will load it.
  if (!hasVehicle && !sessionId) {
    return (
      <div className="flex flex-col gap-6">
        <DriverHoursWarning />
        <VehicleSelector />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">

      {/* ── Post-confirm success banner ───────────────────────── */}
      {confirmedBanner && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-green-500/30 bg-green-50/50 px-5 py-4">
          <p className="text-sm text-ui-primary">
            ✅ Trasa zatwierdzona — widoczna w{" "}
            <a href="/fleet" className="font-medium text-ui-accent hover:underline">
              Fleet Manager
            </a>
            .
          </p>
          <button
            type="button"
            className="shrink-0 text-xs text-ui-muted hover:text-ui-primary"
            onClick={() => setConfirmedBanner(false)}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Driver hours warnings ─────────────────────────────── */}
      <DriverHoursWarning />

      {/* ── Main editor: library + canvas ────────────────────── */}
      <SlotEditor
        onOfferAdded={handleOfferChange}
        onOfferRemoved={handleOfferChange}
        onRouteConfirmed={handleRouteConfirmed}
        libraryRefreshSignal={libraryRefresh}
      />

      {/* ── Solver VRP — always available once vehicle is selected */}
      <details className="rounded-2xl bg-ui-surface">
        <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold text-ui-primary">
          ⚙ Solver VRP — AI optimization
        </summary>
        <div className="px-4 pb-4 pt-3">
          <SolverPanel
            sessionId={sessionId}
            vehicleId={vehicleDbId}
            onApplied={handleSolverApplied}
          />
        </div>
      </details>

      {/* ── Route map — shown when any session (real or preview) exists */}
      {mapSessionId && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ui-primary">
              Route map
              {isRefreshingRoute && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-ui-muted">
                  <span className="inline-block size-3 animate-spin rounded-full border border-ui-muted border-t-transparent" />
                  Aktualizuję trasę…
                </span>
              )}
            </h2>
            <p className="text-xs text-ui-muted">
              OpenRouteService HGV · aktualizuje się po zmianie ładunków
            </p>
          </div>
          <RouteMapClient
            key={`${mapSessionId}-${mapKey}`}
            sessionId={mapSessionId}
            isPreview
            isRefreshing={isRefreshingRoute}
          />
        </section>
      )}
    </div>
  );
}
