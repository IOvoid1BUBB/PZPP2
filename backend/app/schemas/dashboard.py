"""Aggregated dashboard payloads."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.session import SessionStatus


class DashboardKpi(BaseModel):
    """Top-level operational KPIs."""

    model_config = ConfigDict(extra="forbid")

    active_sessions: int = Field(..., ge=0)
    total_sessions: int = Field(..., ge=0)
    total_estimated_profit_eur: float
    average_fill_pct: float
    market_offers_count: int = Field(..., ge=0)


class DashboardSessionSummary(BaseModel):
    """Lightweight row for recent sessions list."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    status: SessionStatus
    created_at: datetime
    vehicle_name: str | None = None
    stop_count: int = Field(..., ge=0)
    offer_count: int = Field(..., ge=0)
    estimated_net_profit_eur: float | None = None


class DashboardResponse(BaseModel):
    """Aggregated dashboard data for the analytics UI."""

    model_config = ConfigDict(extra="forbid")

    kpis: DashboardKpi
    recent_sessions: list[DashboardSessionSummary]
