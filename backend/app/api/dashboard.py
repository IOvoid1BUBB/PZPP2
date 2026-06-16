"""Operational dashboard endpoint (`/api/v1/dashboard`)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.dashboard import DashboardResponse
from app.services.dashboard import DashboardService

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get(
    "",
    response_model=DashboardResponse,
    summary="Aggregated KPIs and recent consolidation sessions",
)
async def get_dashboard(
    db: AsyncSession = Depends(get_db),
    recent_limit: int = Query(10, ge=1, le=50),
) -> DashboardResponse:
    return await DashboardService(db).get_dashboard(recent_limit=recent_limit)
