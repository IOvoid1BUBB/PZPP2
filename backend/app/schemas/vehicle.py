"""Schemas for the :class:`app.models.Vehicle` resource."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

VehicleType = Literal["master_l2", "master_l3", "master_l4", "man_solo"]


class VehicleRead(BaseModel):
    """Outbound representation of a vehicle."""

    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    name: str
    type: VehicleType
    max_ldm: Decimal
    max_weight_kg: int
    trailer_length_cm: int
    trailer_width_cm: int
    fuel_per_100km_base: Decimal
    max_stops: int = Field(..., ge=0)
    payload_slots: dict[str, Any]
