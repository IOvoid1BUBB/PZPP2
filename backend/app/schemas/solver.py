"""Schemas for the VRP solver endpoint."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

SolverRunStatus = Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN"]


class SolverRequest(BaseModel):
    """Inputs accepted by the VRP solver."""

    model_config = ConfigDict(extra="forbid")

    candidate_offer_ids: list[UUID] = Field(default_factory=list)
    max_stops: int | None = Field(default=None, ge=0)
    time_limit_seconds: int = Field(default=10, ge=1, le=600)


class SolverRunResult(BaseModel):
    """Outcome of a synchronous CP-SAT solver run."""

    model_config = ConfigDict(extra="forbid")

    session_id: UUID
    solver_run_id: UUID
    selected_offer_ids: list[UUID] = Field(default_factory=list)
    objective_value: float
    solver_status: SolverRunStatus
    is_optimal: bool
    solve_time_ms: int


# Keep the old response alias for backwards compatibility with any existing imports.
SolverResponse = SolverRunResult
