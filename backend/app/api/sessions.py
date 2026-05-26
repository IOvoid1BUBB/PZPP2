"""ConsolidationSession API endpoints (`/api/v1/sessions`)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.lib.osrm import OSRMClient, get_osrm_client
from app.schemas.offer import RankedOffersResponse, SimulateOffersResponse
from app.schemas.session import (
    SessionCreate,
    SessionCreatedResponse,
    SessionFullResponse,
    SessionRead,
    SessionStatusUpdate,
)
from app.services.market_offers import bulk_insert_offers
from app.services.market_simulator import generate_batch
from app.services.offer_scorer import OfferScorerService
from app.services.sessions import SessionService

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _service(db: AsyncSession, osrm: OSRMClient) -> SessionService:
    return SessionService(db, osrm=osrm)


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
    response_model=SessionCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new consolidation session",
)
async def create_session(
    payload: SessionCreate,
    db: AsyncSession = Depends(get_db),
) -> SessionCreatedResponse:
    service = SessionService(db)
    instance = await service.create(payload)
    await db.commit()
    return SessionCreatedResponse(id=instance.id, status="draft")


@router.get(
    "/{session_id}/ranked-offers",
    response_model=RankedOffersResponse,
    summary="Rank market offers for a session by deterministic score",
)
async def get_ranked_offers(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    osrm: OSRMClient = Depends(get_osrm_client),
    limit: int = Query(50, ge=1, le=500),
) -> RankedOffersResponse:
    scorer = OfferScorerService(db, osrm=osrm)
    return await scorer.rank_offers(session_id, limit=limit)


@router.get(
    "/{session_id}",
    response_model=SessionFullResponse,
    summary="Fetch one session with offers, stops, and metrics",
)
async def get_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    osrm: OSRMClient = Depends(get_osrm_client),
) -> SessionFullResponse:
    service = _service(db, osrm)
    return await service.get_full(session_id)


@router.post(
    "/{session_id}/offers/{offer_id}",
    response_model=SessionFullResponse,
    summary="Assign an offer to a session",
)
async def add_offer_to_session(
    session_id: UUID,
    offer_id: UUID,
    db: AsyncSession = Depends(get_db),
    osrm: OSRMClient = Depends(get_osrm_client),
) -> SessionFullResponse:
    service = _service(db, osrm)
    response = await service.add_offer(session_id, offer_id)
    await db.commit()
    return response


@router.delete(
    "/{session_id}/offers/{offer_id}",
    response_model=SessionFullResponse,
    summary="Remove an offer from a session",
)
async def remove_offer_from_session(
    session_id: UUID,
    offer_id: UUID,
    db: AsyncSession = Depends(get_db),
    osrm: OSRMClient = Depends(get_osrm_client),
) -> SessionFullResponse:
    service = _service(db, osrm)
    response = await service.remove_offer(session_id, offer_id)
    await db.commit()
    return response


@router.patch(
    "/{session_id}/status",
    response_model=SessionFullResponse,
    summary="Transition session status",
)
async def update_session_status(
    session_id: UUID,
    payload: SessionStatusUpdate,
    db: AsyncSession = Depends(get_db),
    osrm: OSRMClient = Depends(get_osrm_client),
) -> SessionFullResponse:
    service = _service(db, osrm)
    response = await service.update_status(session_id, payload.status)
    await db.commit()
    return response


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
