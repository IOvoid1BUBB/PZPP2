"""Integration tests for POST /api/v1/sessions/{id}/optimize.

Requires PostgreSQL + PostGIS (pytest.mark.integration).
"""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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
    session_id = await _create_session(client)

    await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
    ranked = await client.get(
        f"/api/v1/sessions/{session_id}/ranked-offers?limit=10"
    )
    assert ranked.status_code == 200
    offer_ids = [o["offer_id"] for o in ranked.json()["offers"][:10]]

    resp = await client.post(
        f"/api/v1/sessions/{session_id}/optimize",
        json={"candidate_offer_ids": offer_ids},
    )
    assert resp.status_code == 200

    data = resp.json()
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


@pytest.mark.asyncio
async def test_optimize_persists_solver_result(client: AsyncClient) -> None:
    """A solver_results row is created and solver_run_id is set on the session."""
    from app.core.database import get_sessionmaker
    from app.models import ConsolidationSession, SolverResult
    from sqlalchemy import select

    session_id = await _create_session(client)

    await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
    ranked = await client.get(
        f"/api/v1/sessions/{session_id}/ranked-offers?limit=10"
    )
    offer_ids = [o["offer_id"] for o in ranked.json()["offers"][:5]]

    resp = await client.post(
        f"/api/v1/sessions/{session_id}/optimize",
        json={"candidate_offer_ids": offer_ids},
    )
    assert resp.status_code == 200
    solver_run_id = resp.json()["solver_run_id"]

    async with get_sessionmaker()() as db:
        # SolverResult row exists
        sr = await db.get(SolverResult, UUID(solver_run_id))
        assert sr is not None
        assert sr.solve_time_ms is not None

        # Session.solver_run_id updated
        sess = await db.get(ConsolidationSession, session_id)
        assert sess is not None
        assert str(sess.solver_run_id) == solver_run_id


@pytest.mark.asyncio
async def test_optimize_infeasible_returns_200_empty(client: AsyncClient) -> None:
    """INFEASIBLE (max_stops=0) must return HTTP 200 with empty selected_offer_ids."""
    session_id = await _create_session(client)

    await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
    ranked = await client.get(
        f"/api/v1/sessions/{session_id}/ranked-offers?limit=5"
    )
    offer_ids = [o["offer_id"] for o in ranked.json()["offers"][:5]]

    resp = await client.post(
        f"/api/v1/sessions/{session_id}/optimize",
        json={"candidate_offer_ids": offer_ids, "max_stops": 0},
    )
    assert resp.status_code == 200
    data = resp.json()
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

    resp = await client.post(
        f"/api/v1/sessions/{session_id}/optimize",
        json={"candidate_offer_ids": []},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["selected_offer_ids"] == []
    assert data["solver_status"] == "INFEASIBLE"
