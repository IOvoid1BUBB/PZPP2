"""Unit tests for GET /api/v1/sessions/{id}/optimize/status."""

from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)


def _make_run_result(session_id: UUID, *, status: str = "OPTIMAL") -> "SolverRunResult":
    from app.schemas.solver import SolverRunResult

    return SolverRunResult(
        session_id=session_id,
        solver_run_id=uuid4(),
        selected_offer_ids=[uuid4()],
        objective_value=123.45,
        solver_status=status,  # type: ignore[arg-type]
        is_optimal=status == "OPTIMAL",
        solve_time_ms=1500,
        stop_sequence=[],
        current_offer_ids=[],
    )


def _make_status(
    session_id: UUID,
    *,
    status: str = "IDLE",
    elapsed_ms: int = 0,
    result: object | None = None,
) -> "SolverStatusResponse":
    from app.schemas.solver import SolverStatusResponse

    return SolverStatusResponse(
        status=status,  # type: ignore[arg-type]
        elapsed_ms=elapsed_ms,
        best_objective=123.45 if result else None,
        result=result,  # type: ignore[arg-type]
    )


@pytest.fixture(autouse=True)
def _clear_job_store() -> None:
    from app.services.solver_job import SolverJobStore

    SolverJobStore.clear_all_for_tests()
    yield
    SolverJobStore.clear_all_for_tests()


@pytest.mark.asyncio
async def test_get_optimize_status_idle(monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /optimize/status returns IDLE when no run exists."""
    from app.core.database import get_db
    from app.lib.redis_client import get_redis
    from app.main import app

    session_id = uuid4()
    mock_solver = MagicMock()
    mock_solver.get_status = AsyncMock(
        return_value=_make_status(session_id, status="IDLE"),
    )
    monkeypatch.setattr(
        "app.api.solver.VRPSolver",
        lambda db, osrm=None, settings=None: mock_solver,
    )

    mock_db = AsyncMock()
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_redis] = lambda: AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(f"/api/v1/sessions/{session_id}/optimize/status")

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "IDLE"
    assert data["elapsed_ms"] == 0
    assert data["result"] is None
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_get_optimize_status_running(monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /optimize/status exposes RUNNING with elapsed_ms."""
    from app.core.database import get_db
    from app.lib.redis_client import get_redis
    from app.main import app

    session_id = uuid4()
    mock_solver = MagicMock()
    mock_solver.get_status = AsyncMock(
        return_value=_make_status(session_id, status="RUNNING", elapsed_ms=2500),
    )
    monkeypatch.setattr(
        "app.api.solver.VRPSolver",
        lambda db, osrm=None, settings=None: mock_solver,
    )

    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_redis] = lambda: AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(f"/api/v1/sessions/{session_id}/optimize/status")

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "RUNNING"
    assert data["elapsed_ms"] == 2500
    assert data["result"] is None
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_get_optimize_status_completed_with_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Completed status includes the full SolverRunResult payload."""
    from app.core.database import get_db
    from app.lib.redis_client import get_redis
    from app.main import app

    session_id = uuid4()
    run_result = _make_run_result(session_id)
    mock_solver = MagicMock()
    mock_solver.get_status = AsyncMock(
        return_value=_make_status(
            session_id,
            status="OPTIMAL",
            elapsed_ms=run_result.solve_time_ms,
            result=run_result,
        ),
    )
    monkeypatch.setattr(
        "app.api.solver.VRPSolver",
        lambda db, osrm=None, settings=None: mock_solver,
    )

    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_redis] = lambda: AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(f"/api/v1/sessions/{session_id}/optimize/status")

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "OPTIMAL"
    assert data["result"] is not None
    assert data["result"]["solver_run_id"] == str(run_result.solver_run_id)
    assert data["result"]["objective_value"] == run_result.objective_value
    assert data["result"]["selected_offer_ids"] == [
        str(oid) for oid in run_result.selected_offer_ids
    ]
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_get_optimize_status_session_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Missing session surfaces as HTTP 404."""
    from app.core.database import get_db
    from app.core.exceptions import NotFoundError
    from app.lib.redis_client import get_redis
    from app.main import app

    session_id = uuid4()
    mock_solver = MagicMock()
    mock_solver.get_status = AsyncMock(
        side_effect=NotFoundError(f"Session {session_id} not found."),
    )
    monkeypatch.setattr(
        "app.api.solver.VRPSolver",
        lambda db, osrm=None, settings=None: mock_solver,
    )

    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_redis] = lambda: AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(f"/api/v1/sessions/{session_id}/optimize/status")

    assert resp.status_code == 404
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_get_optimize_status_cancelled(monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /optimize/status returns CANCELLED after DELETE while running."""
    from app.core.database import get_db
    from app.lib.redis_client import get_redis
    from app.main import app

    session_id = uuid4()
    mock_solver = MagicMock()
    mock_solver.get_status = AsyncMock(
        return_value=_make_status(session_id, status="CANCELLED", elapsed_ms=800),
    )
    monkeypatch.setattr(
        "app.api.solver.VRPSolver",
        lambda db, osrm=None, settings=None: mock_solver,
    )

    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_redis] = lambda: AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(f"/api/v1/sessions/{session_id}/optimize/status")

    assert resp.status_code == 200
    assert resp.json()["status"] == "CANCELLED"
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_post_optimize_returns_202_running(monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /optimize starts a background job and returns RUNNING."""
    from app.core.database import get_db
    from app.lib.redis_client import get_redis
    from app.main import app
    from app.services.solver_job import SolverJobStore

    session_id = uuid4()
    mock_solver = MagicMock()
    mock_solver.get_status = AsyncMock(
        return_value=_make_status(session_id, status="IDLE"),
    )
    monkeypatch.setattr(
        "app.api.solver.VRPSolver",
        lambda db, osrm=None, settings=None: mock_solver,
    )

    started: list[UUID] = []

    async def fake_run_solver_job(
        sid: UUID,
        payload: object,
        *,
        settings: object,
        redis: object,
    ) -> None:
        started.append(sid)
        await SolverJobStore.finish(redis, sid, status="OPTIMAL")  # type: ignore[arg-type]

    monkeypatch.setattr("app.api.solver.run_solver_job", fake_run_solver_job)

    mock_db = AsyncMock()
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_redis] = lambda: AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            f"/api/v1/sessions/{session_id}/optimize",
            json={"candidate_offer_ids": []},
        )

    assert resp.status_code == 202
    data = resp.json()
    assert data["status"] == "RUNNING"
    assert data["elapsed_ms"] == 0
    await asyncio.sleep(0.05)
    assert started == [session_id]
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_post_optimize_conflict_when_already_running(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Second POST while RUNNING returns HTTP 409."""
    from app.core.database import get_db
    from app.lib.redis_client import get_redis
    from app.main import app
    from app.services.solver_job import SolverJobStore

    session_id = uuid4()
    mock_solver = MagicMock()
    mock_solver.get_status = AsyncMock(
        return_value=_make_status(session_id, status="IDLE"),
    )
    monkeypatch.setattr(
        "app.api.solver.VRPSolver",
        lambda db, osrm=None, settings=None: mock_solver,
    )
    monkeypatch.setattr("app.api.solver.run_solver_job", AsyncMock())

    redis = AsyncMock()
    await SolverJobStore.start(redis, session_id)

    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_redis] = lambda: redis

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            f"/api/v1/sessions/{session_id}/optimize",
            json={"candidate_offer_ids": []},
        )

    assert resp.status_code == 409
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_long_solve_two_poll_ticks(monkeypatch: pytest.MonkeyPatch) -> None:
    """Simulated long solve: two polls see RUNNING, then a completed result."""
    from app.core.database import get_db
    from app.core.config import get_settings
    from app.lib.redis_client import get_redis
    from app.main import app
    from app.services import solver_runner
    from app.services.solver_job import SolverJobStore

    session_id = uuid4()
    run_result = _make_run_result(session_id)

    async def slow_run_solver_job(
        sid: UUID,
        payload: object,
        *,
        settings: object,
        redis: object,
    ) -> None:
        await asyncio.sleep(0.15)
        await SolverJobStore.finish(redis, sid, status="OPTIMAL", result=run_result)  # type: ignore[arg-type]

    monkeypatch.setattr("app.api.solver.run_solver_job", slow_run_solver_job)

    mock_solver = MagicMock()

    async def dynamic_get_status(sid: UUID, *, redis: object = None) -> object:
        from app.schemas.solver import SolverStatusResponse

        job = await SolverJobStore.get(redis, sid)  # type: ignore[arg-type]
        if job is not None and job.status == "RUNNING":
            return SolverStatusResponse(status="RUNNING", elapsed_ms=job.elapsed_ms())
        return SolverStatusResponse(
            status="OPTIMAL",
            elapsed_ms=run_result.solve_time_ms,
            best_objective=run_result.objective_value,
            result=run_result,
        )

    mock_solver.get_status = dynamic_get_status
    monkeypatch.setattr(
        "app.api.solver.VRPSolver",
        lambda db, osrm=None, settings=None: mock_solver,
    )

    redis = AsyncMock()
    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_redis] = lambda: redis
    get_settings.cache_clear()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        post_resp = await client.post(
            f"/api/v1/sessions/{session_id}/optimize",
            json={"candidate_offer_ids": []},
        )
        assert post_resp.status_code == 202

        poll1 = await client.get(f"/api/v1/sessions/{session_id}/optimize/status")
        assert poll1.status_code == 200
        assert poll1.json()["status"] == "RUNNING"
        assert poll1.json()["result"] is None

        await asyncio.sleep(0.05)
        poll2 = await client.get(f"/api/v1/sessions/{session_id}/optimize/status")
        assert poll2.status_code == 200
        assert poll2.json()["status"] == "RUNNING"

        await asyncio.sleep(0.2)
        poll3 = await client.get(f"/api/v1/sessions/{session_id}/optimize/status")
        assert poll3.status_code == 200
        final = poll3.json()
        assert final["status"] == "OPTIMAL"
        assert final["result"] is not None
        assert final["result"]["solver_status"] == "OPTIMAL"
        assert final["result"]["objective_value"] == run_result.objective_value

    solver_runner._solve_delay_seconds = 0.0
    get_settings.cache_clear()
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_delete_while_running_returns_cancelled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DELETE /optimize during RUNNING returns CANCELLED immediately."""
    from app.core.database import get_db
    from app.lib.redis_client import get_redis
    from app.main import app
    from app.services.solver_job import SolverJobStore

    session_id = uuid4()
    redis = AsyncMock()
    await SolverJobStore.start(redis, session_id)

    app.dependency_overrides[get_db] = lambda: AsyncMock()
    app.dependency_overrides[get_redis] = lambda: redis

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.delete(f"/api/v1/sessions/{session_id}/optimize")

    assert resp.status_code == 200
    assert resp.json()["solver_status"] == "CANCELLED"
    assert await SolverJobStore.is_cancel_requested(redis, session_id)
    app.dependency_overrides.clear()
