"""Schemas for the VRP solver endpoint."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field

SolverRunStatus = Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN", "CANCELLED"]
SolverJobStatus = Literal[
    "IDLE",
    "RUNNING",
    "OPTIMAL",
    "FEASIBLE",
    "INFEASIBLE",
    "UNKNOWN",
    "CANCELLED",
]


class SolverRequest(BaseModel):
    """Inputs accepted by the VRP solver."""

    model_config = ConfigDict(extra="forbid")

    candidate_offer_ids: list[UUID] = Field(default_factory=list)
    max_stops: int | None = Field(default=None, ge=0)
    time_limit_seconds: int = Field(default=10, ge=1, le=600)
    use_full_market: bool = Field(
        default=False,
        description="When True, pull candidates from all market_offers (up to 500) instead of session-scoped rank.",
    )
    weekly_driving_minutes_used: int = Field(
        default=0,
        ge=0,
        description="Minutes already driven this week by the driver across other sessions.",
    )


class StopSequenceEntry(BaseModel):
    """One stop in the optimized route sequence."""

    model_config = ConfigDict(extra="forbid")

    route_stop_id: UUID
    offer_id: UUID
    stop_type: Literal["pickup", "delivery"]
    sequence_order: int


class SolverRunResult(BaseModel):
    """Outcome of a synchronous CP-SAT solver run."""

    model_config = ConfigDict(extra="forbid")

    session_id: UUID
    solver_run_id: UUID
    selected_offer_ids: list[UUID] = Field(default_factory=list)
    is_optimal: bool = True
    objective_value: float
    solver_status: SolverRunStatus
    is_optimal: bool
    solve_time_ms: int
    stop_sequence: list[StopSequenceEntry] = Field(default_factory=list)
    current_offer_ids: list[UUID] = Field(default_factory=list)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def status(self) -> SolverRunStatus:
        """Alias for ``solver_status`` (spec compatibility)."""
        return self.solver_status


class SolverStatusResponse(BaseModel):
    """Lightweight polling payload for ``GET /optimize/status``."""

    model_config = ConfigDict(extra="forbid")

    status: SolverJobStatus
    elapsed_ms: int = Field(ge=0)
    best_objective: float | None = None
    result: SolverRunResult | None = None


# Keep the old response alias for backwards compatibility with any existing imports.
SolverResponse = SolverRunResult
