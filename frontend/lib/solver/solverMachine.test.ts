/**
 * solverMachine.test.ts — Task 5.1 state machine.
 *
 * Pokrycie przejść: idle → running → done | error → idle (reset), oraz
 * niezmienności stanu początkowego.
 */

import { describe, it, expect } from "vitest";

import type { SolverRunResult } from "@/lib/api/sessionClient";
import {
  INITIAL_SOLVER_STATE,
  solverReducer,
  type SolverMachineState,
} from "./solverMachine";

function makeResult(overrides: Partial<SolverRunResult> = {}): SolverRunResult {
  return {
    session_id: "session-1",
    solver_run_id: "run-1",
    selected_offer_ids: ["a", "b"],
    objective_value: 1234.5,
    solver_status: "OPTIMAL",
    is_optimal: true,
    solve_time_ms: 4200,
    current_offer_ids: ["a"],
    ...overrides,
  };
}

describe("solverReducer", () => {
  it("startuje w stanie idle bez wyniku i błędu", () => {
    expect(INITIAL_SOLVER_STATE).toEqual({
      status: "idle",
      result: null,
      error: null,
    });
  });

  it("run: idle → running i czyści poprzedni wynik/błąd", () => {
    const dirty: SolverMachineState = {
      status: "error",
      result: makeResult(),
      error: "boom",
    };

    const next = solverReducer(dirty, { type: "run" });

    expect(next).toEqual({ status: "running", result: null, error: null });
  });

  it("resolved: running → done z zachowaniem wyniku", () => {
    const running = solverReducer(INITIAL_SOLVER_STATE, { type: "run" });
    const result = makeResult({ solver_status: "FEASIBLE", is_optimal: false });

    const next = solverReducer(running, { type: "resolved", result });

    expect(next.status).toBe("done");
    expect(next.result).toBe(result);
    expect(next.error).toBeNull();
  });

  it("failed: running → error z komunikatem i bez wyniku", () => {
    const running = solverReducer(INITIAL_SOLVER_STATE, { type: "run" });

    const next = solverReducer(running, { type: "failed", error: "timeout" });

    expect(next).toEqual({ status: "error", result: null, error: "timeout" });
  });

  it("reset: dowolny stan → idle", () => {
    const done = solverReducer(
      solverReducer(INITIAL_SOLVER_STATE, { type: "run" }),
      { type: "resolved", result: makeResult() },
    );

    const next = solverReducer(done, { type: "reset" });

    expect(next).toEqual(INITIAL_SOLVER_STATE);
    expect(next).not.toBe(INITIAL_SOLVER_STATE);
  });

  it("nie mutuje stanu początkowego", () => {
    solverReducer(INITIAL_SOLVER_STATE, { type: "run" });
    solverReducer(INITIAL_SOLVER_STATE, { type: "resolved", result: makeResult() });

    expect(INITIAL_SOLVER_STATE).toEqual({
      status: "idle",
      result: null,
      error: null,
    });
  });

  it("ignoruje nieznaną akcję i zwraca ten sam stan", () => {
    const state = solverReducer(INITIAL_SOLVER_STATE, { type: "run" });

    // @ts-expect-error — celowo nieprawidłowa akcja, test zachowania default.
    const next = solverReducer(state, { type: "unknown" });

    expect(next).toBe(state);
  });
});
