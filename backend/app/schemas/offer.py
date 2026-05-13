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
