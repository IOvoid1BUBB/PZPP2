"""Ephemeral solver job state for optimize status polling.

Active (RUNNING) jobs are kept in-process and mirrored to Redis when available.
Terminal outcomes are persisted in ``solver_results`` and read from the database.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from uuid import UUID

if TYPE_CHECKING:
    from redis.asyncio import Redis

    from app.schemas.solver import SolverRunResult

_REDIS_KEY_PREFIX = "solver:job:"
_REDIS_TTL_SECONDS = 3600


@dataclass
class SolverJobRecord:
    """In-flight or recently finished solver job metadata."""

    session_id: UUID
    status: str = "RUNNING"
    started_at_mono: float = field(default_factory=time.monotonic)
    best_objective: float | None = None
    cancel_requested: bool = False
    result: SolverRunResult | None = None

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.started_at_mono) * 1000)

    def to_redis_dict(self) -> dict[str, Any]:
        return {
            "session_id": str(self.session_id),
            "status": self.status,
            "started_at_mono": self.started_at_mono,
            "best_objective": self.best_objective,
            "cancel_requested": self.cancel_requested,
        }

    @classmethod
    def from_redis_dict(cls, data: dict[str, Any]) -> SolverJobRecord:
        return cls(
            session_id=UUID(str(data["session_id"])),
            status=str(data.get("status", "RUNNING")),
            started_at_mono=float(data.get("started_at_mono", time.monotonic())),
            best_objective=data.get("best_objective"),
            cancel_requested=bool(data.get("cancel_requested", False)),
        )


class SolverJobStore:
    """Process-local job registry with optional Redis mirroring."""

    _memory: dict[UUID, SolverJobRecord] = {}

    @classmethod
    def _redis_key(cls, session_id: UUID) -> str:
        return f"{_REDIS_KEY_PREFIX}{session_id}"

    @classmethod
    async def _read_redis(cls, redis: Redis | None, session_id: UUID) -> SolverJobRecord | None:
        if redis is None:
            return None
        try:
            raw = await redis.get(cls._redis_key(session_id))
        except Exception:  # noqa: BLE001 — degrade to in-memory only
            return None
        if not raw or not isinstance(raw, (str, bytes, bytearray)):
            return None
        return SolverJobRecord.from_redis_dict(json.loads(raw))

    @classmethod
    async def _write_redis(cls, redis: Redis | None, record: SolverJobRecord) -> None:
        if redis is None:
            return
        try:
            await redis.set(
                cls._redis_key(record.session_id),
                json.dumps(record.to_redis_dict()),
                ex=_REDIS_TTL_SECONDS,
            )
        except Exception:  # noqa: BLE001
            return

    @classmethod
    async def _delete_redis(cls, redis: Redis | None, session_id: UUID) -> None:
        if redis is None:
            return
        try:
            await redis.delete(cls._redis_key(session_id))
        except Exception:  # noqa: BLE001
            return

    @classmethod
    async def get(cls, redis: Redis | None, session_id: UUID) -> SolverJobRecord | None:
        record = cls._memory.get(session_id)
        if record is not None:
            return record
        record = await cls._read_redis(redis, session_id)
        if record is not None:
            cls._memory[session_id] = record
        return record

    @classmethod
    async def is_running(cls, redis: Redis | None, session_id: UUID) -> bool:
        record = await cls.get(redis, session_id)
        return record is not None and record.status == "RUNNING"

    @classmethod
    async def start(cls, redis: Redis | None, session_id: UUID) -> SolverJobRecord:
        record = SolverJobRecord(session_id=session_id, status="RUNNING")
        cls._memory[session_id] = record
        await cls._write_redis(redis, record)
        return record

    @classmethod
    async def request_cancel(cls, redis: Redis | None, session_id: UUID) -> bool:
        record = await cls.get(redis, session_id)
        if record is None or record.status != "RUNNING":
            return False
        record.cancel_requested = True
        await cls._write_redis(redis, record)
        return True

    @classmethod
    async def is_cancel_requested(cls, redis: Redis | None, session_id: UUID) -> bool:
        record = await cls.get(redis, session_id)
        return record is not None and record.cancel_requested

    @classmethod
    async def update_best_objective(
        cls,
        redis: Redis | None,
        session_id: UUID,
        best_objective: float,
    ) -> None:
        record = await cls.get(redis, session_id)
        if record is None or record.status != "RUNNING":
            return
        record.best_objective = best_objective
        await cls._write_redis(redis, record)

    @classmethod
    async def finish(
        cls,
        redis: Redis | None,
        session_id: UUID,
        *,
        status: str,
        result: SolverRunResult | None = None,
    ) -> None:
        cls._memory.pop(session_id, None)
        await cls._delete_redis(redis, session_id)
        _ = status, result  # terminal state lives in solver_results

    @classmethod
    def clear_all_for_tests(cls) -> None:
        cls._memory.clear()
