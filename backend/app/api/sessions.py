"""ConsolidationSession CRUD endpoints (`/api/v1/sessions`)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.offer import SimulateOffersResponse
from app.schemas.session import SessionCreate, SessionRead, SessionUpdate
from app.services.market_offers import bulk_insert_offers
from app.services.market_simulator import generate_batch
from app.services.sessions import SessionService

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("", response_model=list[SessionRead], summary="List consolidation sessions")
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[SessionRead]:
    service = SessionService(db)
    sessions = await service.list_all(limit=limit, offset=offset)
    return [SessionRead.model_validate(s) for s in sessions]


@router.post(
    "",
    response_model=SessionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new consolidation session",
)
async def create_session(
    payload: SessionCreate,
    db: AsyncSession = Depends(get_db),
) -> SessionRead:
    service = SessionService(db)
    instance = await service.create(payload)
    await db.commit()
    return SessionRead.model_validate(instance)


@router.get("/{session_id}", response_model=SessionRead, summary="Fetch one session")
async def get_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SessionRead:
    service = SessionService(db)
    instance = await service.get(session_id)
    return SessionRead.model_validate(instance)


@router.patch("/{session_id}", response_model=SessionRead, summary="Patch a session")
async def update_session(
    session_id: UUID,
    payload: SessionUpdate,
    db: AsyncSession = Depends(get_db),
) -> SessionRead:
    service = SessionService(db)
    instance = await service.update(session_id, payload)
    await db.commit()
    return SessionRead.model_validate(instance)


@router.delete(
    "/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete a session",
)
async def delete_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    service = SessionService(db)
    await service.delete(session_id)
    await db.commit()


@router.post(
    "/{session_id}/simulate",
    response_model=SimulateOffersResponse,
    summary="Generate synthetic market offers for testing VRP/UI",
)
async def simulate_market_offers(
    session_id: UUID,
    count: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
) -> SimulateOffersResponse:
    session_service = SessionService(db)
    await session_service.get(session_id)

    generated = generate_batch(count)
    offers = [item.offer for item in generated]
    inserted, skipped = await bulk_insert_offers(db, offers)
    await db.commit()

    return SimulateOffersResponse(
        requested=count,
        inserted=inserted,
        skipped=skipped,
    )
