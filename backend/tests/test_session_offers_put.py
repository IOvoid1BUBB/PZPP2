"""Integration tests for PUT /api/v1/sessions/{id}/offers.

Requires PostgreSQL + PostGIS (pytest.mark.integration).
"""

from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.lib.osrm import DistanceMatrix, MultiStopRouteResult, RouteLeg

pytestmark = pytest.mark.integration


def _make_route(waypoints: list[tuple[float, float]]) -> MultiStopRouteResult:
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
            "coordinates": [[20.0 + i * 0.5, 52.0 - i * 0.3] for i in range(n + 1)],
        },
    )


def _make_matrix(locations: list[tuple[float, float]]) -> DistanceMatrix:
    n = len(locations)
    distances_km = [[100.0 if i != j else 0.0 for j in range(n)] for i in range(n)]
    durations_minutes = [[60 if i != j else 0 for j in range(n)] for i in range(n)]
    return DistanceMatrix(distances_km=distances_km, durations_minutes=durations_minutes, n=n)


def _install_osrm_mock() -> AsyncMock:
    from app.lib.osrm import get_osrm_client
    from app.main import app as fastapi_app

    mock_osrm = AsyncMock()
    mock_osrm.get_route_multi = AsyncMock(side_effect=_make_route)
    mock_osrm.get_distance_matrix = AsyncMock(side_effect=_make_matrix)
    fastapi_app.dependency_overrides[get_osrm_client] = lambda: mock_osrm
    return mock_osrm


def _clear_osrm_mock() -> None:
    from app.lib.osrm import get_osrm_client
    from app.main import app as fastapi_app

    fastapi_app.dependency_overrides.pop(get_osrm_client, None)


async def _create_session(client: AsyncClient) -> UUID:
    vehicles = await client.get("/api/v1/vehicles")
    vehicle_id = vehicles.json()[0]["id"]
    profiles = await client.get("/api/v1/driver-profiles")
    profile_id = profiles.json()[0]["id"]

    r = await client.post(
        "/api/v1/sessions",
        json={
            "vehicle_id": vehicle_id,
            "driver_profile_id": profile_id,
            "origin_lon": 21.0,
            "origin_lat": 52.0,
            "target_region_bbox": [14.0, 49.0, 24.0, 55.0],
        },
    )
    assert r.status_code == 201
    return UUID(r.json()["id"])


async def _ranked_offer_ids(client: AsyncClient, session_id: UUID, limit: int) -> list[str]:
    await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
    ranked = await client.get(
        f"/api/v1/sessions/{session_id}/ranked-offers?limit={limit}"
    )
    assert ranked.status_code == 200
    return [o["offer_id"] for o in ranked.json()["offers"][:limit]]


@pytest.mark.asyncio
async def test_put_three_offers_six_stops_ordered(client: AsyncClient) -> None:
    """PUT 3 offer_ids creates 6 stops with pickup before delivery."""
    _install_osrm_mock()
    try:
        session_id = await _create_session(client)
        offer_ids = await _ranked_offer_ids(client, session_id, 5)
        assert len(offer_ids) >= 3

        resp = await client.put(
            f"/api/v1/sessions/{session_id}/offers",
            json={"offer_ids": offer_ids[:3]},
        )
        assert resp.status_code == 200
        data = resp.json()
        stops = sorted(data["stops"], key=lambda s: s["sequence_order"])
        assert len(stops) == 6

        by_offer: dict[str, dict[str, int]] = {}
        for stop in stops:
            by_offer.setdefault(stop["offer_id"], {})[stop["stop_type"]] = stop[
                "sequence_order"
            ]
        for orders in by_offer.values():
            assert orders["pickup"] < orders["delivery"]
    finally:
        _clear_osrm_mock()


@pytest.mark.asyncio
async def test_put_exceeds_ldm_returns_409_with_free_ldm(client: AsyncClient) -> None:
    """Total LDM over vehicle capacity returns 409 with free_ldm context."""
    _install_osrm_mock()
    try:
        session_id = await _create_session(client)
        offer_ids = await _ranked_offer_ids(client, session_id, 20)
        assert len(offer_ids) >= 5

        resp = await client.put(
            f"/api/v1/sessions/{session_id}/offers",
            json={"offer_ids": offer_ids},
        )
        assert resp.status_code == 409
        body = resp.json()
        assert body.get("error") == "insufficient_ldm"
        assert "free_ldm" in body
    finally:
        _clear_osrm_mock()


@pytest.mark.asyncio
async def test_put_rollback_on_osrm_failure(client: AsyncClient) -> None:
    """OSRM failure during replace rolls back — no orphan route_stops."""
    from app.lib.osrm import get_osrm_client
    from app.main import app as fastapi_app

    mock_osrm = AsyncMock()
    mock_osrm.get_distance_matrix = AsyncMock(side_effect=RuntimeError("OSRM down"))
    mock_osrm.get_route_multi = AsyncMock(side_effect=RuntimeError("OSRM down"))
    fastapi_app.dependency_overrides[get_osrm_client] = lambda: mock_osrm

    try:
        session_id = await _create_session(client)
        offer_ids = await _ranked_offer_ids(client, session_id, 2)

        resp = await client.put(
            f"/api/v1/sessions/{session_id}/offers",
            json={"offer_ids": offer_ids[:2]},
        )
        assert resp.status_code == 500

        session_resp = await client.get(f"/api/v1/sessions/{session_id}")
        assert session_resp.status_code == 200
        assert len(session_resp.json()["stops"]) == 0
    finally:
        _clear_osrm_mock()


@pytest.mark.asyncio
async def test_put_not_found_session(client: AsyncClient) -> None:
    """Unknown session returns 404."""
    _install_osrm_mock()
    try:
        missing = "00000000-0000-0000-0000-000000000099"
        resp = await client.put(
            f"/api/v1/sessions/{missing}/offers",
            json={"offer_ids": ["00000000-0000-0000-0000-000000000001"]},
        )
        assert resp.status_code == 404
    finally:
        _clear_osrm_mock()


@pytest.mark.asyncio
async def test_put_empty_offer_ids_returns_422(client: AsyncClient) -> None:
    """Empty offer_ids list is rejected with 422."""
    _install_osrm_mock()
    try:
        session_id = await _create_session(client)
        resp = await client.put(
            f"/api/v1/sessions/{session_id}/offers",
            json={"offer_ids": []},
        )
        assert resp.status_code == 422
    finally:
        _clear_osrm_mock()
