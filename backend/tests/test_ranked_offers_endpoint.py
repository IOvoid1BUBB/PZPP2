"""Integration tests for GET /api/v1/sessions/{id}/ranked-offers."""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


async def _create_session(client: AsyncClient) -> UUID:
    vehicles = await client.get("/api/v1/vehicles")
    assert vehicles.status_code == 200
    vehicle_list = vehicles.json()
    assert vehicle_list, "seed vehicles required for integration tests"
    vehicle_id = vehicle_list[0]["id"]

    profiles = await client.get("/api/v1/driver-profiles")
    assert profiles.status_code == 200
    profile_id = profiles.json()[0]["id"]

    response = await client.post(
        "/api/v1/sessions",
        json={
            "vehicle_id": vehicle_id,
            "driver_profile_id": profile_id,
            "origin_lon": 21.0,
            "origin_lat": 52.0,
            "target_region_bbox": [14.0, 49.0, 24.0, 55.0],
        },
    )
    assert response.status_code == 201
    return UUID(response.json()["id"])


@pytest.mark.asyncio
async def test_ranked_offers_returns_sorted_list(client: AsyncClient) -> None:
    session_id = await _create_session(client)
    await client.post(f"/api/v1/sessions/{session_id}/simulate?count=50")

    response = await client.get(
        f"/api/v1/sessions/{session_id}/ranked-offers?limit=10",
    )
    assert response.status_code == 200
    body = response.json()
    assert body["session_id"] == str(session_id)
    assert body["limit"] == 10
    assert body["scored_count"] >= 0
    offers = body["offers"]
    assert len(offers) <= 10
    scores = [o["total_score"] for o in offers]
    assert scores == sorted(scores, reverse=True)


@pytest.mark.asyncio
async def test_ranked_offers_session_not_found(client: AsyncClient) -> None:
    missing = "00000000-0000-0000-0000-000000000099"
    response = await client.get(f"/api/v1/sessions/{missing}/ranked-offers")
    assert response.status_code == 404
