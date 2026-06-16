"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import {
  cancelSessionOptimize,
  createSession,
  fetchSessionDetail,
  replaceSessionOffers,
  runSessionOptimize,
  type SolverRunResult,
} from "@/lib/api/sessionClient";
import { buildCreateSessionParams } from "@/lib/fleet/resolveSessionOrigin";
import { useLoadStore } from "@/lib/stores/loadStore";
import { useSessionStore } from "@/lib/stores/sessionStore";
import { useVehicleStore } from "@/lib/stores/vehicleStore";

interface SolverPanelProps {
  sessionId: string | null;
  vehicleId?: string | null;
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

interface DiffColumnProps {
  title: string;
  ids: string[];
  testId: string;
  tone: "added" | "removed" | "unchanged";
}

const DIFF_TONE: Record<DiffColumnProps["tone"], string> = {
  added: "text-green-700",
  removed: "text-red-700 line-through",
  unchanged: "text-ui-secondary opacity-60",
};

function DiffColumn({ title, ids, testId, tone }: DiffColumnProps) {
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
            <li
              key={id}
              data-testid={`${testId}-row`}
              data-offer-id={id}
              className={`truncate font-mono text-xs ${DIFF_TONE[tone]}`}
            >
              {shortOfferLabel(id)}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export function SolverPanel({
  sessionId,
  vehicleId,
  onApplied,
  onOffersPlaced,
}: SolverPanelProps) {
  const { showToast } = useToast();
  const sessionOrigin = useVehicleStore((state) => state.sessionOrigin);
  const fleetVehicleId = useVehicleStore((state) => state.fleetVehicleId);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pendingResult, setPendingResult] = useState<SolverRunResult | null>(null);
  const [useFullMarket, setUseFullMarket] = useState(true);
  const [tempSessionId, setTempSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string>("draft");
  const [sessionOfferCount, setSessionOfferCount] = useState(0);
  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const setStoreSessionId = useSessionStore((state) => state.setSessionId);

  const activeSessionId = sessionId ?? tempSessionId;

  // Track session status + offer count so we can disable optimisation once the
  // route is confirmed/dispatched (UX-08: disabled when status !== 'draft').
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
  }, [sessionId, pendingResult]);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopTimer();
      abortRef.current?.abort();
    };
  }, [stopTimer]);

  const diff = useMemo(() => {
    if (!pendingResult) {
      return null;
    }
    const before = new Set(pendingResult.current_offer_ids);
    const after = new Set(pendingResult.selected_offer_ids);
    const added = pendingResult.selected_offer_ids.filter((id) => !before.has(id));
    const removed = pendingResult.current_offer_ids.filter((id) => !after.has(id));
    const unchanged = pendingResult.selected_offer_ids.filter((id) => before.has(id));
    return { added, removed, unchanged };
  }, [pendingResult]);

  const statusBadge = useMemo(() => {
    if (!pendingResult) return null;
    const status = pendingResult.solver_status;
    if (status === "OPTIMAL") return { label: "OPTIMAL", cls: "bg-green-100 text-green-800" };
    if (status === "FEASIBLE") return { label: "FEASIBLE", cls: "bg-yellow-100 text-yellow-800" };
    if (status === "INFEASIBLE") return { label: "INFEASIBLE", cls: "bg-red-100 text-red-800" };
    return { label: status, cls: "bg-gray-100 text-gray-700" };
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

    setRunning(true);
    setElapsedSeconds(0);
    setPendingResult(null);
    stopTimer();
    timerRef.current = window.setInterval(() => {
      setElapsedSeconds((value) => value + 1);
    }, 1000);

    try {
      const next = await runSessionOptimize(
        workingSessionId,
        10,
        useFullMarket,
        controller.signal,
      );
      setPendingResult(next);
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
      // Cancellation is not an error — stay in idle.
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Optymalizacja nie powiodła się.",
      });
    } finally {
      stopTimer();
      abortRef.current = null;
      setRunning(false);
    }
  }, [activeSessionId, vehicleId, showToast, useFullMarket, stopTimer, sessionOrigin, fleetVehicleId]);

  const handleCancel = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    stopTimer();
    setRunning(false);
    setElapsedSeconds(0);
    if (activeSessionId) {
      // Best-effort server-side cancel (DELETE /optimize); ignore failures.
      await cancelSessionOptimize(activeSessionId).catch(() => undefined);
    }
    showToast({ type: "info", message: "Optymalizacja anulowana." });
  }, [activeSessionId, stopTimer, showToast]);

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
      setPendingResult(null);
      return;
    }

    setApplying(true);
    try {
      if (sessionId) {
        await replaceSessionOffers(activeSessionId, pendingResult.selected_offer_ids);
        await cancelSessionOptimize(activeSessionId);
        setPendingResult(null);
        showToast({ type: "success", message: "Propozycja solvera zastosowana." });
        onApplied?.();
      } else {
        setStoreSessionId(activeSessionId);
        useLoadStore.getState().setSessionId(activeSessionId);
        setPendingResult(null);
        showToast({ type: "success", message: "Propozycja solvera zastosowana." });
        onOffersPlaced?.(pendingResult.selected_offer_ids);
        onApplied?.();
      }
    } catch (err) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Nie udało się zastosować propozycji.",
      });
    } finally {
      setApplying(false);
    }
  }, [onApplied, onOffersPlaced, pendingResult, activeSessionId, sessionId, showToast, setStoreSessionId]);

  const handleReject = useCallback(() => {
    setPendingResult(null);
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
            Automatic selection of offers and optimization of stop sequences.
          </CardDescription>
        </div>
        <div className="flex flex-col items-end gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ui-secondary">
            <input
              type="checkbox"
              className="size-3.5 rounded"
              checked={useFullMarket}
              onChange={(e) => setUseFullMarket(e.target.checked)}
              disabled={running || applying}
            />
            Użyj pełnej giełdy
          </label>
          {running ? (
            <div className="flex items-center gap-2">
              <span
                className="font-mono text-sm tabular-nums text-ui-secondary"
                aria-live="polite"
                data-testid="solver-timer"
              >
                {formatElapsed(elapsedSeconds)}
              </span>
              <Button
                variant="secondary"
                data-testid="solver-cancel-btn"
                onClick={() => void handleCancel()}
              >
                Anuluj
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              data-testid="solver-optimize-btn"
              disabled={applying || Boolean(pendingResult) || !canOptimize}
              onClick={() => void handleRun()}
              title={
                isReadOnlyStatus
                  ? "Trasa jest zatwierdzona — optymalizacja zablokowana."
                  : tooFewOffers
                    ? "Dodaj co najmniej 2 oferty lub włącz pełną giełdę."
                    : undefined
              }
            >
              Optymalizuj załadunek
            </Button>
          )}
        </div>
      </div>

      {!canOptimize && !running && !pendingResult ? (
        <p className="text-xs text-ui-muted">
          {isReadOnlyStatus
            ? "Trasa jest zatwierdzona — solver jest dostępny tylko dla wersji roboczej."
            : "Dodaj co najmniej 2 oferty do sesji lub włącz „Użyj pełnej giełdy”, aby uruchomić solver."}
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
            <DiffColumn
              title="Dodane"
              ids={diff.added}
              testId="diff-added"
              tone="added"
            />
            <DiffColumn
              title="Usunięte"
              ids={diff.removed}
              testId="diff-removed"
              tone="removed"
            />
            <DiffColumn
              title="Bez zmian"
              ids={diff.unchanged}
              testId="diff-unchanged"
              tone="unchanged"
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
                {applying ? "Stosowanie…" : "Zastosuj sugestię"}
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
