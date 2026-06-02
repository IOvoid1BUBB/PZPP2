"""VRP solver endpoint (`/api/v1/sessions/{id}/optimize`)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.schemas.solver import SolverRequest, SolverRunResult
from app.services.vrp_solver import VRPSolver

router = APIRouter(prefix="/sessions/{session_id}/optimize", tags=["solver"])


@router.post(
    "",
    response_model=SolverRunResult,
    status_code=status.HTTP_200_OK,
    summary="Run CP-SAT offer selection for a session",
)
async def trigger_optimization(
    session_id: UUID,
    payload: SolverRequest,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SolverRunResult:
    solver = VRPSolver(db, settings=settings)
    result = await solver.solve(
        session_id=session_id,
        candidate_offer_ids=payload.candidate_offer_ids,
        max_stops_override=payload.max_stops,
        time_limit_seconds=payload.time_limit_seconds,
    )
    await db.commit()
    return result
