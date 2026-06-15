"""Schemas for GET /api/v1/sessions/{id}/route (GeoJSON geometry + load heat-map data)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class LegGeometry(BaseModel):
    """Single route leg with GeoJSON geometry and load weight for heat-map coloring."""

    model_config = ConfigDict(extra="forbid")

    leg_index: int = Field(..., ge=0, description="0-based leg index")
    from_stop_id: UUID | None = Field(
        ..., description="Source stop ID (null for origin depot)"
    )
    to_stop_id: UUID | None = Field(
        ..., description="Destination stop ID (null only if route has no stops)"
    )
    geometry_geojson: dict[str, Any] = Field(
        ..., description="GeoJSON LineString with [lon, lat] coordinates (EPSG:4326)"
    )
    distance_km: float = Field(..., ge=0)
    duration_minutes: int = Field(..., ge=0)
    weight_kg_at_leg: float = Field(..., ge=0)
    load_ratio: float = Field(..., ge=0, le=1)


class RouteGeometry(BaseModel):
    """Full route geometry for Leaflet map with per-leg load data."""

    model_config = ConfigDict(extra="forbid")

    session_id: UUID
    total_distance_km: float = Field(..., ge=0)
    total_duration_minutes: int = Field(..., ge=0)
    geometry_geojson: dict[str, Any] = Field(
        ..., description="Full route GeoJSON LineString from routing provider"
    )
    legs: list[LegGeometry]
    vehicle_max_weight_kg: int = Field(..., gt=0)
