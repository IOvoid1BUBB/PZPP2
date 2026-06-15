"""Schemas for the VRP solver trigger endpoint."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

SolverStatus = Literal["queued", "running", "ok", "infeasible", "error"]


class SolverRequest(BaseModel):
    """Inputs accepted by the VRP solver trigger."""

    model_config = ConfigDict(extra="forbid")

    candidate_offer_ids: list[UUID] = Field(default_factory=list)
    max_stops: int | None = Field(default=None, ge=0)
    time_limit_seconds: int = Field(default=30, ge=1, le=600)


class SolverResponse(BaseModel):
    """Outcome of a solver run (synchronous summary)."""

    model_config = ConfigDict(extra="forbid")

    session_id: UUID
    solver_run_id: UUID
    status: SolverStatus
    objective_value: float | None = None
    solve_time_ms: int | None = None
    selected_offer_ids: list[UUID] = Field(default_factory=list)
    is_optimal: bool = True
