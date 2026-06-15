"""Unit tests for RouteGeometryService."""

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
from app.services.route_geometry import RouteGeometryService


def _loc(lat: float, lon: float) -> Any:
    """Build an in-memory GeoAlchemy2 WKBElement (no DB required)."""
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


SESSION_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")

_COORDS = [
    (52.22, 21.01),
    (51.77, 19.45),
    (50.26, 19.01),
]

_OFFERS = [_Offer()]

_STOPS = [
    _Stop(uuid4(), "pickup", _OFFERS[0], 0, _loc(*_COORDS[1])),
    _Stop(uuid4(), "delivery", _OFFERS[0], 1, _loc(*_COORDS[2])),
]

_ROUTE = MultiStopRouteResult(
    total_distance_km=200.0,
    total_duration_minutes=120,
    legs=[
        RouteLeg(distance_km=100.0, duration_minutes=60, from_index=0, to_index=1),
        RouteLeg(distance_km=100.0, duration_minutes=60, from_index=1, to_index=2),
    ],
    geometry_geojson={
        "type": "LineString",
        "coordinates": [[c[1], c[0]] for c in _COORDS],
    },
)


def _mock_session(session_id: UUID = SESSION_ID) -> MagicMock:
    s = MagicMock()
    s.id = session_id
    s.vehicle = _Vehicle()
    s.route_stops = list(_STOPS)
    s.origin_lat = _COORDS[0][0]
    s.origin_lon = _COORDS[0][1]
    return s


def _build_service(mock_db: AsyncMock, mock_routing: AsyncMock) -> RouteGeometryService:
    settings = MagicMock()
    settings.FUEL_PRICE_EUR_PER_LITER = 1.75
    settings.WEIGHT_FUEL_FACTOR = 0.30
    return RouteGeometryService(mock_db, routing=mock_routing, settings=settings)


@pytest.mark.asyncio
async def test_route_geometry_returns_geojson_linestring() -> None:
    """get_route_geometry returns valid GeoJSON LineString."""
    mock_db = AsyncMock()
    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock()

    service = _build_service(mock_db, mock_routing)

    with (
        patch.object(
            RouteGeometryService,
            "_load_session",
            new=AsyncMock(return_value=_mock_session()),
        ),
        patch("app.services.route_geometry.get_redis", return_value=mock_redis),
    ):
        result = await service.get_route_geometry(SESSION_ID)

    assert result.session_id == SESSION_ID
    assert result.geometry_geojson["type"] == "LineString"
    assert len(result.geometry_geojson["coordinates"]) >= 2


@pytest.mark.asyncio
async def test_route_geometry_leg_count_matches_routing() -> None:
    """Number of legs matches routing route legs."""
    mock_db = AsyncMock()
    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock()

    service = _build_service(mock_db, mock_routing)

    with (
        patch.object(
            RouteGeometryService,
            "_load_session",
            new=AsyncMock(return_value=_mock_session()),
        ),
        patch("app.services.route_geometry.get_redis", return_value=mock_redis),
    ):
        result = await service.get_route_geometry(SESSION_ID)

    assert len(result.legs) == len(_ROUTE.legs)


@pytest.mark.asyncio
async def test_route_geometry_load_ratio_in_bounds() -> None:
    """All load_ratio values are in [0, 1]."""
    mock_db = AsyncMock()
    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock()

    service = _build_service(mock_db, mock_routing)

    with (
        patch.object(
            RouteGeometryService,
            "_load_session",
            new=AsyncMock(return_value=_mock_session()),
        ),
        patch("app.services.route_geometry.get_redis", return_value=mock_redis),
    ):
        result = await service.get_route_geometry(SESSION_ID)

    for leg in result.legs:
        assert 0 <= leg.load_ratio <= 1, f"load_ratio out of bounds: {leg.load_ratio}"


@pytest.mark.asyncio
async def test_route_geometry_from_stop_id_mapping() -> None:
    """from_stop_id is None for first leg (origin), then set to previous stop ID."""
    mock_db = AsyncMock()
    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock()

    service = _build_service(mock_db, mock_routing)

    with (
        patch.object(
            RouteGeometryService,
            "_load_session",
            new=AsyncMock(return_value=_mock_session()),
        ),
        patch("app.services.route_geometry.get_redis", return_value=mock_redis),
    ):
        result = await service.get_route_geometry(SESSION_ID)

    assert result.legs[0].from_stop_id is None
    assert result.legs[0].to_stop_id == _STOPS[0].id

    if len(result.legs) > 1:
        assert result.legs[1].from_stop_id == _STOPS[0].id
        assert result.legs[1].to_stop_id == _STOPS[1].id


@pytest.mark.asyncio
async def test_route_geometry_cache_hit_skips_routing() -> None:
    """Cached response is returned without calling routing."""
    mock_db = AsyncMock()
    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    cached_response = {
        "session_id": str(SESSION_ID),
        "total_distance_km": 200.0,
        "total_duration_minutes": 120,
        "geometry_geojson": {"type": "LineString", "coordinates": [[20.0, 52.0], [21.0, 53.0]]},
        "legs": [
            {
                "leg_index": 0,
                "from_stop_id": None,
                "to_stop_id": str(uuid4()),
                "geometry_geojson": {"type": "LineString", "coordinates": [[20.0, 52.0], [21.0, 53.0]]},
                "distance_km": 200.0,
                "duration_minutes": 120,
                "weight_kg_at_leg": 3500.0,
                "load_ratio": 0.0,
            }
        ],
        "vehicle_max_weight_kg": 3500,
    }

    import json
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=json.dumps(cached_response))
    mock_redis.setex = AsyncMock()

    service = _build_service(mock_db, mock_routing)

    with patch("app.services.route_geometry.get_redis", return_value=mock_redis):
        result = await service.get_route_geometry(SESSION_ID)

    assert result.session_id == SESSION_ID
    mock_routing.get_route_multi.assert_not_called()


@pytest.mark.asyncio
async def test_route_geometry_cache_miss_calls_routing() -> None:
    """Cache miss triggers routing call and stores result."""
    mock_db = AsyncMock()
    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock()

    service = _build_service(mock_db, mock_routing)

    with (
        patch.object(
            RouteGeometryService,
            "_load_session",
            new=AsyncMock(return_value=_mock_session()),
        ),
        patch("app.services.route_geometry.get_redis", return_value=mock_redis),
    ):
        await service.get_route_geometry(SESSION_ID)

    mock_routing.get_route_multi.assert_called_once()
    mock_redis.setex.assert_called_once()
    call_args = mock_redis.setex.call_args
    assert call_args[0][0] == f"route_geom:{SESSION_ID}"
    assert call_args[0][1] == 3600


@pytest.mark.asyncio
async def test_route_geometry_not_found_raises_404() -> None:
    """Non-existent session raises NotFoundError."""
    mock_db = AsyncMock()
    mock_routing = AsyncMock()

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)

    service = RouteGeometryService(mock_db, routing=mock_routing)

    with (
        patch.object(
            RouteGeometryService,
            "_load_session",
            new=AsyncMock(return_value=None),
        ),
        patch("app.services.route_geometry.get_redis", return_value=mock_redis),
    ):
        from app.core.exceptions import NotFoundError

        with pytest.raises(NotFoundError):
            await service.get_route_geometry(SESSION_ID)


@pytest.mark.asyncio
async def test_route_geometry_no_stops_raises_422() -> None:
    """Session without stops raises ValidationAppError."""
    mock_db = AsyncMock()
    mock_routing = AsyncMock()

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)

    mock_session = _mock_session()
    mock_session.route_stops = []

    service = RouteGeometryService(mock_db, routing=mock_routing)

    with (
        patch.object(
            RouteGeometryService,
            "_load_session",
            new=AsyncMock(return_value=mock_session),
        ),
        patch("app.services.route_geometry.get_redis", return_value=mock_redis),
    ):
        from app.core.exceptions import ValidationAppError

        with pytest.raises(ValidationAppError):
            await service.get_route_geometry(SESSION_ID)


@pytest.mark.asyncio
async def test_route_geometry_weight_changes_after_stops() -> None:
    """weight_kg_at_leg increases after pickup, decreases after delivery."""
    mock_db = AsyncMock()
    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(return_value=_ROUTE)

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)
    mock_redis.setex = AsyncMock()

    service = _build_service(mock_db, mock_routing)

    with (
        patch.object(
            RouteGeometryService,
            "_load_session",
            new=AsyncMock(return_value=_mock_session()),
        ),
        patch("app.services.route_geometry.get_redis", return_value=mock_redis),
    ):
        result = await service.get_route_geometry(SESSION_ID)

    weights = [leg.weight_kg_at_leg for leg in result.legs]
    assert weights[0] < weights[1], "Weight should increase after pickup"
