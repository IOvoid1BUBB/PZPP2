"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import {
  cancelSessionOptimize,
  createSession,
  replaceSessionOffers,
  runSessionOptimize,
  type SolverRunResult,
} from "@/lib/api/sessionClient";
import { useLoadStore } from "@/lib/stores/loadStore";
import { useSessionStore } from "@/lib/stores/sessionStore";

interface SolverPanelProps {
  sessionId: string | null;
  vehicleId?: string | null;
  onApplied?: () => void;
  onOffersPlaced?: (offerIds: string[]) => void;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  return `${(ms / 1000).toFixed(1)} s`;
}

export function SolverPanel({ sessionId, vehicleId, onApplied, onOffersPlaced }: SolverPanelProps) {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pendingResult, setPendingResult] = useState<SolverRunResult | null>(null);
  const [useFullMarket, setUseFullMarket] = useState(true);
  const [tempSessionId, setTempSessionId] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const setStoreSessionId = useSessionStore((state) => state.setSessionId);

  const activeSessionId = sessionId ?? tempSessionId;

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  const diff = useMemo(() => {
    if (!pendingResult) {
      return null;
    }
    const before = new Set(pendingResult.current_offer_ids);
    const after = new Set(pendingResult.selected_offer_ids);
    const added = pendingResult.selected_offer_ids.filter((id) => !before.has(id));
    const removed = pendingResult.current_offer_ids.filter((id) => !after.has(id));
    return { added, removed };
  }, [pendingResult]);

  const statusBadge = useMemo(() => {
    if (!pendingResult) return null;
    const status = pendingResult.solver_status;
    if (status === "OPTIMAL") return { label: "OPTIMAL", cls: "bg-green-100 text-green-800" };
    if (status === "FEASIBLE") return { label: "FEASIBLE", cls: "bg-yellow-100 text-yellow-800" };
    if (status === "INFEASIBLE") return { label: "INFEASIBLE", cls: "bg-red-100 text-red-800" };
    return { label: status, cls: "bg-gray-100 text-gray-700" };
  }, [pendingResult]);

  const handleRun = useCallback(async () => {
    let workingSessionId = activeSessionId;

    // Pre-session mode: create a temp session to run the solver
    if (!workingSessionId) {
      if (!vehicleId) {
        showToast({ type: "error", message: "Wybierz pojazd przed uruchomieniem solvera." });
        return;
      }
      try {
        const session = await createSession({ vehicle_id: vehicleId });
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

    setRunning(true);
    setElapsedMs(0);
    setPendingResult(null);
    const startedAt = Date.now();
    timerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);

    try {
      const next = await runSessionOptimize(workingSessionId, 10, useFullMarket);
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
      showToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Optymalizacja nie powiodła się.",
      });
    } finally {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRunning(false);
    }
  }, [activeSessionId, vehicleId, showToast, useFullMarket]);

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
        // Existing session — use normal replace flow
        await replaceSessionOffers(activeSessionId, pendingResult.selected_offer_ids);
        await cancelSessionOptimize(activeSessionId);
        setPendingResult(null);
        showToast({ type: "success", message: "Propozycja solvera zastosowana." });
        onApplied?.();
      } else {
        // Pre-session mode — apply solver results to canvas via offerIds
        // Persist temp session id so user can proceed to "Utwórz trasę"
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
        message:
          err instanceof Error ? err.message : "Nie udało się zastosować propozycji.",
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
    <Card className="grid gap-3 p-4">
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
          <Button
            variant="primary"
            disabled={running || applying || Boolean(pendingResult)}
            onClick={() => void handleRun()}
          >
            {running ? (
              <span className="flex items-center gap-2">
                <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {`Optymalizacja… ${formatElapsed(elapsedMs)}`}
              </span>
            ) : (
              "Optymalizuj trasę"
            )}
          </Button>
        </div>
      </div>

      {pendingResult && diff && statusBadge ? (
        <div className="grid gap-2 rounded-md border border-[var(--ui-border)] p-3 text-sm">
          <p className="font-semibold text-ui-primary">Propozycja solvera</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
            <span className="text-ui-muted">
              czas: {formatElapsed(pendingResult.solve_time_ms)} · cel:{" "}
              {pendingResult.objective_value.toFixed(2)} EUR
            </span>
          </div>
          <p>
            Wybrane oferty: {pendingResult.selected_offer_ids.length} · dodane:{" "}
            {diff.added.length} · usunięte: {diff.removed.length}
          </p>
          {pendingResult.stop_sequence && pendingResult.stop_sequence.length > 0 ? (
            <p className="text-xs text-ui-muted">
              Przystanki w propozycji: {pendingResult.stop_sequence.length}
            </p>
          ) : pendingResult.selected_offer_ids.length > 0 ? (
            <p className="text-xs text-ui-muted">
              Szacowane przystanki: {pendingResult.selected_offer_ids.length * 2} (O/Z)
            </p>
          ) : null}
          {pendingResult.solver_status === "INFEASIBLE" && !useFullMarket && (
            <p className="text-xs text-ui-muted">
              💡 Wskazówka: włącz &ldquo;Użyj pełnej giełdy&rdquo; aby rozszerzyć pulę kandydatów.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {canApply ? (
              <Button variant="primary" disabled={applying} onClick={() => void handleApply()}>
                {applying ? "Stosowanie…" : "Zastosuj propozycję"}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={handleReject}>
              Odrzuć
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
