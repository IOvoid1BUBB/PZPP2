"""Unit tests for VRPSolver.get_status."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.core.config import Settings
from app.schemas.solver import SolverStatusResponse
from app.services.solver_job import SolverJobStore
from app.services.vrp_solver import VRPSolver


@pytest.fixture(autouse=True)
def _clear_jobs() -> None:
    SolverJobStore.clear_all_for_tests()
    yield
    SolverJobStore.clear_all_for_tests()


@pytest.mark.asyncio
async def test_vrp_solver_get_status_idle() -> None:
    session_id = uuid4()
    session = MagicMock()

    mock_db = AsyncMock()
    solver = VRPSolver(
        mock_db,
        settings=Settings(DATABASE_URL="postgresql+asyncpg://x:x@localhost/x"),
    )
    solver._load_session = AsyncMock(return_value=session)  # type: ignore[method-assign]
    solver._load_latest_result = AsyncMock(return_value=None)  # type: ignore[method-assign]

    status = await solver.get_status(session_id, redis=None)
    assert status == SolverStatusResponse(status="IDLE", elapsed_ms=0)


@pytest.mark.asyncio
async def test_vrp_solver_get_status_cancel_requested() -> None:
    session_id = uuid4()
    session = MagicMock()

    mock_db = AsyncMock()
    solver = VRPSolver(
        mock_db,
        settings=Settings(DATABASE_URL="postgresql+asyncpg://x:x@localhost/x"),
    )
    solver._load_session = AsyncMock(return_value=session)  # type: ignore[method-assign]
    await SolverJobStore.start(None, session_id)
    await SolverJobStore.request_cancel(None, session_id)

    status = await solver.get_status(session_id, redis=None)
    assert status.status == "CANCELLED"
    assert status.result is None


@pytest.mark.asyncio
async def test_vrp_solver_get_status_running() -> None:
    session_id = uuid4()
    session = MagicMock()

    mock_db = AsyncMock()
    solver = VRPSolver(
        mock_db,
        settings=Settings(DATABASE_URL="postgresql+asyncpg://x:x@localhost/x"),
    )
    solver._load_session = AsyncMock(return_value=session)  # type: ignore[method-assign]
    await SolverJobStore.start(None, session_id)

    status = await solver.get_status(session_id, redis=None)
    assert status.status == "RUNNING"
    assert status.result is None
    assert status.elapsed_ms >= 0


@pytest.mark.asyncio
async def test_vrp_solver_get_status_from_latest_result() -> None:
    session_id = uuid4()
    session = MagicMock()
    orm_result = MagicMock()
    orm_result.id = uuid4()
    orm_result.selected_offer_ids = []
    orm_result.stop_sequence_json = None
    orm_result.objective_value = 99.5
    orm_result.solver_status = "FEASIBLE"
    orm_result.solve_time_ms = 321

    from app.schemas.solver import SolverRunResult

    run_result = SolverRunResult(
        session_id=session_id,
        solver_run_id=orm_result.id,
        selected_offer_ids=[],
        objective_value=99.5,
        solver_status="FEASIBLE",
        is_optimal=False,
        solve_time_ms=321,
    )
    mock_db = AsyncMock()
    solver = VRPSolver(
        mock_db,
        settings=Settings(DATABASE_URL="postgresql+asyncpg://x:x@localhost/x"),
    )
    solver._load_session = AsyncMock(return_value=session)  # type: ignore[method-assign]
    solver._load_latest_result = AsyncMock(return_value=orm_result)  # type: ignore[method-assign]
    solver._orm_to_run_result = AsyncMock(return_value=run_result)  # type: ignore[method-assign]

    status = await solver.get_status(session_id, redis=None)
    assert status.status == "FEASIBLE"
    assert status.elapsed_ms == 321
    assert status.best_objective == 99.5
    assert status.result == run_result
