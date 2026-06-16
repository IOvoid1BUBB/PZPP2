"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  bulkUpdateSessionOffers,
  cancelSolverOptimize,
  runSolverOptimize,
} from "@/lib/api/sessionClient";
import { useLoadStore } from "@/lib/stores/loadStore";
import type { SolverUIState, UUID } from "@/lib/types/solver";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SolverPanelProps {
  sessionId: string;
  /** Pool ofert dostępnych do optymalizacji (min. 2 wymagane). */
  availableOfferIds: UUID[];
  /** Etykiety ofert do widoku diff (opcjonalne). */
  offerLabels?: Record<string, string>;
  /**
   * Bieżące oferty sesji; domyślnie z loadStore.sessionOfferIds
   * (fallback: unikalne offerId z załadowanych slotów).
   */
  currentOfferIds?: UUID[];
}

// ─── Diff helpers ───────────────────────────────────────────────────────────

type OfferDiffKind = "added" | "removed" | "unchanged";

interface OfferDiffEntry {
  id: UUID;
  kind: OfferDiffKind;
}

function buildOfferDiff(current: UUID[], proposed: UUID[]): OfferDiffEntry[] {
  const currentSet = new Set(current);
  const proposedSet = new Set(proposed);
  const rows: OfferDiffEntry[] = [];

  for (const id of proposed) {
    rows.push({
      id,
      kind: currentSet.has(id) ? "unchanged" : "added",
    });
  }

  for (const id of current) {
    if (!proposedSet.has(id)) {
      rows.push({ id, kind: "removed" });
    }
  }

  return rows;
}

function formatOfferLabel(id: UUID, labels?: Record<string, string>): string {
  return labels?.[id] ?? `#${id.slice(0, 8).toUpperCase()}`;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const INITIAL_UI: SolverUIState = {
  state: "idle",
  elapsedSeconds: 0,
  result: null,
  error: null,
  abortController: null,
};

// ─── Isolated live timer (re-render co 1 s tylko tutaj) ────────────────────

interface SolverElapsedTimerProps {
  active: boolean;
  runKey: number;
}

function SolverElapsedTimer({ active, runKey }: SolverElapsedTimerProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    setElapsedSeconds(0);
  }, [runKey]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds((value) => value + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [active, runKey]);

  if (!active) {
    return null;
  }

  return (
    <p
      className="font-mono text-sm tabular-nums text-[var(--color-text-secondary)]"
      aria-live="polite"
      aria-atomic="true"
    >
      Czas: {formatElapsed(elapsedSeconds)}
    </p>
  );
}

// ─── Diff rows ──────────────────────────────────────────────────────────────

interface OfferDiffRowProps {
  id: UUID;
  kind: OfferDiffKind;
  label: string;
}

function OfferDiffRow({ id, kind, label }: OfferDiffRowProps) {
  const rowClass =
    kind === "added"
      ? "bg-green-100 dark:bg-green-500/10"
      : kind === "removed"
        ? "bg-red-100 line-through dark:bg-red-500/10"
        : "bg-[var(--color-surface-raised)]";

  const badge =
    kind === "added" ? (
      <span className="rounded bg-green-600/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-800 dark:text-green-200">
        Dodana
      </span>
    ) : kind === "removed" ? (
      <span className="rounded bg-red-600/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800 dark:text-red-200">
        Usunięta
      </span>
    ) : (
      <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        Bez zmian
      </span>
    );

  return (
    <li
      className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ${rowClass}`}
      data-offer-id={id}
      data-diff-kind={kind}
    >
      <span className="min-w-0 truncate font-medium">{label}</span>
      {badge}
    </li>
  );
}

interface SolverDiffProps {
  currentOfferIds: UUID[];
  proposedOfferIds: UUID[];
  offerLabels?: Record<string, string>;
}

function SolverDiff({ currentOfferIds, proposedOfferIds, offerLabels }: SolverDiffProps) {
  const rows = useMemo(
    () => buildOfferDiff(currentOfferIds, proposedOfferIds),
    [currentOfferIds, proposedOfferIds],
  );

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">Brak ofert do porównania.</p>
    );
  }

  const addedCount = rows.filter((row) => row.kind === "added").length;
  const removedCount = rows.filter((row) => row.kind === "removed").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-secondary)]">
        <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-900 dark:bg-green-500/20 dark:text-green-100">
          +{addedCount} dodane
        </span>
        <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-900 dark:bg-red-500/20 dark:text-red-100">
          −{removedCount} usunięte
        </span>
      </div>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto" aria-label="Porównanie ofert">
        {rows.map((row) => (
          <OfferDiffRow
            key={`${row.kind}-${row.id}`}
            id={row.id}
            kind={row.kind}
            label={formatOfferLabel(row.id, offerLabels)}
          />
        ))}
      </ul>
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────

export function SolverPanel({
  sessionId,
  availableOfferIds,
  offerLabels,
  currentOfferIds: currentOfferIdsProp,
}: SolverPanelProps) {
  const sessionOfferIds = useLoadStore((state) => state.sessionOfferIds);
  const slots = useLoadStore((state) => state.slots);
  const applyBulkOffers = useLoadStore((state) => state.applyBulkOffers);

  const slotOfferIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pallet of Object.values(slots)) {
      if (pallet?.offerId) {
        ids.add(pallet.offerId);
      }
    }
    return Array.from(ids);
  }, [slots]);

  const currentOfferIds =
    currentOfferIdsProp ??
    (sessionOfferIds.length > 0 ? sessionOfferIds : slotOfferIds);

  const [ui, setUi] = useState<SolverUIState>(INITIAL_UI);
  const [timerRunKey, setTimerRunKey] = useState(0);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const canOptimize = availableOfferIds.length >= 2;
  const proposedOfferIds = ui.result?.selectedOfferIds ?? [];
  const showDiff = ui.state === "done" && proposedOfferIds.length > 0;

  const runSolver = useCallback(async () => {
    if (!canOptimize) {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setApplyError(null);
    setUi({
      state: "running",
      elapsedSeconds: 0,
      result: null,
      error: null,
      abortController: controller,
    });
    setTimerRunKey((key) => key + 1);

    try {
      const result = await runSolverOptimize(
        sessionId,
        availableOfferIds,
        controller.signal,
      );
      setUi((prev) => ({
        ...prev,
        state: "done",
        result,
        error: null,
        abortController: null,
      }));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const message =
        error instanceof Error ? error.message : "Nieznany błąd optymalizacji.";
      setUi((prev) => ({
        ...prev,
        state: "error",
        error: message,
        abortController: null,
      }));
    } finally {
      abortRef.current = null;
    }
  }, [availableOfferIds, canOptimize, sessionId]);

  const cancelSolver = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;

    try {
      await cancelSolverOptimize(sessionId);
    } catch {
      /* przywróć idle nawet gdy DELETE się nie powiedzie po stronie klienta */
    }

    setUi(INITIAL_UI);
  }, [sessionId]);

  const applyResult = useCallback(async () => {
    if (!ui.result?.selectedOfferIds.length) {
      return;
    }

    const nextIds = ui.result.selectedOfferIds;
    setApplying(true);
    setApplyError(null);

    applyBulkOffers(nextIds);

    try {
      await bulkUpdateSessionOffers(sessionId, nextIds);
      setUi(INITIAL_UI);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Nie udało się zapisać ofert na serwerze.";
      setApplyError(message);
    } finally {
      setApplying(false);
    }
  }, [applyBulkOffers, sessionId, ui.result]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  let statusMessage: ReactNode = null;
  if (ui.state === "running") {
    statusMessage = (
      <p className="text-sm text-[var(--color-text-secondary)]">
        Optymalizacja trasy w toku…
      </p>
    );
  } else if (ui.state === "error" && ui.error) {
    statusMessage = (
      <p className="text-sm text-red-700 dark:text-red-300" role="alert">
        {ui.error}
      </p>
    );
  } else if (applyError) {
    statusMessage = (
      <p className="text-sm text-amber-800 dark:text-amber-200" role="alert">
        {applyError}
      </p>
    );
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      aria-label="Optymalizator VRP"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight">Optymalizacja trasy</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {availableOfferIds.length} dostępnych ofert · {currentOfferIds.length} w sesji
          </p>
        </div>
        {ui.state === "done" && ui.result && !ui.result.isOptimal && (
          <span
            className="rounded-full border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-amber-900 dark:border-amber-500/60 dark:bg-amber-950/50 dark:text-amber-100"
            title="Wynik może nie być globalnie optymalny"
          >
            PRZYBLIŻONY
          </span>
        )}
      </header>

      <SolverElapsedTimer active={ui.state === "running"} runKey={timerRunKey} />
      {statusMessage}

      <div className="flex flex-wrap gap-2">
        {ui.state === "running" ? (
          <button
            type="button"
            className="button rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-surface-raised)]"
            onClick={() => void cancelSolver()}
          >
            Anuluj
          </button>
        ) : (
          <button
            type="button"
            className="button button--primary rounded-md px-4 py-2"
            disabled={!canOptimize || applying}
            onClick={() => void runSolver()}
            title={
              canOptimize
                ? undefined
                : "Wymagane co najmniej 2 dostępne oferty do optymalizacji."
            }
          >
            Optymalizuj
          </button>
        )}

        {ui.state === "done" && (
          <>
            <button
              type="button"
              className="button button--primary rounded-md px-4 py-2"
              disabled={applying}
              onClick={() => void applyResult()}
            >
              Zastosuj
            </button>
            <button
              type="button"
              className="button rounded-md border border-[var(--color-border)] bg-transparent px-4 py-2 text-sm font-medium"
              disabled={applying}
              onClick={() => setUi(INITIAL_UI)}
            >
              Odrzuć
            </button>
          </>
        )}
      </div>

      {!canOptimize && ui.state === "idle" && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Dodaj co najmniej 2 oferty do puli, aby uruchomić optymalizator.
        </p>
      )}

      {showDiff && (
        <div className="border-t border-[var(--color-border)] pt-4">
          <h3 className="mb-3 text-sm font-semibold">Proponowane zmiany</h3>
          <SolverDiff
            currentOfferIds={currentOfferIds}
            proposedOfferIds={proposedOfferIds}
            offerLabels={offerLabels}
          />
        </div>
      )}
    </section>
  );
}
