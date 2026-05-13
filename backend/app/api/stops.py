"""Route stop sequence endpoints (`/api/v1/sessions/{id}/stops`)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter

from app.schemas.stop import StopRead

router = APIRouter(prefix="/sessions/{session_id}/stops", tags=["stops"])


@router.get(
    "",
    response_model=list[StopRead],
    summary="List planned stops for a session (stub)",
)
async def list_stops(session_id: UUID) -> list[StopRead]:
    # NOTE: DB-backed implementation comes in a follow-up task.
    _ = session_id
    return []
