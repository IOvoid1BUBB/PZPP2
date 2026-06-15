"""Unit tests for RouteMapService (cache + curved geometry + leg metadata)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)

from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.lib.routing import MultiStopRouteResult, RouteLeg
from app.services.route_map import RouteMapService

SESSION_ID = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")


def _loc(lat: float, lon: float) -> Any:
    return from_shape(Point(lon, lat), srid=4326)


@dataclass
class _Vehicle:
    type: str = "master_l2"
    fuel_per_100km_base: float = 18.5
    max_weight_kg: int = 3500
    max_ldm: float = 6.4


@dataclass
class _Offer:
    price_eur: float = 500.0
    weight_kg: int = 400
    handling_time_minutes: int = 30


@dataclass
class _Stop:
    id: UUID
    offer_id: UUID
    stop_type: str
    offer: _Offer
    sequence_order: int
    location: Any
    eta_minutes_from_start: int | None = 45
    stop_cost_eur: float | None = 30.0
    address_label: str | None = "Test 1"


_COORDS = [(52.22, 21.01), (51.77, 19.45), (50.26, 19.01)]
_CURVE = [[21.01 + i * 0.1, 52.22 - i * 0.18] for i in range(8)]
_OFFER = _Offer()
_STOPS = [
    _Stop(uuid4(), uuid4(), "pickup", _OFFER, 0, _loc(*_COORDS[1])),
    _Stop(uuid4(), uuid4(), "delivery", _OFFER, 1, _loc(*_COORDS[2])),
]

_ROUTE = MultiStopRouteResult(
    total_distance_km=200.0,
    total_duration_minutes=120,
    legs=[
        RouteLeg(distance_km=100.0, duration_minutes=60, from_index=0, to_index=1),
        RouteLeg(distance_km=100.0, duration_minutes=60, from_index=1, to_index=2),
    ],
    geometry_geojson={"type": "LineString", "coordinates": _CURVE},
)


def _mock_session() -> MagicMock:
    s = MagicMock()
    s.id = SESSION_ID
    s.vehicle = _Vehicle()
    s.route_stops = list(_STOPS)
    s.origin_lat = _COORDS[0][0]
    s.origin_lon = _COORDS[0][1]
    return s


def _build_service(routing: AsyncMock) -> RouteMapService:
    settings = MagicMock()
    settings.FUEL_PRICE_EUR_PER_LITER = 1.75
    settings.WEIGHT_FUEL_FACTOR = 0.30
    return RouteMapService(AsyncMock(), routing=routing, settings=settings)


@pytest.mark.asyncio
async def test_route_map_geometry_not_straight_line_with_routing_mock() -> None:
    """Each leg geometry retains >= 3 points when routing returns a curve."""
    routing = AsyncMock()
    routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.setex = AsyncMock()

    service = _build_service(routing)

    with (
        patch.object(
            RouteMapService, "_load_session", new=AsyncMock(return_value=_mock_session())
        ),
        patch("app.services.route_map.get_redis", return_value=redis),
    ):
        result = await service.get_route_map(SESSION_ID)

    assert len(result.legs) == 2
    for leg in result.legs:
        assert len(leg.geometry_coords) >= 3


@pytest.mark.asyncio
async def test_route_map_legs_expose_metadata() -> None:
    """Legs carry distance_km, duration_minutes, load_ratio; totals populated."""
    routing = AsyncMock()
    routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.setex = AsyncMock()

    service = _build_service(routing)

    with (
        patch.object(
            RouteMapService, "_load_session", new=AsyncMock(return_value=_mock_session())
        ),
        patch("app.services.route_map.get_redis", return_value=redis),
    ):
        result = await service.get_route_map(SESSION_ID)

    assert result.total_distance_km == 200.0
    assert result.total_duration_minutes == 120
    for leg in result.legs:
        assert leg.distance_km > 0
        assert leg.duration_minutes > 0
        assert 0 <= leg.load_ratio <= 1


@pytest.mark.asyncio
async def test_route_map_cache_miss_writes_cache_key() -> None:
    """Cache miss calls routing once and stores under route_map:{id} for 3600s."""
    routing = AsyncMock()
    routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.setex = AsyncMock()

    service = _build_service(routing)

    with (
        patch.object(
            RouteMapService, "_load_session", new=AsyncMock(return_value=_mock_session())
        ),
        patch("app.services.route_map.get_redis", return_value=redis),
    ):
        await service.get_route_map(SESSION_ID)

    routing.get_route_multi.assert_awaited_once()
    redis.setex.assert_awaited_once()
    call_args = redis.setex.call_args
    assert call_args[0][0] == f"route_map:{SESSION_ID}"
    assert call_args[0][1] == 3600


@pytest.mark.asyncio
async def test_route_map_cache_hit_skips_routing() -> None:
    """A cached payload is returned without a routing call."""
    routing = AsyncMock()
    routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    cached = {
        "session_id": str(SESSION_ID),
        "origin": {"lat": 52.22, "lon": 21.01},
        "legs": [],
        "stops": [],
        "vehicle_max_weight_kg": 3500,
        "total_distance_km": 12.0,
        "total_duration_minutes": 30,
    }

    import json

    redis = AsyncMock()
    redis.get = AsyncMock(return_value=json.dumps(cached))
    redis.setex = AsyncMock()

    service = _build_service(routing)

    with patch("app.services.route_map.get_redis", return_value=redis):
        result = await service.get_route_map(SESSION_ID)

    assert result.total_distance_km == 12.0
    routing.get_route_multi.assert_not_called()
