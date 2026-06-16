"""Shared eager-loading query for consolidation sessions."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import ConsolidationSession, RouteStop


async def load_session(db: AsyncSession, session_id: UUID) -> ConsolidationSession | None:
    """Load a session with vehicle, driver profile, route stops, and offers."""
    stmt = (
        select(ConsolidationSession)
        .where(ConsolidationSession.id == session_id)
        .options(
            selectinload(ConsolidationSession.vehicle),
            selectinload(ConsolidationSession.driver_profile),
            selectinload(ConsolidationSession.route_stops).selectinload(RouteStop.offer),
        )
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()
