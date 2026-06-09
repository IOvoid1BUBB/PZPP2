"""Background execution of VRP solver jobs."""

from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from app.core.config import Settings
from app.core.database import get_sessionmaker
from app.lib.osrm import get_osrm_client
from app.schemas.solver import SolverRequest
from app.services.solver_job import SolverJobStore
from app.services.vrp_solver import VRPSolver

_logger = logging.getLogger(__name__)

# Test hook: inject an artificial delay before solve (monkeypatched in tests).
_solve_delay_seconds: float = 0.0


async def run_solver_job(
    session_id: UUID,
    payload: SolverRequest,
    *,
    settings: Settings,
    redis: object | None,
) -> None:
    """Execute a solver job in the background and persist the outcome."""
    if _solve_delay_seconds > 0:
        await asyncio.sleep(_solve_delay_seconds)

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as db:
        osrm = get_osrm_client()
        solver = VRPSolver(db, osrm=osrm, settings=settings)
        try:
            if await SolverJobStore.is_cancel_requested(redis, session_id):  # type: ignore[arg-type]
                result = await solver.cancel(session_id)
                await db.commit()
                await SolverJobStore.finish(
                    redis,  # type: ignore[arg-type]
                    session_id,
                    status="CANCELLED",
                    result=result,
                )
                return

            result = await solver.solve(
                session_id=session_id,
                candidate_offer_ids=payload.candidate_offer_ids,
                max_stops_override=payload.max_stops,
                time_limit_seconds=payload.time_limit_seconds,
            )

            if await SolverJobStore.is_cancel_requested(redis, session_id):  # type: ignore[arg-type]
                result = await solver.cancel(session_id)
                await db.commit()
                await SolverJobStore.finish(
                    redis,  # type: ignore[arg-type]
                    session_id,
                    status="CANCELLED",
                    result=result,
                )
                return

            await db.commit()
            await SolverJobStore.update_best_objective(
                redis,  # type: ignore[arg-type]
                session_id,
                result.objective_value,
            )
            await SolverJobStore.finish(
                redis,  # type: ignore[arg-type]
                session_id,
                status=result.solver_status,
                result=result,
            )
        except Exception:
            await db.rollback()
            await SolverJobStore.finish(
                redis,  # type: ignore[arg-type]
                session_id,
                status="UNKNOWN",
            )
            _logger.exception(
                "solver job failed",
                extra={"event": "solver:job_failed", "session_id": str(session_id)},
            )
            raise
