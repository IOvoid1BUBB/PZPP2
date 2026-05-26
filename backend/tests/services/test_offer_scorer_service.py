"""Unit tests for OfferScorerService ranking."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.models.offer import MarketOffer
from app.models.session import ConsolidationSession
from app.models.vehicle import Vehicle
from app.services.offer_scorer import OfferScorerService


def _offer(price: float = 100.0, ldm: float = 2.0) -> MarketOffer:
    o = MagicMock(spec=MarketOffer)
    o.id = uuid.uuid4()
    o.price_eur = Decimal(str(price))
    o.ldm = Decimal(str(ldm))
    o.pickup_point = from_shape(Point(21.0, 52.0), srid=4326)
    o.delivery_point = from_shape(Point(22.0, 51.0), srid=4326)
    o.time_window_open = datetime(2025, 5, 1, 8, 0, tzinfo=UTC)
    o.time_window_close = datetime(2025, 5, 1, 18, 0, tzinfo=UTC)
    o.handling_time_minutes = 30
    return o


@pytest.mark.asyncio
async def test_rank_offers_sorts_by_score_desc() -> None:
    session_id = uuid.uuid4()
    vehicle = MagicMock(spec=Vehicle)
    vehicle.max_ldm = Decimal("13.6")
    session = MagicMock(spec=ConsolidationSession)
    session.id = session_id
    session.vehicle = vehicle
    session.route_stops = []
    session.origin_lat = 52.0
    session.origin_lon = 21.0
    session.target_region_bbox = None
    session.created_at = datetime(2025, 5, 1, 6, 0, tzinfo=UTC)

    offers = [_offer(price=500), _offer(price=100)]

    db = AsyncMock()
    osrm = AsyncMock()
    osrm.get_route_multi = AsyncMock(
        return_value=MagicMock(total_distance_km=50.0),
    )
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.setex = AsyncMock()

    service = OfferScorerService(db, osrm=osrm, redis=redis)

    with (
        patch.object(service, "_load_session", AsyncMock(return_value=session)),
        patch.object(service, "_fetch_candidate_offers", AsyncMock(return_value=offers)),
        patch(
            "app.services.offer_scorer.get_regional_p90",
            AsyncMock(return_value=50.0),
        ),
    ):
        result = await service.rank_offers(session_id, limit=10)

    assert result.scored_count == 2
    assert len(result.offers) == 2
    assert result.offers[0].total_score >= result.offers[1].total_score


@pytest.mark.asyncio
async def test_rank_offers_session_not_found() -> None:
    from app.core.exceptions import NotFoundError

    db = AsyncMock()
    service = OfferScorerService(db, osrm=AsyncMock(), redis=AsyncMock())
    with patch.object(service, "_load_session", AsyncMock(return_value=None)):
        with pytest.raises(NotFoundError):
            await service.rank_offers(uuid.uuid4())


@pytest.mark.asyncio
async def test_rank_offers_no_vehicle_raises() -> None:
    from app.core.exceptions import ValidationAppError

    session = MagicMock(spec=ConsolidationSession)
    session.vehicle = None
    db = AsyncMock()
    service = OfferScorerService(db, osrm=AsyncMock(), redis=AsyncMock())
    with patch.object(service, "_load_session", AsyncMock(return_value=session)):
        with pytest.raises(ValidationAppError):
            await service.rank_offers(uuid.uuid4())


@pytest.mark.asyncio
async def test_build_scoring_context_osrm_fallback() -> None:
    from app.core.exceptions import OSRMUnavailableError
    from app.services.offer_scorer import SessionScoringContext

    session = MagicMock(spec=ConsolidationSession)
    session.route_stops = []
    session.origin_lat = 52.0
    session.origin_lon = 21.0
    session.created_at = datetime(2025, 5, 1, 6, 0, tzinfo=UTC)

    osrm = AsyncMock()
    osrm.get_route_multi = AsyncMock(side_effect=OSRMUnavailableError("down"))
    service = OfferScorerService(AsyncMock(), osrm=osrm, redis=AsyncMock())
    ctx = await service._build_scoring_context(session)
    assert isinstance(ctx, SessionScoringContext)
    assert ctx.baseline_km == 0.0


@pytest.mark.asyncio
async def test_haversine_route_km_multi_leg() -> None:
    service = OfferScorerService(AsyncMock(), osrm=AsyncMock(), redis=AsyncMock())
    km = service._haversine_route_km([(52.0, 21.0), (51.0, 20.0), (50.0, 19.0)])
    assert km > 0.0


@pytest.mark.asyncio
async def test_fetch_candidate_offers_with_bbox() -> None:
    session = MagicMock(spec=ConsolidationSession)
    session.target_region_bbox = [14.0, 49.0, 24.0, 55.0]
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(scalars=lambda: MagicMock(all=lambda: [])))
    service = OfferScorerService(db, osrm=AsyncMock(), redis=AsyncMock())
    offers = await service._fetch_candidate_offers(session)
    assert offers == []
    db.execute.assert_awaited_once()
