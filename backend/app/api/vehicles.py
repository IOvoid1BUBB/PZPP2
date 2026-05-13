"""Vehicle catalog endpoints (`/api/v1/vehicles`)."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.schemas.vehicle import VehicleRead

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get(
    "",
    response_model=list[VehicleRead],
    summary="List vehicles (stub — DB integration pending)",
)
async def list_vehicles(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[VehicleRead]:
    # NOTE: DB-backed implementation comes in a follow-up task.
    _ = (limit, offset)
    return []
