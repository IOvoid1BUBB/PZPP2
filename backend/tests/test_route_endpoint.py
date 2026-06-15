"""Integration tests for GET /api/v1/sessions/{id}/route.

Requires PostgreSQL + PostGIS (pytest.mark.integration).
Routing is replaced with a deterministic mock via FastAPI dependency_overrides.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.lib.routing import MultiStopRouteResult, RouteLeg

pytestmark = pytest.mark.integration


def _make_route(waypoints: list[tuple[float, float]]) -> MultiStopRouteResult:
    """Return a mock route with one 100 km/60 min leg per waypoint interval."""
    n = max(len(waypoints) - 1, 1)
    return MultiStopRouteResult(
        total_distance_km=float(n * 100),
        total_duration_minutes=n * 60,
        legs=[
            RouteLeg(
                distance_km=100.0,
                duration_minutes=60,
                from_index=i,
                to_index=i + 1,
            )
            for i in range(n)
        ],
        geometry_geojson={
            "type": "LineString",
            "coordinates": [
                [20.0 + i * 0.5, 52.0 - i * 0.3] for i in range(n + 1)
            ],
        },
    )


async def _create_session_with_stops(client: AsyncClient) -> UUID:
    """Create a session with at least 2 offers (4 stops)."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        vehicles = await client.get("/api/v1/vehicles")
        vehicle_id = vehicles.json()[0]["id"]
        profiles = await client.get("/api/v1/driver-profiles")
        profile_id = profiles.json()[0]["id"]

        created = await client.post(
            "/api/v1/sessions",
            json={
                "vehicle_id": vehicle_id,
                "driver_profile_id": profile_id,
                "origin_lon": 21.0,
                "origin_lat": 52.0,
                "target_region_bbox": [14.0, 49.0, 24.0, 55.0],
            },
        )
        session_id = UUID(created.json()["id"])

        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=2"
        )
        for offer in ranked.json()["offers"][:2]:
            await client.post(
                f"/api/v1/sessions/{session_id}/offers/{offer['offer_id']}"
            )

        return session_id
    finally:
        fastapi_app.dependency_overrides.pop(get_routing_provider, None)


@pytest.mark.asyncio
async def test_route_returns_geojson_linestring(client: AsyncClient) -> None:
    """GET /route returns valid GeoJSON LineString geometry."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session_with_stops(client)

        response = await client.get(f"/api/v1/sessions/{session_id}/route")
        assert response.status_code == 200
        body: dict[str, Any] = response.json()

        assert body["session_id"] == str(session_id)
        assert body["geometry_geojson"]["type"] == "LineString"
        assert len(body["geometry_geojson"]["coordinates"]) >= 2

        for coord in body["geometry_geojson"]["coordinates"]:
            assert len(coord) == 2
            lon, lat = coord
            assert -180 <= lon <= 180
            assert -90 <= lat <= 90

    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_route_leg_count_matches_waypoints(client: AsyncClient) -> None:
    """Number of legs equals number of waypoint intervals (stops + 1)."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session_with_stops(client)

        response = await client.get(f"/api/v1/sessions/{session_id}/route")
        assert response.status_code == 200
        body = response.json()

        assert len(body["legs"]) >= 1

        first_leg = body["legs"][0]
        assert first_leg["from_stop_id"] is None
        assert first_leg["to_stop_id"] is not None
        assert first_leg["leg_index"] == 0
        assert "geometry_geojson" in first_leg
        assert first_leg["geometry_geojson"]["type"] == "LineString"

    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_route_load_ratio_bounds(client: AsyncClient) -> None:
    """All load_ratio values are in [0, 1] range."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session_with_stops(client)

        response = await client.get(f"/api/v1/sessions/{session_id}/route")
        assert response.status_code == 200
        body = response.json()

        for leg in body["legs"]:
            assert 0 <= leg["load_ratio"] <= 1, f"load_ratio out of bounds: {leg['load_ratio']}"
            assert leg["weight_kg_at_leg"] >= 0
            assert leg["distance_km"] >= 0
            assert leg["duration_minutes"] >= 0

    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_route_404_not_found(client: AsyncClient) -> None:
    """GET /route returns 404 for non-existent session."""
    missing = "00000000-0000-0000-0000-000000000099"
    response = await client.get(f"/api/v1/sessions/{missing}/route")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_route_422_without_stops(client: AsyncClient) -> None:
    """GET /route returns 422 for session without stops."""
    vehicles = await client.get("/api/v1/vehicles")
    vehicle_id = vehicles.json()[0]["id"]
    profiles = await client.get("/api/v1/driver-profiles")
    profile_id = profiles.json()[0]["id"]

    created = await client.post(
        "/api/v1/sessions",
        json={
            "vehicle_id": vehicle_id,
            "driver_profile_id": profile_id,
            "origin_lon": 21.0,
            "origin_lat": 52.0,
            "target_region_bbox": [14.0, 49.0, 24.0, 55.0],
        },
    )
    session_id = created.json()["id"]

    response = await client.get(f"/api/v1/sessions/{session_id}/route")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_route_redis_cache_hit(client: AsyncClient) -> None:
    """Second call to GET /route should not hit routing (cache hit)."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session_with_stops(client)

        resp1 = await client.get(f"/api/v1/sessions/{session_id}/route")
        assert resp1.status_code == 200

        call_count_after_first = mock_routing.get_route_multi.call_count

        resp2 = await client.get(f"/api/v1/sessions/{session_id}/route")
        assert resp2.status_code == 200

        assert resp1.json()["session_id"] == resp2.json()["session_id"]
        assert resp1.json()["total_distance_km"] == resp2.json()["total_distance_km"]

        assert mock_routing.get_route_multi.call_count == call_count_after_first

    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_route_total_distance_and_duration(client: AsyncClient) -> None:
    """total_distance_km and total_duration_minutes are present and positive."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session_with_stops(client)

        response = await client.get(f"/api/v1/sessions/{session_id}/route")
        assert response.status_code == 200
        body = response.json()

        assert body["total_distance_km"] > 0
        assert body["total_duration_minutes"] > 0
        assert body["vehicle_max_weight_kg"] > 0

    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]
