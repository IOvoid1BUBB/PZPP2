"""Schemas for fleet_vehicles resource."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class FleetVehicleRead(BaseModel):
    """Full fleet vehicle representation returned by GET /fleet."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    type_id: UUID
    type_key: str
    type_name: str
    registration: str
    display_name: str
    status: str
    max_ldm: Decimal
    max_weight_kg: int
    trailer_length_cm: int
    trailer_width_cm: int
    payload_slots: dict
    home_lat: Decimal | None = None
    home_lon: Decimal | None = None
    current_lat: Decimal | None = None
    current_lon: Decimal | None = None
    current_session_id: UUID | None = None
    created_at: datetime
    simulation_started_at: datetime | None = None


class FleetVehicleCreate(BaseModel):
    """Payload for POST /fleet."""

    model_config = ConfigDict(extra="forbid")

    type_id: UUID
    registration: str = Field(..., min_length=1, max_length=20)
    display_name: str = Field(..., min_length=1, max_length=100)
    home_lat: Decimal | None = Field(default=None, ge=-90, le=90)
    home_lon: Decimal | None = Field(default=None, ge=-180, le=180)


class FleetVehicleUpdate(BaseModel):
    """Payload for PUT /fleet/{id}."""

    model_config = ConfigDict(extra="forbid")

    registration: str | None = Field(default=None, min_length=1, max_length=20)
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    status: str | None = None
    home_lat: Decimal | None = None
    home_lon: Decimal | None = None
