"""Unit tests for solver API router (no database)."""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)


@pytest.mark.asyncio
async def test_solver_post_and_delete_routes(monkeypatch: pytest.MonkeyPatch) -> None:
    """POST and DELETE /optimize delegate to VRPSolver and commit."""
    from app.core.database import get_db
    from app.lib.osrm import get_osrm_client
    from app.main import app
    from app.schemas.solver import SolverRunResult

    session_id = uuid4()
    run_id = uuid4()

    solve_result = SolverRunResult(
        session_id=session_id,
        solver_run_id=run_id,
        selected_offer_ids=[],
        objective_value=0.0,
        solver_status="OPTIMAL",
        is_optimal=True,
        solve_time_ms=42,
    )
    cancel_result = SolverRunResult(
        session_id=session_id,
        solver_run_id=run_id,
        selected_offer_ids=[],
        objective_value=0.0,
        solver_status="CANCELLED",
        is_optimal=False,
        solve_time_ms=0,
    )

    mock_solver = MagicMock()
    mock_solver.solve = AsyncMock(return_value=solve_result)
    mock_solver.cancel = AsyncMock(return_value=cancel_result)

    mock_db = AsyncMock()
    mock_db.commit = AsyncMock()

    monkeypatch.setattr(
        "app.api.solver.VRPSolver",
        lambda db, osrm=None, settings=None: mock_solver,
    )

    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_osrm_client] = lambda: AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        post_resp = await client.post(
            f"/api/v1/sessions/{session_id}/optimize",
            json={"candidate_offer_ids": []},
        )
        assert post_resp.status_code == 200
        assert post_resp.json()["solver_status"] == "OPTIMAL"
        mock_db.commit.assert_awaited()

        mock_db.commit.reset_mock()
        delete_resp = await client.delete(f"/api/v1/sessions/{session_id}/optimize")
        assert delete_resp.status_code == 200
        assert delete_resp.json()["solver_status"] == "CANCELLED"
        mock_db.commit.assert_awaited()

    app.dependency_overrides.clear()
