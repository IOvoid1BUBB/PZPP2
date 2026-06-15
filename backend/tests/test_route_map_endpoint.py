"""Integration tests for GET /api/v1/sessions/{id}/route-map."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.lib.osrm import MultiStopRouteResult, RouteLeg

pytestmark = pytest.mark.integration


def _make_route(waypoints: list[tuple[float, float]]) -> MultiStopRouteResult:
    n = max(len(waypoints) - 1, 1)
    # Dense curved geometry (8 vertices per leg) so each split leg keeps >= 3 points.
    points_per_leg = 8
    coords: list[list[float]] = []
    for leg_idx in range(n):
        for k in range(points_per_leg):
            t = leg_idx + k / points_per_leg
            coords.append([20.0 + t * 0.5, 52.0 - t * 0.3])
    coords.append([20.0 + n * 0.5, 52.0 - n * 0.3])
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
            "coordinates": coords,
        },
    )


async def _create_session_with_stops(client: AsyncClient) -> UUID:
    from app.lib.osrm import get_osrm_client
    from app.main import app as fastapi_app

    mock_osrm = AsyncMock()
    mock_osrm.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_osrm_client] = lambda: mock_osrm

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
        fastapi_app.dependency_overrides.pop(get_osrm_client, None)


@pytest.mark.asyncio
async def test_route_map_returns_legs_and_stops(client: AsyncClient) -> None:
    session_id = await _create_session_with_stops(client)

    response = await client.get(f"/api/v1/sessions/{session_id}/route-map")
    assert response.status_code == 200
    body: dict[str, Any] = response.json()

    assert body["session_id"] == str(session_id)
    assert len(body["legs"]) >= 1
    assert len(body["stops"]) >= 2
    assert body["legs"][0]["geometry_coords"]
    # Real road geometry: each leg keeps >= 3 points (not a 2-point straight line).
    assert len(body["legs"][0]["geometry_coords"]) >= 3
    assert body["legs"][0]["weight_kg_at_leg"] > 0
    assert body["legs"][0]["distance_km"] > 0
    assert 0 <= body["legs"][0]["load_ratio"] <= 1
    assert body["total_distance_km"] > 0
    assert body["stops"][0]["address_label"]


@pytest.mark.asyncio
async def test_route_map_422_without_stops(client: AsyncClient) -> None:
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

    response = await client.get(f"/api/v1/sessions/{session_id}/route-map")
    assert response.status_code == 422
