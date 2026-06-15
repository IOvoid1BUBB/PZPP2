"""Schemas for GET /api/v1/sessions/{id}/route-map."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.offer import GeoPoint
from app.schemas.stop import StopType


class RouteMapLeg(BaseModel):
    """Single route leg with heat-map geometry and load weight."""

    model_config = ConfigDict(extra="forbid")

    leg_id: int = Field(..., ge=1, description="1-based leg index")
    weight_kg_at_leg: float = Field(..., ge=0)
    geometry_coords: list[list[float]] = Field(
        ...,
        description="Leaflet positions as [[lat, lon], ...]",
    )
    distance_km: float = Field(0.0, ge=0)
    duration_minutes: int = Field(0, ge=0)
    load_ratio: float = Field(
        0.0,
        ge=0,
        le=1,
        description="cargo weight on leg / vehicle max weight (0..1)",
    )


class RouteMapStop(BaseModel):
    """Stop enriched for map pins and timeline."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    offer_id: UUID
    stop_type: StopType
    sequence_order: int = Field(..., ge=0)
    location: GeoPoint
    eta_minutes_from_start: int | None = None
    stop_cost_eur: float | None = None
    address_label: str
    handling_time_minutes: int | None = None
    is_current: bool = False


class RouteMapResponse(BaseModel):
    """Full payload for the session route map view."""

    model_config = ConfigDict(extra="forbid")

    session_id: UUID
    origin: GeoPoint
    legs: list[RouteMapLeg]
    stops: list[RouteMapStop]
    vehicle_max_weight_kg: int = Field(..., gt=0)
    total_distance_km: float = Field(0.0, ge=0)
    total_duration_minutes: int = Field(0, ge=0)
