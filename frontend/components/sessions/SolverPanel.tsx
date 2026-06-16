"use client";

/**
 * @file SolverPanel.tsx — kanoniczny panel solvera VRP (Tasks 5.1–5.3).
 *
 * Odpowiada za uruchomienie optymalizacji, prezentację różnicy (diff) między
 * aktualnym a proponowanym zestawem ofert oraz zastosowanie / odrzucenie wyniku.
 *
 * Architektura:
 *   - Maszyna stanów (idle | running | done | error) — lib/solver/solverMachine.
 *   - Logika diff (added/removed/unchanged) — lib/solver/buildOfferDiff.
 *   - Live timer w izolowanym komponencie (SolverElapsedTimer), aby tykanie co
 *     sekundę nie rerenderowało SlotEditor/TrailerCanvas.
 *   - AbortController do anulowania POST /optimize; AbortError NIE jest błędem.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import {
  cancelSessionOptimize,
  createSession,
  fetchSessionDetail,
  replaceSessionOffers,
  runSessionOptimize,
} from "@/lib/api/sessionClient";
import { buildCreateSessionParams } from "@/lib/fleet/resolveSessionOrigin";
import { buildOfferDiff } from "@/lib/solver/buildOfferDiff";
import {
  INITIAL_SOLVER_STATE,
  solverReducer,
} from "@/lib/solver/solverMachine";
import { useLoadStore } from "@/lib/stores/loadStore";
import { useSessionStore } from "@/lib/stores/sessionStore";
import { useVehicleStore } from "@/lib/stores/vehicleStore";

interface SolverPanelProps {
  sessionId: string | null;
  vehicleId?: string | null;
  /** Optional human-readable labels for offer ids shown in the diff rows. */
  offerLabels?: Record<string, string>;
  onApplied?: () => void;
  onOffersPlaced?: (offerIds: string[]) => void;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function shortOfferLabel(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

/**
 * Isolated 1s ticker. Mounted only while the solver runs so its per-second state
 * updates never rerender the parent panel (and therefore never the trailer
 * canvas). Resets to 0 on every mount.
 */
export function SolverElapsedTimer() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span
      className="font-mono text-sm tabular-nums text-ui-secondary"
      aria-live="polite"
      data-testid="solver-timer"
    >
      {formatElapsed(seconds)}
    </span>
  );
}

type DiffTone = "added" | "removed" | "unchanged";

const DIFF_ROW_TONE: Record<DiffTone, string> = {
  added: "bg-green-50 text-green-800",
  removed: "bg-red-50 text-red-700 line-through",
  unchanged: "text-ui-secondary opacity-50",
};

interface OfferDiffRowProps {
  id: string;
  label: string;
  tone: DiffTone;
  rowTestId: string;
}

export function OfferDiffRow({ id, label, tone, rowTestId }: OfferDiffRowProps) {
  return (
    <li
      data-testid={rowTestId}
      data-offer-id={id}
      className={`truncate rounded px-1.5 py-0.5 font-mono text-xs ${DIFF_ROW_TONE[tone]}`}
    >
      {label}
    </li>
  );
}

interface DiffSectionProps {
  title: string;
  ids: string[];
  testId: string;
  tone: DiffTone;
  labelFor: (id: string) => string;
}

function DiffSection({ title, ids, testId, tone, labelFor }: DiffSectionProps) {
  return (
    <div
      data-testid={testId}
      data-count={ids.length}
      className="min-w-0 flex-1 rounded-md border border-[var(--ui-border)] p-2"
    >
      <p className="mb-1.5 text-xs font-semibold text-ui-primary">
        {title} ({ids.length})
      </p>
      <ul className="space-y-1">
        {ids.length === 0 ? (
          <li className="text-xs text-ui-muted">—</li>
        ) : (
          ids.map((id) => (
            <OfferDiffRow
              key={id}
              id={id}
              label={labelFor(id)}
              tone={tone}
              rowTestId={`${testId}-row`}
            />
          ))
        )}
      </ul>
    </div>
  );
}

export function SolverPanel({
  sessionId,
  vehicleId,
  offerLabels,
  onApplied,
  onOffersPlaced,
}: SolverPanelProps) {
  const { showToast } = useToast();
  const sessionOrigin = useVehicleStore((state) => state.sessionOrigin);
  const fleetVehicleId = useVehicleStore((state) => state.fleetVehicleId);
  const setStoreSessionId = useSessionStore((state) => state.setSessionId);

  const [machine, dispatch] = useReducer(solverReducer, INITIAL_SOLVER_STATE);
  const { status, result } = machine;
  const [applying, setApplying] = useState(false);
  const [useFullMarket, setUseFullMarket] = useState(true);
  const [tempSessionId, setTempSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string>("draft");
  const [sessionOfferCount, setSessionOfferCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const activeSessionId = sessionId ?? tempSessionId;
  const isRunning = status === "running";
  const pendingResult = status === "done" ? result : null;

  // Track session status + offer count so optimisation is disabled once the
  // route leaves draft (UX-08), and so the "<2 offers" guard works.
  useEffect(() => {
    if (!sessionId) {
      setSessionStatus("draft");
      setSessionOfferCount(0);
      return;
    }
    let cancelled = false;
    void fetchSessionDetail(sessionId)
      .then((detail) => {
        if (cancelled) return;
        setSessionStatus(detail.status);
        setSessionOfferCount(detail.offers.length);
      })
      .catch(() => {
        if (!cancelled) setSessionStatus("draft");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, status]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const labelFor = useCallback(
    (id: string) => offerLabels?.[id] ?? shortOfferLabel(id),
    [offerLabels],
  );

  const diff = useMemo(() => {
    if (!pendingResult) return null;
    return buildOfferDiff(
      pendingResult.current_offer_ids,
      pendingResult.selected_offer_ids,
    );
  }, [pendingResult]);

  const statusBadge = useMemo(() => {
    if (!pendingResult) return null;
    const solverStatus = pendingResult.solver_status;
    if (solverStatus === "OPTIMAL")
      return { label: "OPTIMAL", cls: "bg-green-100 text-green-800" };
    if (solverStatus === "FEASIBLE")
      return { label: "FEASIBLE", cls: "bg-yellow-100 text-yellow-800" };
    if (solverStatus === "INFEASIBLE")
      return { label: "INFEASIBLE", cls: "bg-red-100 text-red-800" };
    return { label: solverStatus, cls: "bg-gray-100 text-gray-700" };
  }, [pendingResult]);

  const isReadOnlyStatus =
    sessionStatus === "confirmed" || sessionStatus === "dispatched";
  // Need at least 2 candidate offers — relaxed when pulling from the full market.
  const tooFewOffers = !useFullMarket && Boolean(sessionId) && sessionOfferCount < 2;
  const canOptimize = !isReadOnlyStatus && !tooFewOffers;

  const handleRun = useCallback(async () => {
    let workingSessionId = activeSessionId;

    if (!workingSessionId) {
      if (!vehicleId) {
        showToast({ type: "error", message: "Wybierz pojazd przed uruchomieniem solvera." });
        return;
      }
      try {
        const session = await createSession(
          buildCreateSessionParams(vehicleId, {
            origin: sessionOrigin ?? undefined,
            fleetVehicleId: fleetVehicleId ?? undefined,
          }),
        );
        workingSessionId = session.id;
        setTempSessionId(session.id);
      } catch (err) {
        showToast({
          type: "error",
          message: err instanceof Error ? err.message : "Nie udało się stworzyć sesji dla solvera.",
        });
        return;
      }
    }

    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "run" });

    try {
      const next = await runSessionOptimize(
        workingSessionId,
        10,
        useFullMarket,
        controller.signal,
      );
      dispatch({ type: "resolved", result: next });
      if (next.solver_status === "INFEASIBLE") {
        showToast({
          type: "error",
          message: "Solver nie znalazł trasy spełniającej ograniczenia pojazdu.",
        });
      } else {
        showToast({
          type: "success",
          message: `Propozycja gotowa: ${next.selected_offer_ids.length} ofert.`,
        });
      }
    } catch (err) {
      // Cancellation is not an error — handleCancel already reset to idle.
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      dispatch({
        type: "failed",
        error: err instanceof Error ? err.message : "Optymalizacja nie powiodła się.",
      });
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Optymalizacja nie powiodła się.",
      });
    } finally {
      abortRef.current = null;
    }
  }, [activeSessionId, vehicleId, showToast, useFullMarket, sessionOrigin, fleetVehicleId]);

  const handleCancel = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "reset" });
    if (activeSessionId) {
      // Best-effort server-side cancel (DELETE /optimize); ignore failures.
      await cancelSessionOptimize(activeSessionId).catch(() => undefined);
    }
    showToast({ type: "info", message: "Optymalizacja anulowana." });
  }, [activeSessionId, showToast]);

  const handleApply = useCallback(async () => {
    if (!activeSessionId || !pendingResult) {
      return;
    }
    if (
      pendingResult.solver_status !== "OPTIMAL" &&
      pendingResult.solver_status !== "FEASIBLE"
    ) {
      return;
    }
    if (pendingResult.selected_offer_ids.length === 0) {
      dispatch({ type: "reset" });
      return;
    }

    const selected = pendingResult.selected_offer_ids;
    setApplying(true);
    try {
      if (sessionId) {
        // PUT must succeed BEFORE any store mutation — guarantees no partial UI
        // update when the request fails.
        await replaceSessionOffers(activeSessionId, selected);
        useLoadStore.getState().applyBulkOffers(selected);
        await cancelSessionOptimize(activeSessionId).catch(() => undefined);
        dispatch({ type: "reset" });
        showToast({ type: "success", message: "Propozycja solvera zastosowana." });
        onApplied?.();
      } else {
        // Pre-session: promote the temp session to the active one.
        setStoreSessionId(activeSessionId);
        useLoadStore.getState().setSessionId(activeSessionId);
        dispatch({ type: "reset" });
        showToast({ type: "success", message: "Propozycja solvera zastosowana." });
        onOffersPlaced?.(selected);
        onApplied?.();
      }
    } catch (err) {
      // No store mutation happened (PUT threw) — UI stays on the proposal.
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Nie udało się zastosować propozycji.",
      });
    } finally {
      setApplying(false);
    }
  }, [onApplied, onOffersPlaced, pendingResult, activeSessionId, sessionId, showToast, setStoreSessionId]);

  const handleReject = useCallback(() => {
    // Discard: reset UI only, never touch the offers attached to the session.
    dispatch({ type: "reset" });
    showToast({ type: "success", message: "Propozycja odrzucona — układ bez zmian." });
  }, [showToast]);

  if (!activeSessionId && !vehicleId) {
    return null;
  }

  const canApply =
    pendingResult &&
    (pendingResult.solver_status === "OPTIMAL" ||
      pendingResult.solver_status === "FEASIBLE") &&
    pendingResult.selected_offer_ids.length > 0;

  return (
    <Card className="grid gap-3 p-4" data-testid="solver-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Solver VRP</CardTitle>
          <CardDescription>
            Automatyczny dobór ofert i optymalizacja kolejności przystanków.
          </CardDescription>
        </div>
        <div className="flex flex-col items-end gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ui-secondary">
            <input
              type="checkbox"
              className="size-3.5 rounded"
              checked={useFullMarket}
              onChange={(e) => setUseFullMarket(e.target.checked)}
              disabled={isRunning || applying}
            />
            Użyj pełnej giełdy
          </label>
          {isRunning ? (
            <div className="flex items-center gap-2">
              <SolverElapsedTimer />
              <Button
                variant="secondary"
                data-testid="solver-cancel-btn"
                onClick={() => void handleCancel()}
              >
                Anuluj
              </Button>
            </div>
          ) : !isReadOnlyStatus ? (
            <Button
              variant="primary"
              data-testid="solver-optimize-btn"
              disabled={applying || Boolean(pendingResult) || !canOptimize}
              onClick={() => void handleRun()}
              title={
                tooFewOffers
                  ? "Dodaj co najmniej 2 oferty lub włącz pełną giełdę."
                  : undefined
              }
            >
              Optymalizuj załadunek
            </Button>
          ) : null}
        </div>
      </div>

      {isReadOnlyStatus && !isRunning && !pendingResult ? (
        <p className="text-xs text-ui-muted">
          Trasa jest zatwierdzona — solver jest dostępny tylko dla wersji roboczej.
        </p>
      ) : !canOptimize && !isRunning && !pendingResult ? (
        <p className="text-xs text-ui-muted">
          Dodaj co najmniej 2 oferty do sesji lub włącz „Użyj pełnej giełdy”, aby uruchomić solver.
        </p>
      ) : null}

      {pendingResult && diff && statusBadge ? (
        <div className="grid gap-2 rounded-md border border-[var(--ui-border)] p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-ui-primary">Propozycja solvera</p>
            {!pendingResult.is_optimal ? (
              <span
                data-testid="solver-approx-badge"
                className="rounded-full border border-amber-400 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900"
                title="Wynik może nie być globalnie optymalny"
              >
                PRZYBLIŻONY
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
            <span className="text-ui-muted">
              czas: {(pendingResult.solve_time_ms / 1000).toFixed(1)} s · cel:{" "}
              {pendingResult.objective_value.toFixed(2)} EUR
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <DiffSection
              title="Dodane"
              ids={diff.added}
              testId="diff-added"
              tone="added"
              labelFor={labelFor}
            />
            <DiffSection
              title="Usunięte"
              ids={diff.removed}
              testId="diff-removed"
              tone="removed"
              labelFor={labelFor}
            />
            <DiffSection
              title="Bez zmian"
              ids={diff.unchanged}
              testId="diff-unchanged"
              tone="unchanged"
              labelFor={labelFor}
            />
          </div>

          {pendingResult.solver_status === "INFEASIBLE" && !useFullMarket && (
            <p className="text-xs text-ui-muted">
              💡 Wskazówka: włącz &ldquo;Użyj pełnej giełdy&rdquo; aby rozszerzyć pulę kandydatów.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {canApply ? (
              <Button
                variant="primary"
                data-testid="solver-apply-btn"
                disabled={applying}
                onClick={() => void handleApply()}
              >
                {applying ? "Stosowanie…" : "Zastosuj"}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              data-testid="solver-reject-btn"
              disabled={applying}
              onClick={handleReject}
            >
              Odrzuć
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
