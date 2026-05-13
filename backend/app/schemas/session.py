"""Schemas for the :class:`app.models.ConsolidationSession` resource."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

SessionStatus = Literal["draft", "optimizing", "confirmed", "dispatched"]


class SessionBase(BaseModel):
    """Shared session attributes."""

    model_config = ConfigDict(extra="forbid")

    vehicle_id: UUID | None = Field(
        default=None,
        description="Assigned vehicle (None while session is still being composed).",
    )
    status: SessionStatus = Field(default="draft")


class SessionCreate(SessionBase):
    """Payload for creating a new consolidation session."""


class SessionUpdate(BaseModel):
    """Partial update payload — every field is optional."""

    model_config = ConfigDict(extra="forbid")

    vehicle_id: UUID | None = None
    status: SessionStatus | None = None


class SessionRead(SessionBase):
    """Outbound representation of a consolidation session."""

    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    created_at: datetime
    total_revenue_eur: Decimal | None = None
    net_profit_eur: Decimal | None = None
    solver_run_id: UUID | None = None
