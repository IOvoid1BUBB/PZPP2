"""Offline road toll calculator with per-leg and per-country breakdown."""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field
from shapely import Geometry
from shapely.geometry import LineString, shape

_logger = logging.getLogger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_GEOJSON_PATH = _BACKEND_ROOT / "data" / "country_boundaries.geojson"

TOLL_RATES: dict[str, dict[str, float]] = {
    "PL": {"bus": 0.18, "solo": 0.24},
    "DE": {"bus": 0.187, "solo": 0.274},
    "CZ": {"bus": 0.155, "solo": 0.210},
    "AT": {"bus": 0.165, "solo": 0.228},
    "FR": {"bus": 0.22, "solo": 0.30},
    "NL": {"bus": 0.19, "solo": 0.26},
    "BE": {"bus": 0.17, "solo": 0.23},
    "HU": {"bus": 0.12, "solo": 0.18},
}


class LegToll(BaseModel):
    """Toll breakdown for a single route leg."""

    leg_index: int
    per_country: dict[str, float] = Field(default_factory=dict)
    leg_total_eur: float


class TollBreakdown(BaseModel):
    """Aggregated toll metrics across all legs of a route."""

    per_leg: list[LegToll]
    per_country: dict[str, float] = Field(default_factory=dict)
    total_eur: float


def _toll_vehicle_class(vehicle_type: str) -> str:
    if vehicle_type in ("solo", "man_solo"):
        return "solo"
    return "bus"


@lru_cache(maxsize=1)
def load_country_geometries() -> dict[str, Geometry]:
    """Load country polygons from local GeoJSON (singleton, cached)."""
    if not _GEOJSON_PATH.is_file():
        msg = f"Country boundaries file not found: {_GEOJSON_PATH}"
        raise FileNotFoundError(msg)

    with _GEOJSON_PATH.open(encoding="utf-8") as f:
        data = json.load(f)

    geometries: dict[str, Geometry] = {}
    for feat in data["features"]:
        iso_a2 = feat["properties"].get("ISO_A2")
        if not iso_a2 or iso_a2 == "-99":
            continue
        geometries[iso_a2] = shape(feat["geometry"])
    return geometries


def calculate_leg_tolls(
    leg_geometry: LineString,
    vehicle_type: str,
    leg_index: int,
) -> LegToll:
    """Compute toll costs for one leg by intersecting with country boundaries."""
    countries = load_country_geometries()
    vehicle_class = _toll_vehicle_class(vehicle_type)
    per_country: dict[str, float] = {}

    for country_code, country_geom in countries.items():
        intersection = leg_geometry.intersection(country_geom)
        if intersection.is_empty:
            continue

        dist_km = intersection.length * 111.0
        rate = TOLL_RATES.get(country_code, {}).get(vehicle_class, 0.0)
        if rate == 0.0 and country_code not in TOLL_RATES:
            _logger.warning(
                "Brak stawki myto dla kraju: %s",
                country_code,
                extra={"country_code": country_code, "event": "toll:unknown_country"},
            )

        cost = dist_km * rate
        if cost > 0:
            per_country[country_code] = round(cost, 4)

    leg_total = round(sum(per_country.values()), 4)
    return LegToll(leg_index=leg_index, per_country=per_country, leg_total_eur=leg_total)


def calculate_route_tolls(
    leg_geometries: Sequence[LineString],
    vehicle_type: str,
) -> TollBreakdown:
    """Compute toll breakdown for all legs and aggregate per country."""
    per_leg = [
        calculate_leg_tolls(geom, vehicle_type, leg_index=i)
        for i, geom in enumerate(leg_geometries)
    ]

    per_country: dict[str, float] = {}
    for leg_toll in per_leg:
        for country_code, cost in leg_toll.per_country.items():
            per_country[country_code] = per_country.get(country_code, 0.0) + cost

    per_country = {code: round(cost, 4) for code, cost in per_country.items()}
    total_eur = round(sum(per_country.values()), 4)
    return TollBreakdown(per_leg=per_leg, per_country=per_country, total_eur=total_eur)
