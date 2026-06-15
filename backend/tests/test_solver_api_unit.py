"""Unit tests for solver API router (no database)."""

from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)


@pytest.fixture(autouse=True)
def _clear_job_store() -> None:
    from app.services.solver_job import SolverJobStore

    SolverJobStore.clear_all_for_tests()
    yield
    SolverJobStore.clear_all_for_tests()


@pytest.mark.asyncio
async def test_solver_post_and_delete_routes(monkeypatch: pytest.MonkeyPatch) -> None:
    """POST starts background job; DELETE /optimize delegates to VRPSolver.cancel."""
    from app.core.database import get_db
    from app.lib.routing import get_routing_provider
    from app.lib.redis_client import get_redis
    from app.main import app
    from app.schemas.solver import SolverRunResult, SolverStatusResponse
    from app.services.solver_job import SolverJobStore

    session_id = uuid4()
    run_id = uuid4()

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
    mock_solver.get_status = AsyncMock(
        return_value=SolverStatusResponse(status="IDLE", elapsed_ms=0),
    )
    mock_solver.cancel = AsyncMock(return_value=cancel_result)

    mock_db = AsyncMock()
    mock_db.commit = AsyncMock()

    async def fake_run_solver_job(
        sid: object,
        payload: object,
        *,
        settings: object,
        redis: object,
    ) -> None:
        await SolverJobStore.finish(redis, sid, status="OPTIMAL")  # type: ignore[arg-type]

    monkeypatch.setattr("app.api.solver.run_solver_job", fake_run_solver_job)
    monkeypatch.setattr(
        "app.api.solver.VRPSolver",
        lambda db, routing=None, settings=None: mock_solver,
    )

    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_routing_provider] = lambda: AsyncMock()
    app.dependency_overrides[get_redis] = lambda: AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        post_resp = await client.post(
            f"/api/v1/sessions/{session_id}/optimize",
            json={"candidate_offer_ids": []},
        )
        assert post_resp.status_code == 202
        assert post_resp.json()["status"] == "RUNNING"
        for _ in range(50):
            if not await SolverJobStore.is_running(AsyncMock(), session_id):
                break
            await asyncio.sleep(0.01)

        delete_resp = await client.delete(f"/api/v1/sessions/{session_id}/optimize")
        assert delete_resp.status_code == 200
        assert delete_resp.json()["solver_status"] == "CANCELLED"
        mock_db.commit.assert_awaited()

    app.dependency_overrides.clear()
