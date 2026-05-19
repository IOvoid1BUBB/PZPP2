"""Vehicle catalog endpoints (`/api/v1/vehicles`)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import NotFoundError
from app.models.vehicle import Vehicle
from app.schemas.vehicle import VehicleRead

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get("", response_model=list[VehicleRead], summary="List vehicles")
async def list_vehicles(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[VehicleRead]:
    result = await db.execute(
        select(Vehicle).order_by(Vehicle.name).limit(limit).offset(offset),
    )
    return [VehicleRead.model_validate(row) for row in result.scalars().all()]


@router.get("/{vehicle_id}", response_model=VehicleRead, summary="Get one vehicle")
async def get_vehicle(vehicle_id: UUID, db: AsyncSession = Depends(get_db)) -> VehicleRead:
    result = await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
    vehicle = result.scalar_one_or_none()
    if vehicle is None:
        raise NotFoundError(f"Vehicle {vehicle_id} not found.")
    return VehicleRead.model_validate(vehicle)
