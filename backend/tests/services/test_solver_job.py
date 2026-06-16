"""Unit tests for ephemeral solver job state."""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest

from app.services.solver_job import SolverJobStore


@pytest.fixture(autouse=True)
def _clear_jobs() -> None:
    SolverJobStore.clear_all_for_tests()
    yield
    SolverJobStore.clear_all_for_tests()


@pytest.mark.asyncio
async def test_solver_job_store_running_lifecycle() -> None:
    session_id = uuid4()
    redis = None

    record = await SolverJobStore.start(redis, session_id)
    assert record.status == "RUNNING"
    assert await SolverJobStore.is_running(redis, session_id)

    await asyncio.sleep(0.01)
    loaded = await SolverJobStore.get(redis, session_id)
    assert loaded is not None
    assert loaded.elapsed_ms() >= 10

    await SolverJobStore.finish(redis, session_id, status="OPTIMAL")
    assert await SolverJobStore.get(redis, session_id) is None


@pytest.mark.asyncio
async def test_solver_job_store_cancel_request() -> None:
    session_id = uuid4()
    redis = None
    await SolverJobStore.start(redis, session_id)

    assert await SolverJobStore.request_cancel(redis, session_id)
    assert await SolverJobStore.is_cancel_requested(redis, session_id)
    assert not await SolverJobStore.request_cancel(redis, uuid4())


class _FakeRedis:
    def __init__(self) -> None:
        self._data: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self._data.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        _ = ex
        self._data[key] = value

    async def delete(self, key: str) -> None:
        self._data.pop(key, None)


@pytest.mark.asyncio
async def test_solver_job_store_redis_roundtrip() -> None:
    session_id = uuid4()
    redis = _FakeRedis()

    await SolverJobStore.start(redis, session_id)
    SolverJobStore.clear_all_for_tests()

    loaded = await SolverJobStore.get(redis, session_id)
    assert loaded is not None
    assert loaded.status == "RUNNING"

    await SolverJobStore.update_best_objective(redis, session_id, 42.5)
    SolverJobStore.clear_all_for_tests()
    updated = await SolverJobStore.get(redis, session_id)
    assert updated is not None
    assert updated.best_objective == 42.5

    await SolverJobStore.finish(redis, session_id, status="OPTIMAL")
    assert await SolverJobStore.get(redis, session_id) is None
