"""Schemas for the :class:`app.models.MarketOffer` resource."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class GeoPoint(BaseModel):
    """WGS84 longitude/latitude pair."""

    model_config = ConfigDict(extra="forbid")

    lon: float = Field(..., ge=-180.0, le=180.0)
    lat: float = Field(..., ge=-90.0, le=90.0)


class MarketOfferCreate(BaseModel):
    """Payload for inserting a synthetic market offer."""

    model_config = ConfigDict(extra="forbid")

    pickup_point: str = Field(..., description="EWKT point, e.g. SRID=4326;POINT(lon lat)")
    delivery_point: str
    ldm: Decimal
    weight_kg: int = Field(..., gt=0)
    price_eur: Decimal = Field(..., gt=0)
    time_window_open: datetime
    time_window_close: datetime
    handling_time_minutes: int
    stackable: bool


class SimulateOffersResponse(BaseModel):
    """Result of a market simulation run."""

    model_config = ConfigDict(extra="forbid")

    requested: int
    inserted: int
    skipped: int


class OfferRead(BaseModel):
    """Outbound representation of a market offer."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    pickup: GeoPoint
    delivery: GeoPoint
    ldm: Decimal
    weight_kg: int
    price_eur: Decimal
    time_window_open: datetime | None = None
    time_window_close: datetime | None = None
    handling_time_minutes: int | None = None
    stackable: bool = True
    is_within_corridor: bool = False
