/** UUID oferty / sesji — alias string zgodny z API backendu. */
export type UUID = string;

export type SolverStatus = "queued" | "running" | "ok" | "infeasible" | "error";

export interface SolverResult {
  sessionId: UUID;
  solverRunId: UUID;
  status: SolverStatus;
  selectedOfferIds: UUID[];
  isOptimal: boolean;
  objectiveValue?: number | null;
  solveTimeMs?: number | null;
}

export type SolverState = "idle" | "running" | "done" | "error";

export interface SolverUIState {
  state: SolverState;
  elapsedSeconds: number;
  result: SolverResult | null;
  error: string | null;
  abortController: AbortController | null;
}

export interface BulkSessionOffersPayload {
  offer_ids: UUID[];
}
