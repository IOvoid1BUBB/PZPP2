"""Integration tests for POST /api/v1/sessions/{id}/optimize.

Requires PostgreSQL + PostGIS (pytest.mark.integration).
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.lib.osrm import DistanceMatrix, MultiStopRouteResult, RouteLeg

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


async def _wait_for_optimize(
    client: AsyncClient,
    session_id: UUID,
    *,
    timeout_seconds: float = 30.0,
) -> dict[str, object]:
    """Poll GET /optimize/status until the background job finishes."""
    deadline = asyncio.get_event_loop().time() + timeout_seconds
    while asyncio.get_event_loop().time() < deadline:
        status_resp = await client.get(
            f"/api/v1/sessions/{session_id}/optimize/status",
        )
        assert status_resp.status_code == 200
        payload = status_resp.json()
        if payload["status"] != "RUNNING":
            result = payload.get("result")
            if result is not None:
                return result
            return payload
        await asyncio.sleep(0.2)
    raise AssertionError("optimize did not finish before timeout")


async def _run_optimize(
    client: AsyncClient,
    session_id: UUID,
    payload: dict[str, object],
) -> dict[str, object]:
    """Start optimize (202) and wait for the terminal SolverRunResult."""
    resp = await client.post(
        f"/api/v1/sessions/{session_id}/optimize",
        json=payload,
    )
    assert resp.status_code == 202
    assert resp.json()["status"] == "RUNNING"
    return await _wait_for_optimize(client, session_id)


async def _create_session(client: AsyncClient) -> UUID:
    vehicles = await client.get("/api/v1/vehicles")
    assert vehicles.status_code == 200
    vehicle_id = vehicles.json()[0]["id"]

    profiles = await client.get("/api/v1/driver-profiles")
    assert profiles.status_code == 200
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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_optimize_returns_result_fields(client: AsyncClient) -> None:
    """POST /optimize returns all required SolverRunResult fields."""
    _install_osrm_mock()
    try:
        session_id = await _create_session(client)

        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=10"
        )
        assert ranked.status_code == 200
        offer_ids = [o["offer_id"] for o in ranked.json()["offers"][:10]]

        data = await _run_optimize(
            client,
            session_id,
            {"candidate_offer_ids": offer_ids},
        )
        assert "selected_offer_ids" in data
        assert "objective_value" in data
        assert "solver_status" in data
        assert "is_optimal" in data
        assert "solve_time_ms" in data
        assert "session_id" in data
        assert "solver_run_id" in data

        assert data["solver_status"] in ("OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN")
        assert data["solve_time_ms"] >= 0

        # objective_value has at most 2 decimal places
        obj = data["objective_value"]
        assert obj == round(obj, 2)
    finally:
        _clear_osrm_mock()


@pytest.mark.asyncio
async def test_optimize_persists_solver_result(client: AsyncClient) -> None:
    """A solver_results row is created and solver_run_id is set on the session."""
    from app.core.database import get_sessionmaker
    from app.models import ConsolidationSession, SolverResult

    _install_osrm_mock()
    try:
        session_id = await _create_session(client)

        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=10"
        )
        offer_ids = [o["offer_id"] for o in ranked.json()["offers"][:5]]

        data = await _run_optimize(
            client,
            session_id,
            {"candidate_offer_ids": offer_ids},
        )
        solver_run_id = data["solver_run_id"]

        async with get_sessionmaker()() as db:
            sr = await db.get(SolverResult, UUID(solver_run_id))
            assert sr is not None
            assert sr.solve_time_ms is not None

            sess = await db.get(ConsolidationSession, session_id)
            assert sess is not None
            assert str(sess.solver_run_id) == solver_run_id
    finally:
        _clear_osrm_mock()


@pytest.mark.asyncio
async def test_optimize_infeasible_returns_200_empty(client: AsyncClient) -> None:
    """INFEASIBLE (max_stops=0) must return HTTP 200 with empty selected_offer_ids."""
    session_id = await _create_session(client)

    await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
    ranked = await client.get(
        f"/api/v1/sessions/{session_id}/ranked-offers?limit=5"
    )
    offer_ids = [o["offer_id"] for o in ranked.json()["offers"][:5]]

    data = await _run_optimize(
        client,
        session_id,
        {"candidate_offer_ids": offer_ids, "max_stops": 0},
    )
    assert data["selected_offer_ids"] == []
    assert data["solver_status"] in ("INFEASIBLE", "OPTIMAL", "FEASIBLE", "UNKNOWN")


@pytest.mark.asyncio
async def test_optimize_session_not_found(client: AsyncClient) -> None:
    missing = "00000000-0000-0000-0000-000000000099"
    resp = await client.post(
        f"/api/v1/sessions/{missing}/optimize",
        json={"candidate_offer_ids": []},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_optimize_empty_candidates_infeasible(client: AsyncClient) -> None:
    """Empty candidate list should result in an INFEASIBLE response."""
    session_id = await _create_session(client)

    data = await _run_optimize(
        client,
        session_id,
        {"candidate_offer_ids": []},
    )
    assert data["selected_offer_ids"] == []
    assert data["solver_status"] == "INFEASIBLE"


@pytest.mark.asyncio
async def test_optimize_returns_stop_sequence(client: AsyncClient) -> None:
    """Successful optimize returns stop_sequence with required fields."""
    _install_osrm_mock()
    try:
        session_id = await _create_session(client)
        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=10"
        )
        offer_ids = [o["offer_id"] for o in ranked.json()["offers"][:10]]

        data = await _run_optimize(
            client,
            session_id,
            {"candidate_offer_ids": offer_ids},
        )
        assert "stop_sequence" in data
        if data["selected_offer_ids"]:
            assert len(data["stop_sequence"]) == 2 * len(data["selected_offer_ids"])
            for entry in data["stop_sequence"]:
                assert "route_stop_id" in entry
                assert "offer_id" in entry
                assert entry["stop_type"] in ("pickup", "delivery")
                assert "sequence_order" in entry
    finally:
        _clear_osrm_mock()


@pytest.mark.asyncio
async def test_optimize_updates_route_stops_count(client: AsyncClient) -> None:
    """After successful optimize, session has 2 stops per selected offer."""
    _install_osrm_mock()
    try:
        session_id = await _create_session(client)
        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=10"
        )
        offer_ids = [o["offer_id"] for o in ranked.json()["offers"][:10]]

        data = await _run_optimize(
            client,
            session_id,
            {"candidate_offer_ids": offer_ids},
        )
        selected = data["selected_offer_ids"]
        if not selected:
            pytest.skip("solver returned no selection")

        session_resp = await client.get(f"/api/v1/sessions/{session_id}")
        stops = session_resp.json()["stops"]
        assert len(stops) == 2 * len(selected)
        offer_types = {(s["offer_id"], s["stop_type"]) for s in stops}
        assert len(offer_types) == len(stops)
    finally:
        _clear_osrm_mock()


@pytest.mark.asyncio
async def test_optimize_mock_solver_three_offers(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """USE_SOLVER_MOCK selects first 3 offers with solve_time_ms=42."""
    from app.core.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("USE_SOLVER_MOCK", "true")

    _install_osrm_mock()
    try:
        session_id = await _create_session(client)
        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=10"
        )
        offer_ids = [o["offer_id"] for o in ranked.json()["offers"][:10]]

        data = await _run_optimize(
            client,
            session_id,
            {"candidate_offer_ids": offer_ids},
        )
        assert data["solver_status"] == "OPTIMAL"
        assert data["is_optimal"] is True
        assert data["solve_time_ms"] == 42
        assert len(data["selected_offer_ids"]) == 3
        assert data["selected_offer_ids"] == offer_ids[:3]
    finally:
        _clear_osrm_mock()
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_optimize_current_offer_ids_for_diff(client: AsyncClient) -> None:
    """current_offer_ids reflects session offers before apply."""
    _install_osrm_mock()
    try:
        session_id = await _create_session(client)
        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=5"
        )
        offers = ranked.json()["offers"][:2]
        for offer in offers:
            await client.post(
                f"/api/v1/sessions/{session_id}/offers/{offer['offer_id']}"
            )
        before_ids = [o["offer_id"] for o in offers]

        all_ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=10"
        )
        candidate_ids = [o["offer_id"] for o in all_ranked.json()["offers"][:10]]

        data = await _run_optimize(
            client,
            session_id,
            {"candidate_offer_ids": candidate_ids},
        )
        assert data["current_offer_ids"] == before_ids
    finally:
        _clear_osrm_mock()


@pytest.mark.asyncio
async def test_delete_optimize_cancelled(client: AsyncClient) -> None:
    """DELETE /optimize marks the latest run as CANCELLED."""
    _install_osrm_mock()
    try:
        session_id = await _create_session(client)
        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=5"
        )
        offer_ids = [o["offer_id"] for o in ranked.json()["offers"][:5]]

        await _run_optimize(
            client,
            session_id,
            {"candidate_offer_ids": offer_ids},
        )

        resp = await client.delete(f"/api/v1/sessions/{session_id}/optimize")
        assert resp.status_code == 200
        data = resp.json()
        assert data["solver_status"] == "CANCELLED"
        assert data["status"] == "CANCELLED"

        status_resp = await client.get(
            f"/api/v1/sessions/{session_id}/optimize/status",
        )
        assert status_resp.status_code == 200
        status_data = status_resp.json()
        assert status_data["status"] == "CANCELLED"
        assert status_data["result"] is not None
        assert status_data["result"]["solver_status"] == "CANCELLED"
    finally:
        _clear_osrm_mock()
