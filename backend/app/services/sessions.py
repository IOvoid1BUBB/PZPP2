"""Service layer for :class:`ConsolidationSession`.

Thin wrapper around SQLAlchemy reads/writes. Pure DB plumbing only —
no routing, costing or solver logic lives here.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models import ConsolidationSession
from app.schemas.session import SessionCreate, SessionUpdate


class SessionService:
    """CRUD helpers for consolidation sessions."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def list_all(self, *, limit: int = 100, offset: int = 0) -> list[ConsolidationSession]:
        stmt = (
            select(ConsolidationSession)
            .order_by(ConsolidationSession.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self._db.execute(stmt)
        return list(result.scalars().all())

    async def get(self, session_id: UUID) -> ConsolidationSession:
        stmt = select(ConsolidationSession).where(ConsolidationSession.id == session_id)
        result = await self._db.execute(stmt)
        instance = result.scalar_one_or_none()
        if instance is None:
            raise NotFoundError(f"Session {session_id} not found.")
        return instance

    async def create(self, payload: SessionCreate) -> ConsolidationSession:
        instance = ConsolidationSession(
            vehicle_id=payload.vehicle_id,
            status=payload.status,
        )
        self._db.add(instance)
        await self._db.flush()
        await self._db.refresh(instance)
        return instance

    async def update(self, session_id: UUID, payload: SessionUpdate) -> ConsolidationSession:
        instance = await self.get(session_id)
        data = payload.model_dump(exclude_unset=True)
        for key, value in data.items():
            setattr(instance, key, value)
        await self._db.flush()
        await self._db.refresh(instance)
        return instance

    async def delete(self, session_id: UUID) -> None:
        instance = await self.get(session_id)
        await self._db.delete(instance)
        await self._db.flush()
