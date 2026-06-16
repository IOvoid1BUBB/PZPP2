"""Schemas for the :class:`app.models.MarketOffer` resource."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# ─── Static city lookup for labels ──────────────────────────────────────────
# Maps hub_key → human-readable city name (mirrors LOGISTICS_HUBS in market_simulator)
HUB_LABELS: dict[str, str] = {
    "warszawa": "Warszawa",
    "lodz": "Łódź",
    "wroclaw": "Wrocław",
    "poznan": "Poznań",
    "katowice": "Katowice",
    "gdansk": "Gdańsk",
    "berlin": "Berlin",
    "prague": "Praha",
    "vienna": "Wien",
    "hamburg": "Hamburg",
}


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
    pickup_label: str | None = None
    delivery_label: str | None = None
    shipper_company: str | None = None


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
    pickup_label: str | None = None
    delivery_label: str | None = None
    shipper_company: str | None = None


class OfferScore(BaseModel):
    """Deterministic multi-criteria score for a market offer — includes key offer fields."""

    model_config = ConfigDict(extra="forbid")

    offer_id: UUID
    total_score: float
    revenue_density_score: float
    detour_penalty_score: float
    fill_contribution_score: float
    time_window_score: float
    added_km: float
    estimated_added_cost_eur: float
    # Pola oferty — wypełniane przez scorer aby frontend nie potrzebował hash-fallbacków
    ldm: Decimal = Field(default=Decimal("0"))
    weight_kg: int = Field(default=0)
    price_eur: Decimal = Field(default=Decimal("0"))
    stackable: bool = Field(default=True)
    pickup_label: str = Field(default="")
    delivery_label: str = Field(default="")


class RankedOffersResponse(BaseModel):
    """Top-ranked offers for a consolidation session."""

    model_config = ConfigDict(extra="forbid")

    session_id: UUID
    limit: int
    scored_count: int
    offers: list[OfferScore]
