"""Route stop sequence endpoints (`/api/v1/sessions/{id}/stops`)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import NotFoundError
from app.models import ConsolidationSession, RouteStop
from app.schemas.stop import StopRead
from app.services.sessions import SessionService

router = APIRouter(prefix="/sessions/{session_id}/stops", tags=["stops"])


@router.get(
    "",
    response_model=list[StopRead],
    summary="List planned stops for a session",
)
async def list_stops(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> list[StopRead]:
    session_exists = await db.scalar(
        select(ConsolidationSession.id).where(ConsolidationSession.id == session_id),
    )
    if session_exists is None:
        raise NotFoundError(f"Session {session_id} not found.")

    result = await db.execute(
        select(RouteStop)
        .where(RouteStop.session_id == session_id)
        .order_by(RouteStop.sequence_order),
    )
    stops = list(result.scalars().all())
    return [SessionService._stop_to_schema(stop) for stop in stops]
