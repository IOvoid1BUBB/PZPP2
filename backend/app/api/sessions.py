"""ConsolidationSession API endpoints (`/api/v1/sessions`)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.rate_limit import rate_limit
from app.lib.routing import RoutingProvider, get_routing_provider
from app.schemas.offer import RankedOffersResponse, SimulateOffersResponse
from app.schemas.profit import SessionProfitBreakdown
from app.schemas.route_geometry import RouteGeometry
from app.schemas.route_map import RouteMapResponse
from app.schemas.session import (
    SessionCreate,
    SessionCreatedResponse,
    SessionFullResponse,
    SessionOffersReplace,
    SessionRead,
    SessionStatusUpdate,
)
from app.services.driver_compliance import ComplianceResult, DriverComplianceService
from app.services.european_offer_generator import generate_european_batch, get_catalog
from app.services.market_offers import bulk_insert_offers
from app.services.offer_scorer import OfferScorerService
from app.services.profit_calculator import SessionProfitCalculator
from app.services.route_geometry import RouteGeometryService
from app.services.route_map import RouteMapService
from app.services.sessions import SessionService
from app.services.stop_labels import resolve_and_persist_stop_label

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _service(db: AsyncSession, routing: RoutingProvider) -> SessionService:
    return SessionService(db, routing=routing)


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
    routing: RoutingProvider = Depends(get_routing_provider),
    limit: int = Query(50, ge=1, le=500),
) -> RankedOffersResponse:
    scorer = OfferScorerService(db, routing=routing)
    return await scorer.rank_offers(session_id, limit=limit)


@router.get(
    "/{session_id}",
    response_model=SessionFullResponse,
    summary="Fetch one session with offers, stops, and metrics",
)
async def get_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    routing: RoutingProvider = Depends(get_routing_provider),
) -> SessionFullResponse:
    service = _service(db, routing)
    return await service.get_full(session_id)


@router.get(
    "/{id}/driver-compliance",
    response_model=ComplianceResult,
    summary="Check planned route against EU 561/2006 driver rules",
)
async def get_driver_compliance(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    routing: RoutingProvider = Depends(get_routing_provider),
) -> ComplianceResult:
    service = DriverComplianceService(db, routing=routing)
    return await service.evaluate_session(id)


@router.post(
    "/{session_id}/offers/{offer_id}",
    response_model=SessionFullResponse,
    summary="Assign an offer to a session",
)
async def add_offer_to_session(
    session_id: UUID,
    offer_id: UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    routing: RoutingProvider = Depends(get_routing_provider),
) -> SessionFullResponse:
    service = _service(db, routing)
    response, new_stop_ids = await service.add_offer(session_id, offer_id)
    await db.commit()
    for stop_id in new_stop_ids:
        background_tasks.add_task(resolve_and_persist_stop_label, stop_id)
    return response


@router.put(
    "/{session_id}/offers",
    response_model=SessionFullResponse,
    summary="Replace all offers assigned to a session",
)
async def replace_session_offers(
    session_id: UUID,
    payload: SessionOffersReplace,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    routing: RoutingProvider = Depends(get_routing_provider),
) -> SessionFullResponse:
    service = _service(db, routing)
    response, new_stop_ids = await service.replace_offers(session_id, payload.offer_ids)
    await db.commit()
    for stop_id in new_stop_ids:
        background_tasks.add_task(resolve_and_persist_stop_label, stop_id)
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
    routing: RoutingProvider = Depends(get_routing_provider),
) -> SessionFullResponse:
    service = _service(db, routing)
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
    routing: RoutingProvider = Depends(get_routing_provider),
) -> SessionFullResponse:
    service = _service(db, routing)
    response = await service.update_status(
        session_id,
        payload.status,
        fleet_vehicle_id=payload.fleet_vehicle_id,
        force_weekly_override=payload.force_weekly_override,
    )
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


@router.get(
    "/{session_id}/route-map",
    response_model=RouteMapResponse,
    summary="Route geometry per leg with load weights for heat-map visualization",
)
async def get_session_route_map(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    routing: RoutingProvider = Depends(get_routing_provider),
) -> RouteMapResponse:
    service = RouteMapService(db, routing=routing)
    return await service.get_route_map(session_id)


@router.get(
    "/{session_id}/route",
    response_model=RouteGeometry,
    summary="Full route GeoJSON geometry with per-leg load data for Leaflet heat-map",
)
async def get_session_route(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    routing: RoutingProvider = Depends(get_routing_provider),
) -> RouteGeometry:
    service = RouteGeometryService(db, routing=routing)
    return await service.get_route_geometry(session_id)


async def _profit_handler(
    session_id: UUID,
    db: AsyncSession,
    routing: RoutingProvider,
    settings: Settings,
) -> SessionProfitBreakdown:
    """Shared handler for profit calculation (used by both GET and POST)."""
    calc = SessionProfitCalculator(db, routing=routing, settings=settings)
    breakdown = await calc.calculate_session_profit(session_id)
    await db.commit()
    return breakdown


@router.post(
    "/{session_id}/profit",
    response_model=SessionProfitBreakdown,
    summary="Compute 5-category cost breakdown and net profit for a session",
)
async def calculate_session_profit(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    routing: RoutingProvider = Depends(get_routing_provider),
    settings: Settings = Depends(get_settings),
) -> SessionProfitBreakdown:
    return await _profit_handler(session_id, db, routing, settings)


@router.get(
    "/{session_id}/profit",
    response_model=SessionProfitBreakdown,
    summary="Retrieve 5-category cost breakdown and net profit for a session (idempotent alias)",
)
async def get_session_profit(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    routing: RoutingProvider = Depends(get_routing_provider),
    settings: Settings = Depends(get_settings),
) -> SessionProfitBreakdown:
    return await _profit_handler(session_id, db, routing, settings)


@router.post(
    "/{session_id}/simulate",
    response_model=SimulateOffersResponse,
    summary="Generate synthetic market offers for testing VRP/UI",
    dependencies=[Depends(rate_limit(limit=20))],
)
async def simulate_market_offers(
    session_id: UUID,
    count: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
) -> SimulateOffersResponse:
    session_service = SessionService(db)
    await session_service.get(session_id)

    generated = generate_european_batch(get_catalog(), count)
    offers = [item.offer for item in generated]
    inserted, skipped = await bulk_insert_offers(db, offers)
    await db.commit()

    return SimulateOffersResponse(
        requested=count,
        inserted=inserted,
        skipped=skipped,
    )
