"""Geospatial helpers: haversine distances and PostGIS geometry conversions."""

from __future__ import annotations

import math
from typing import Any

from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point

from app.schemas.offer import GeoPoint

_EARTH_RADIUS_KM = 6371.0


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Great-circle distance in kilometres between two WGS84 points."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return _EARTH_RADIUS_KM * c


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
