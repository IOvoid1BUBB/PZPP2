"""Schemas for the :class:`app.models.RouteStop` resource."""

from __future__ import annotations

from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.offer import GeoPoint

StopType = Literal["pickup", "delivery"]


class StopRead(BaseModel):
    """Outbound representation of a single planned stop."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    session_id: UUID
    offer_id: UUID
    stop_type: StopType
    sequence_order: int = Field(..., ge=0)
    location: GeoPoint
    eta_minutes_from_start: int | None = None
    stop_cost_eur: Decimal | None = None
