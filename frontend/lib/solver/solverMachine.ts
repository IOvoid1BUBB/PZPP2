/**
 * @file solverMachine.ts
 *
 * Pure state machine for the VRP solver UI (Task 5.1).
 *
 * Stany: idle → running → done | error, z powrotem do idle przez `reset`.
 * Wydzielone z komponentu, aby przejścia można było przetestować jednostkowo
 * bez renderowania Reacta.
 *
 * UWAGA: anulowanie (AbortError) NIE jest błędem — komponent obsługuje je przez
 * akcję `reset` (powrót do idle), nigdy przez `error`.
 */

import type { SolverState } from "@/lib/types/solver";
import type { SolverRunResult } from "@/lib/api/sessionClient";

export interface SolverMachineState {
  /** idle | running | done | error */
  status: SolverState;
  /** Solver proposal once available (status === "done"). */
  result: SolverRunResult | null;
  /** Human-readable error (status === "error"). */
  error: string | null;
}

export const INITIAL_SOLVER_STATE: SolverMachineState = {
  status: "idle",
  result: null,
  error: null,
};

export type SolverAction =
  /** Optimisation started — clears any previous result/error. */
  | { type: "run" }
  /** Solver returned a proposal (even INFEASIBLE is a "done" result). */
  | { type: "resolved"; result: SolverRunResult }
  /** A genuine error occurred (never used for AbortError). */
  | { type: "failed"; error: string }
  /** Back to idle: cancel, discard, or apply. */
  | { type: "reset" };

export function solverReducer(
  state: SolverMachineState,
  action: SolverAction,
): SolverMachineState {
  switch (action.type) {
    case "run":
      return { status: "running", result: null, error: null };
    case "resolved":
      return { status: "done", result: action.result, error: null };
    case "failed":
      return { status: "error", result: null, error: action.error };
    case "reset":
      return { ...INITIAL_SOLVER_STATE };
    default:
      return state;
  }
}
