"""Aggregated dashboard payloads."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.session import SessionStatus

DashboardNotificationType = Literal["info", "warning", "opportunity"]


class ActiveSessionSummary(BaseModel):
    """Operational row for an active consolidation session on today's dashboard."""

    model_config = ConfigDict(extra="forbid")

    session_id: UUID
    vehicle_name: str
    current_location: str
    destination: str
    lfil_pct: float = Field(..., ge=0)
    status: SessionStatus
    has_time_window_risk: bool


class DashboardNotification(BaseModel):
    """Synthetic alert for the dashboard feed."""

    model_config = ConfigDict(extra="forbid")

    id: str
    type: DashboardNotificationType
    title: str
    body: str
    link: str | None = None
    href: str | None = None


class DashboardResponse(BaseModel):
    """Single-call dashboard payload: KPIs, active sessions, and notifications."""

    model_config = ConfigDict(extra="forbid")

    today_net_profit_eur: float
    avg_lfill_pct: float
    empty_runs_pct: float
    active_sessions: list[ActiveSessionSummary]
    notifications: list[DashboardNotification]
