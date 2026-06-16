"""Schemas for GET /api/v1/sessions/{id}/route-map."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.offer import GeoPoint
from app.schemas.stop import StopType


class RouteMapLeg(BaseModel):
    """Single route leg with heat-map geometry and load weight."""

    model_config = ConfigDict(extra="forbid")

    leg_id: int = Field(..., ge=1, description="1-based leg index")
    weight_kg_at_leg: float = Field(..., ge=0)
    ldm_at_leg: float = Field(0.0, ge=0, description="loading metres on leg start")
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
        description="max(weight/max_weight, ldm/max_ldm) on leg (0..1)",
    )


class DriverRestPoint(BaseModel):
    """Geographic point where an EU 561/2006 rest/break is required."""

    model_config = ConfigDict(extra="forbid")

    lat: float = Field(..., description="latitude interpolated on leg geometry")
    lon: float = Field(..., description="longitude interpolated on leg geometry")
    rest_type: Literal["break_45", "rest_11h"] = Field(
        ...,
        description="break_45 = mandatory 45 min break after 4.5h; rest_11h = >=11h daily rest",
    )
    after_driving_minutes: int = Field(
        ..., ge=0, description="continuous/daily driving minutes when rest falls due"
    )
    leg_id: int = Field(..., ge=1, description="1-based leg index where rest falls")
    at_route_minute: int = Field(
        ..., ge=0, description="route minute (from start) when rest falls due"
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
    rest_points: list[DriverRestPoint] = Field(default_factory=list)
    vehicle_max_weight_kg: int = Field(..., gt=0)
    total_distance_km: float = Field(0.0, ge=0)
    total_duration_minutes: int = Field(0, ge=0)
