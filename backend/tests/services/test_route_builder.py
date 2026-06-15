"""Unit tests for the shared route_builder helper."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)

from geoalchemy2.shape import from_shape
from shapely.geometry import LineString, Point

from app.core.exceptions import ValidationAppError
from app.lib.routing import MultiStopRouteResult, RouteLeg
from app.services.route_builder import build_session_route


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
    stop_type: str
    offer: _Offer
    sequence_order: int
    location: Any


_COORDS = [
    (52.22, 21.01),
    (51.77, 19.45),
    (50.26, 19.01),
]

# A dense curved polyline (8 points) so each split leg keeps multiple vertices.
_CURVE = [[21.01 + i * 0.1, 52.22 - i * 0.18] for i in range(8)]

_OFFER = _Offer()
_STOPS = [
    _Stop(uuid4(), "pickup", _OFFER, 0, _loc(*_COORDS[1])),
    _Stop(uuid4(), "delivery", _OFFER, 1, _loc(*_COORDS[2])),
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
    s.id = uuid4()
    s.vehicle = _Vehicle()
    s.route_stops = list(_STOPS)
    s.origin_lat = _COORDS[0][0]
    s.origin_lon = _COORDS[0][1]
    return s


def _settings() -> MagicMock:
    settings = MagicMock()
    settings.FUEL_PRICE_EUR_PER_LITER = 1.75
    settings.WEIGHT_FUEL_FACTOR = 0.30
    return settings


@pytest.mark.asyncio
async def test_build_session_route_single_routing_call() -> None:
    """Exactly one get_route_multi call is made per build."""
    routing = AsyncMock()
    routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    build = await build_session_route(
        _mock_session(), routing=routing, settings=_settings()
    )

    routing.get_route_multi.assert_awaited_once()
    assert len(build.route.legs) == 2
    assert len(build.fuel_result.leg_costs) == 2


@pytest.mark.asyncio
async def test_build_session_route_splits_geometry_into_legs() -> None:
    """Per-leg geometries are non-empty LineStrings (curve, not a 2-point line)."""
    routing = AsyncMock()
    routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    build = await build_session_route(
        _mock_session(), routing=routing, settings=_settings()
    )

    assert len(build.leg_geoms) == 2
    for geom in build.leg_geoms:
        assert isinstance(geom, LineString)
        assert len(geom.coords) >= 3


@pytest.mark.asyncio
async def test_build_session_route_waypoints_origin_first() -> None:
    """Waypoint 0 is the origin; subsequent waypoints follow stop order."""
    routing = AsyncMock()
    routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    build = await build_session_route(
        _mock_session(), routing=routing, settings=_settings()
    )

    assert build.waypoints_lat_lon[0] == _COORDS[0]
    assert len(build.waypoints_lat_lon) == len(_STOPS) + 1


@pytest.mark.asyncio
async def test_build_session_route_no_vehicle_raises() -> None:
    routing = AsyncMock()
    session = _mock_session()
    session.vehicle = None

    with pytest.raises(ValidationAppError):
        await build_session_route(session, routing=routing, settings=_settings())


@pytest.mark.asyncio
async def test_build_session_route_no_stops_raises() -> None:
    routing = AsyncMock()
    session = _mock_session()
    session.route_stops = []

    with pytest.raises(ValidationAppError):
        await build_session_route(session, routing=routing, settings=_settings())


@pytest.mark.asyncio
async def test_build_session_route_no_origin_raises() -> None:
    routing = AsyncMock()
    session = _mock_session()
    session.origin_lat = None

    with pytest.raises(ValidationAppError):
        await build_session_route(session, routing=routing, settings=_settings())
