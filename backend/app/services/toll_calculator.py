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

# Fallback rate for countries absent from TOLL_RATES (single source of truth).
DEFAULT_TOLL_RATE_EUR_PER_KM = 0.05


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
        country_rates = TOLL_RATES.get(country_code)
        if country_rates is None:
            _logger.warning(
                "Brak stawki myto dla kraju: %s (fallback %.3f EUR/km)",
                country_code,
                DEFAULT_TOLL_RATE_EUR_PER_KM,
                extra={"country_code": country_code, "event": "toll:unknown_country"},
            )
            rate = DEFAULT_TOLL_RATE_EUR_PER_KM
        else:
            rate = country_rates.get(vehicle_class, DEFAULT_TOLL_RATE_EUR_PER_KM)

        cost = dist_km * rate
        if cost > 0:
            per_country[country_code] = round(cost, 4)

    leg_total = round(sum(per_country.values()), 4)
    return LegToll(leg_index=leg_index, per_country=per_country, leg_total_eur=leg_total)


def _parse_route_linestring(route_geometry: dict[str, object]) -> LineString | None:
    """Convert a GeoJSON geometry dict into a LineString, or None when invalid."""
    if not route_geometry:
        return None
    try:
        geom = shape(route_geometry)
    except (TypeError, ValueError, KeyError):
        return None
    if not isinstance(geom, LineString) or geom.is_empty:
        return None
    return geom


def _per_country_km_from_line(route_line: LineString) -> dict[str, float]:
    """Return approximate kilometres driven inside each intersected country."""
    countries = load_country_geometries()
    per_country: dict[str, float] = {}
    for country_code, country_geom in countries.items():
        intersection = route_line.intersection(country_geom)
        if intersection.is_empty:
            continue
        per_country[country_code] = intersection.length * 111.0
    return per_country


def estimate_toll_eur(
    route_geometry: dict[str, object],
    vehicle_type: str,
    total_distance_km: float,
) -> tuple[float, bool]:
    """Estimate total toll cost from route geometry and country boundaries.

    Uses the single source of truth :data:`TOLL_RATES` (per-country, per
    vehicle-class), falling back to :data:`DEFAULT_TOLL_RATE_EUR_PER_KM` for
    countries without an explicit rate.

    Returns ``(toll_eur, is_estimated)``. On empty or invalid geometry the
    function falls back to ``(0.0, True)`` without raising.
    """
    route_line = _parse_route_linestring(route_geometry)
    if route_line is None:
        return 0.0, True

    vehicle_class = _toll_vehicle_class(vehicle_type)
    per_country_km = _per_country_km_from_line(route_line)
    geometry_total_km = sum(per_country_km.values())
    if geometry_total_km <= 0.0:
        return 0.0, True

    scale = total_distance_km / geometry_total_km if total_distance_km > 0.0 else 1.0
    toll_total = 0.0
    for country_code, km in per_country_km.items():
        rate = TOLL_RATES.get(country_code, {}).get(
            vehicle_class,
            DEFAULT_TOLL_RATE_EUR_PER_KM,
        )
        toll_total += km * scale * rate

    return round(toll_total, 4), True


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
