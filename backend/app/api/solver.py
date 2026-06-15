"""VRP solver endpoint (`/api/v1/sessions/{id}/optimize`)."""

from __future__ import annotations

import asyncio
from uuid import UUID

from fastapi import APIRouter, Depends, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.exceptions import ConflictError
from app.lib.routing import RoutingProvider, get_routing_provider
from app.lib.redis_client import get_redis
from app.schemas.solver import SolverRequest, SolverRunResult, SolverStatusResponse
from app.services.solver_job import SolverJobStore
from app.services.solver_runner import run_solver_job
from app.services.vrp_solver import VRPSolver

router = APIRouter(prefix="/sessions/{session_id}/optimize", tags=["solver"])


@router.get(
    "/status",
    response_model=SolverStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Poll optimization progress and latest result",
)
async def get_optimization_status(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> SolverStatusResponse:
    solver = VRPSolver(db)
    return await solver.get_status(session_id, redis=redis)


@router.post(
    "",
    response_model=SolverStatusResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Start CP-SAT offer selection for a session",
)
async def trigger_optimization(
    session_id: UUID,
    payload: SolverRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    settings: Settings = Depends(get_settings),
) -> SolverStatusResponse:
    solver = VRPSolver(db, settings=settings)
    await solver.get_status(session_id, redis=redis)

    if await SolverJobStore.is_running(redis, session_id):
        raise ConflictError("Optimization is already running for this session.")

    await SolverJobStore.start(redis, session_id)
    asyncio.create_task(
        run_solver_job(
            session_id,
            payload,
            settings=settings,
            redis=redis,
        ),
    )
    return SolverStatusResponse(status="RUNNING", elapsed_ms=0)


@router.delete(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Cancel an in-flight VRP optimization (stub)",
)
async def cancel_optimization(session_id: UUID) -> None:
    _ = session_id
    response_model=SolverRunResult,
    status_code=status.HTTP_200_OK,
    summary="Cancel the current optimization recommendation",
)
async def cancel_optimization(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    routing: RoutingProvider = Depends(get_routing_provider),
    redis: Redis = Depends(get_redis),
    settings: Settings = Depends(get_settings),
) -> SolverRunResult:
    if await SolverJobStore.request_cancel(redis, session_id):
        job = await SolverJobStore.get(redis, session_id)
        elapsed_ms = job.elapsed_ms() if job is not None else 0
        return SolverRunResult(
            session_id=session_id,
            solver_run_id=UUID(int=0),
            selected_offer_ids=[],
            objective_value=0.0,
            solver_status="CANCELLED",
            is_optimal=False,
            solve_time_ms=elapsed_ms,
        )

    solver = VRPSolver(db, routing=routing, settings=settings)
    result = await solver.cancel(session_id)
    await db.commit()
    return result
