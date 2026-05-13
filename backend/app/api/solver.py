"""VRP solver trigger endpoint (`/api/v1/sessions/{id}/optimize`)."""

from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, status

from app.schemas.solver import SolverRequest, SolverResponse

router = APIRouter(prefix="/sessions/{session_id}/optimize", tags=["solver"])


@router.post(
    "",
    response_model=SolverResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger VRP optimization for a session (stub)",
)
async def trigger_optimization(
    session_id: UUID,
    payload: SolverRequest,
) -> SolverResponse:
    # NOTE: hands off to services.optimization in a follow-up task.
    return SolverResponse(
        session_id=session_id,
        solver_run_id=uuid4(),
        status="queued",
        selected_offer_ids=payload.candidate_offer_ids,
    )
