"use client";

/**
 * Planning lab — v0 layout
 *
 * lg: grid [280px | 1fr]
 *   left:  VehicleSelector (compact) + offer sidebar (PalletLibrary / ranked-offers)
 *   right: metrics strip + trailer canvas (DnD) + profit waterfall + inline route map
 *
 * SlotEditor внутри уже рендерит PalletLibrary (left) + trailer (right) в
 * собственном DnDContext. Мы просто помещаем VehicleSelector и SolverPanel
 * над ним и открываем drawer для "Send to driver".
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import { DriverHoursWarning } from "@/components/planner/DriverHoursWarning";
import { SlotEditor } from "@/components/planner/SlotEditor";
import { SolverPanel } from "@/components/planner/SolverPanel";
import { DriverRouteBriefing } from "@/components/driver/DriverRouteBriefing";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { useToast } from "@/components/ui/Toast";
import { useHydratedSessionId } from "@/hooks/useHydratedSessionId";
import { usePlannerLayout } from "@/hooks/usePlannerLayout";
import { updateSessionStatus } from "@/lib/api/sessionClient";
import { usePlannerActionStore } from "@/lib/stores/plannerActionStore";

// Leaflet loaded only client-side
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

export default function PlannerPage() {
  const sessionId = useHydratedSessionId();
  const { reload } = usePlannerLayout();
  const { showToast } = useToast();
  const register = usePlannerActionStore((s) => s.register);
  const setBusy = usePlannerActionStore((s) => s.setBusy);
  const resetAction = usePlannerActionStore((s) => s.reset);

  const [briefingOpen, setBriefingOpen] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [mapKey, setMapKey] = useState(0);

  // Wire AppShell header "Send to driver" button
  useEffect(() => {
    register(() => setBriefingOpen(true), Boolean(sessionId));
    return () => resetAction();
  }, [register, resetAction, sessionId]);

  const handleDispatch = useCallback(async () => {
    if (!sessionId) return;
    setDispatching(true);
    setBusy(true);
    try {
      await updateSessionStatus(sessionId, "dispatched");
      showToast({ type: "success", message: "Trasa wysłana do kierowcy." });
      setBriefingOpen(false);
      void reload();
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Nie udało się wysłać.",
      });
    } finally {
      setDispatching(false);
      setBusy(false);
    }
  }, [reload, sessionId, setBusy, showToast]);

  const handleSolverApplied = useCallback(() => {
    void reload();
    setMapKey((k) => k + 1);
  }, [reload]);

  return (
    <div className="flex flex-col gap-6">

      {/* ── Alerty czasu pracy ────────────────────────────────────── */}
      <DriverHoursWarning />


      {/* ── Krok 2: Solver VRP (tylko gdy sesja istnieje) ─────────── */}
      {sessionId && (
        <details className="rounded-2xl  bg-ui-surface">
          <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold text-ui-primary">
            ⚙ Solver VRP — AI optimization
          </summary>
          <div className=" px-4 pb-4 pt-3">
            <SolverPanel sessionId={sessionId} onApplied={handleSolverApplied} />
          </div>
        </details>
      )}

      {/*
       * ── Krok 3: Główny edytor ──────────────────────────────────
       *
       * SlotEditor renderuje wewnętrznie:
       *   lg: grid [minmax(220px,280px) | 1fr]
       *     left:  PalletLibrary (ranked-offers z API)
       *     right: VehicleHeader + TrailerCanvas (DnD) + ProfitWaterfall
       *
       * Gdy brak pojazdu → komunikat "Brak przypisanego pojazdu"
       * Gdy brak ofert w DB → PalletLibrary pokazuje "Generuj oferty rynkowe"
       */}
      <SlotEditor />

      {/* ── Krok 4: Mapa trasy (Leaflet + ORS, inline) ───────────── */}
      {sessionId && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ui-primary">
              Route map
            </h2>
            <p className="text-xs text-ui-muted">
              Real roads from OpenRouteService (HGV profile).
              Updates after adding offers and running the solver.
            </p>
          </div>
          <RouteMapClient
            key={`${sessionId}-${mapKey}`}
            sessionId={sessionId}
          />
        </section>
      )}

      {/* ── Drawer: Send to driver ────────────────────────────────── */}
      <Drawer
        open={briefingOpen}
        title="Wyślij trasę do kierowcy"
        onClose={() => setBriefingOpen(false)}
      >
        {sessionId ? (
          <div className="flex flex-col gap-4">
            <DriverRouteBriefing sessionId={sessionId} variant="full" />
            <Button
              variant="primary"
              disabled={dispatching}
              onClick={() => void handleDispatch()}
            >
              {dispatching ? "Wysyłanie…" : "Potwierdź i wyślij (dispatched)"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-ui-secondary">Brak aktywnej sesji.</p>
        )}
      </Drawer>
    </div>
  );
}
