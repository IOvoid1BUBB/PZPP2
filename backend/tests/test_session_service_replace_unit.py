"""Unit tests for SessionService.replace_offers (no database)."""

from __future__ import annotations

import os
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)

from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.core.exceptions import AppException, NotFoundError, ValidationAppError
from app.services.sessions import SessionService


def _loc(lat: float = 52.0, lon: float = 21.0) -> object:
    return from_shape(Point(lon, lat), srid=4326)


def _make_offer(offer_id: object, *, ldm: float = 2.0, weight: int = 500) -> MagicMock:
    offer = MagicMock()
    offer.id = offer_id
    offer.ldm = Decimal(str(ldm))
    offer.weight_kg = weight
    offer.pickup_point = _loc()
    offer.delivery_point = _loc(51.0, 20.0)
    offer.handling_time_minutes = 30
    offer.price_eur = Decimal("500")
    offer.time_window_open = None
    offer.time_window_close = None
    offer.stackable = True
    offer.is_within_corridor = True
    return offer


@pytest.mark.asyncio
async def test_replace_offers_rejects_empty_list() -> None:
    service = SessionService(AsyncMock())
    service.get = AsyncMock(return_value=MagicMock(status="draft"))
    service._ensure_draft = MagicMock()  # type: ignore[method-assign]
    service._require_vehicle = AsyncMock(return_value=MagicMock())  # type: ignore[method-assign]

    with pytest.raises(ValidationAppError):
        await service.replace_offers(uuid4(), [])


@pytest.mark.asyncio
async def test_replace_offers_rejects_excess_ldm() -> None:
    session_id = uuid4()
    offer_id = uuid4()
    session = MagicMock(status="draft")
    vehicle = MagicMock(max_ldm=5.0, max_weight_kg=10_000)

    service = SessionService(AsyncMock())
    service.get = AsyncMock(return_value=session)
    service._ensure_draft = MagicMock()  # type: ignore[method-assign]
    service._require_vehicle = AsyncMock(return_value=vehicle)  # type: ignore[method-assign]
    service._get_offers = AsyncMock(return_value=[_make_offer(offer_id, ldm=8.0)])  # type: ignore[method-assign]

    with pytest.raises(AppException) as exc:
        await service.replace_offers(session_id, [offer_id])
    assert exc.value.error_code == "insufficient_ldm"
    assert exc.value.context["free_ldm"] == 5.0


@pytest.mark.asyncio
async def test_replace_offers_rejects_excess_weight() -> None:
    session_id = uuid4()
    offer_id = uuid4()
    vehicle = MagicMock(max_ldm=20.0, max_weight_kg=100)

    service = SessionService(AsyncMock())
    service.get = AsyncMock(return_value=MagicMock(status="draft"))
    service._ensure_draft = MagicMock()  # type: ignore[method-assign]
    service._require_vehicle = AsyncMock(return_value=vehicle)  # type: ignore[method-assign]
    service._get_offers = AsyncMock(return_value=[_make_offer(offer_id, weight=500)])  # type: ignore[method-assign]

    with pytest.raises(AppException) as exc:
        await service.replace_offers(session_id, [offer_id])
    assert exc.value.error_code == "insufficient_weight"


@pytest.mark.asyncio
async def test_replace_offers_not_found_offer() -> None:
    service = SessionService(AsyncMock())
    service.get = AsyncMock(return_value=MagicMock(status="draft"))
    service._ensure_draft = MagicMock()  # type: ignore[method-assign]
    service._require_vehicle = AsyncMock(return_value=MagicMock(max_ldm=20.0, max_weight_kg=20_000))  # type: ignore[method-assign]
    service._get_offers = AsyncMock(side_effect=NotFoundError("missing"))  # type: ignore[method-assign]

    with pytest.raises(NotFoundError):
        await service.replace_offers(uuid4(), [uuid4()])


@pytest.mark.asyncio
async def test_replace_offers_success_delegates_to_apply() -> None:
    session_id = uuid4()
    offer_ids = [uuid4(), uuid4()]
    session = MagicMock(status="draft", id=session_id)
    vehicle = MagicMock(max_ldm=20.0, max_weight_kg=20_000)

    ordered_stops = [MagicMock(id=uuid4()) for _ in range(4)]
    full_response = MagicMock()

    service = SessionService(AsyncMock())
    service.get = AsyncMock(return_value=session)
    service._ensure_draft = MagicMock()  # type: ignore[method-assign]
    service._require_vehicle = AsyncMock(return_value=vehicle)  # type: ignore[method-assign]
    service._get_offers = AsyncMock(  # type: ignore[method-assign]
        return_value=[_make_offer(oid) for oid in offer_ids],
    )
    service._apply_offers_and_optimize_route = AsyncMock(return_value=ordered_stops)  # type: ignore[method-assign]
    service._db.refresh = AsyncMock()
    service._build_full_response = AsyncMock(return_value=full_response)  # type: ignore[method-assign]

    response, stop_ids = await service.replace_offers(session_id, offer_ids)
    assert response is full_response
    assert len(stop_ids) == 4
    service._apply_offers_and_optimize_route.assert_awaited_once_with(session_id, offer_ids)


@pytest.mark.asyncio
async def test_apply_offers_requires_origin() -> None:
    session_id = uuid4()
    session = MagicMock(id=session_id, origin_lat=None, origin_lon=None)

    service = SessionService(AsyncMock())
    service.get = AsyncMock(return_value=session)

    with pytest.raises(ValidationAppError):
        await service._apply_offers_and_optimize_route(session_id, [uuid4()])


@pytest.mark.asyncio
async def test_apply_offers_and_optimize_route_flow() -> None:
    """_apply_offers_and_optimize_route deletes, inserts, optimizes, recalculates."""
    from app.lib.osrm import DistanceMatrix

    session_id = uuid4()
    offer_id = uuid4()
    session = MagicMock(
        id=session_id,
        origin_lat=52.0,
        origin_lon=21.0,
        vehicle=MagicMock(type="standard"),
        driver_profile=MagicMock(),
    )
    offer = _make_offer(offer_id)

    pickup = MagicMock(
        id=uuid4(),
        offer_id=offer_id,
        stop_type="pickup",
        sequence_order=0,
        location=_loc(),
        offer=offer,
    )
    delivery = MagicMock(
        id=uuid4(),
        offer_id=offer_id,
        stop_type="delivery",
        sequence_order=1,
        location=_loc(51.0, 20.0),
        offer=offer,
    )

    mock_db = AsyncMock()
    mock_db.flush = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.execute = AsyncMock()

    matrix = DistanceMatrix(
        distances_km=[[0.0, 1.0], [1.0, 0.0]],
        durations_minutes=[[0, 60], [60, 0]],
        n=2,
    )
    mock_osrm = AsyncMock()
    mock_osrm.get_distance_matrix = AsyncMock(return_value=matrix)

    service = SessionService(mock_db, osrm=mock_osrm)
    service.get = AsyncMock(return_value=session)
    service._get_offers = AsyncMock(return_value=[offer])  # type: ignore[method-assign]
    service._recalculate_route_stops = AsyncMock()  # type: ignore[method-assign]

    stops_result = MagicMock()
    stops_result.scalars.return_value.all.side_effect = [
        [pickup, delivery],
        [pickup, delivery],
    ]
    mock_db.execute = AsyncMock(return_value=stops_result)

    with patch(
        "app.services.sessions.SequenceOptimizerService",
    ) as optimizer_cls:
        optimizer = optimizer_cls.return_value
        optimizer.optimize_and_persist = AsyncMock(return_value=[])

        result = await service._apply_offers_and_optimize_route(session_id, [offer_id])

    assert result == [pickup, delivery]
    optimizer.optimize_and_persist.assert_awaited_once()
    service._recalculate_route_stops.assert_awaited_once_with(session)


@pytest.mark.asyncio
async def test_apply_offers_empty_offer_ids_returns_empty() -> None:
    session_id = uuid4()
    session = MagicMock(id=session_id, origin_lat=52.0, origin_lon=21.0)

    mock_db = AsyncMock()
    mock_db.flush = AsyncMock()
    mock_db.execute = AsyncMock()

    service = SessionService(mock_db, osrm=AsyncMock())
    service.get = AsyncMock(return_value=session)
    service._get_offers = AsyncMock(return_value=[])  # type: ignore[method-assign]

    result = await service._apply_offers_and_optimize_route(session_id, [])
    assert result == []
