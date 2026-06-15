"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardDescription, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import {
  cancelSessionOptimize,
  replaceSessionOffers,
  runSessionOptimize,
  type SolverRunResult,
} from "@/lib/api/sessionClient";

interface SolverPanelProps {
  sessionId: string | null;
  onApplied?: () => void;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  return `${(ms / 1000).toFixed(1)} s`;
}

export function SolverPanel({ sessionId, onApplied }: SolverPanelProps) {
  const { showToast } = useToast();
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<SolverRunResult | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  const diff = useMemo(() => {
    if (!result) {
      return null;
    }
    const before = new Set(result.current_offer_ids);
    const after = new Set(result.selected_offer_ids);
    const added = result.selected_offer_ids.filter((id) => !before.has(id));
    const removed = result.current_offer_ids.filter((id) => !after.has(id));
    return { added, removed };
  }, [result]);

  const handleRun = useCallback(async () => {
    if (!sessionId) {
      return;
    }

    setRunning(true);
    setElapsedMs(0);
    setResult(null);
    const startedAt = Date.now();
    timerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);

    try {
      const next = await runSessionOptimize(sessionId);
      setResult(next);
      showToast({
        type: next.solver_status === "INFEASIBLE" ? "error" : "success",
        message:
          next.solver_status === "INFEASIBLE"
            ? "Solver nie znalazł wykonalnego zestawu ofert."
            : `Wybrano ${next.selected_offer_ids.length} ofert (cel: ${next.objective_value.toFixed(2)} EUR).`,
      });
      onApplied?.();
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
  }, [onApplied, sessionId, showToast]);

  const handleReject = useCallback(async () => {
    if (!sessionId || !result) {
      return;
    }

    try {
      if (result.current_offer_ids.length > 0) {
        await replaceSessionOffers(sessionId, result.current_offer_ids);
      }
      await cancelSessionOptimize(sessionId);
      setResult(null);
      showToast({ type: "success", message: "Przywrócono poprzedni zestaw ofert." });
      onApplied?.();
    } catch (err) {
      showToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Nie udało się odrzucić wyniku.",
      });
    }
  }, [onApplied, result, sessionId, showToast]);

  if (!sessionId) {
    return null;
  }

  return (
    <Card className="grid gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Solver VRP</CardTitle>
          <CardDescription>
            Automatyczny wybór ofert i optymalizacja sekwencji przystanków.
          </CardDescription>
        </div>
        <Button variant="primary" disabled={running} onClick={() => void handleRun()}>
          {running ? `Optymalizacja… ${formatElapsed(elapsedMs)}` : "Optymalizuj trasę"}
        </Button>
      </div>

      {result && diff ? (
        <div className="grid gap-2 rounded-md border border-[var(--ui-border)] p-3 text-sm">
          <p>
            Status: <strong>{result.solver_status}</strong> · czas:{" "}
            {formatElapsed(result.solve_time_ms)} · cel:{" "}
            {result.objective_value.toFixed(2)} EUR
          </p>
          <p>
            Dodane oferty: {diff.added.length} · usunięte: {diff.removed.length}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setResult(null)}>
              Zamknij podsumowanie
            </Button>
            {result.current_offer_ids.length > 0 ? (
              <Button variant="secondary" onClick={() => void handleReject()}>
                Odrzuć i przywróć
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
