"""Geometry helpers for PostGIS / GeoAlchemy2 ↔ API coordinates."""

from __future__ import annotations

from typing import Any

from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point

from app.schemas.offer import GeoPoint


def point_from_lon_lat(lon: float, lat: float) -> Any:
    """Build a WGS84 POINT geometry from longitude/latitude."""
    return from_shape(Point(lon, lat), srid=4326)


def geo_point_from_geometry(geometry: Any) -> GeoPoint:
    """Extract ``GeoPoint`` from a GeoAlchemy2 geometry column."""
    shape = to_shape(geometry)
    return GeoPoint(lon=float(shape.x), lat=float(shape.y))


def lat_lon_from_geometry(geometry: Any) -> tuple[float, float]:
    """Return ``(lat, lon)`` for OSRM clients that expect lat-first tuples."""
    shape = to_shape(geometry)
    return float(shape.y), float(shape.x)
