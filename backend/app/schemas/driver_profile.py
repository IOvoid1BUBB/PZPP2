"""Schemas for :class:`app.models.DriverProfile`."""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class DriverProfileRead(BaseModel):
    """Outbound representation of a driver cost profile."""

    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    code: str
    name: str
    hourly_cost_eur: Decimal
    idle_fuel_l_per_hour: Decimal
    stop_admin_fee_eur: Decimal
