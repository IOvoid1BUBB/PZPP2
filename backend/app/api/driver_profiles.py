"""Driver profile catalog endpoints (`/api/v1/driver-profiles`)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import DriverProfile
from app.schemas.driver_profile import DriverProfileRead

router = APIRouter(prefix="/driver-profiles", tags=["driver-profiles"])


@router.get(
    "",
    response_model=list[DriverProfileRead],
    summary="List driver cost profiles",
)
async def list_driver_profiles(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[DriverProfileRead]:
    stmt = (
        select(DriverProfile)
        .order_by(DriverProfile.code)
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    return [DriverProfileRead.model_validate(row) for row in result.scalars().all()]
