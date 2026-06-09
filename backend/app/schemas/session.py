"""Schemas for the :class:`app.models.ConsolidationSession` resource."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.driver_profile import DriverProfileRead
from app.schemas.offer import OfferRead
from app.schemas.stop import StopRead
from app.schemas.vehicle import VehicleRead

SessionStatus = Literal["draft", "optimizing", "confirmed", "dispatched"]

VehicleResponse = VehicleRead
StopResponse = StopRead


class OfferInSession(OfferRead):
    """Market offer assigned to a consolidation session."""


class SessionCreate(BaseModel):
    """Payload for creating a new consolidation session."""

    model_config = ConfigDict(extra="forbid")

    vehicle_id: UUID
    driver_profile_id: UUID
    origin_lon: float = Field(ge=-180.0, le=180.0)
    origin_lat: float = Field(ge=-90.0, le=90.0)
    target_region_bbox: list[float] = Field(
        min_length=4,
        max_length=4,
        description="Bounding box [minLon, minLat, maxLon, maxLat].",
    )


class SessionCreatedResponse(BaseModel):
    """Minimal response after session creation."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    status: SessionStatus = "draft"


class SessionStatusUpdate(BaseModel):
    """Payload for atomic status transition."""

    model_config = ConfigDict(extra="forbid")

    status: SessionStatus


class SessionOffersReplace(BaseModel):
    """Replace the full set of offers assigned to a session."""

    model_config = ConfigDict(extra="forbid")

    offer_ids: list[UUID] = Field(min_length=1)


class SessionMetrics(BaseModel):
    """Aggregated capacity and profitability metrics for a session."""

    model_config = ConfigDict(extra="forbid")

    used_ldm: float
    fill_pct: float
    used_weight_kg: int
    weight_pct: float
    total_distance_km: float
    estimated_net_profit_eur: float | None
    stop_count: int
    client_count: int
    stop_costs_eur: float


class SessionFullResponse(BaseModel):
    """Full session detail including vehicle, offers, stops, and metrics."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    status: SessionStatus
    vehicle: VehicleResponse
    driver_profile: DriverProfileRead
    offers: list[OfferInSession]
    stops: list[StopResponse]
    metrics: SessionMetrics
    created_at: datetime


class SessionRead(BaseModel):
    """Lightweight outbound representation of a consolidation session."""

    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    vehicle_id: UUID | None = None
    driver_profile_id: UUID
    status: SessionStatus
    created_at: datetime
    total_revenue_eur: Decimal | None = None
    net_profit_eur: Decimal | None = None
    solver_run_id: UUID | None = None
