"""Tests for :mod:`app.lib.geo`."""

from __future__ import annotations

from app.lib.geo import haversine_km


def test_haversine_warsaw_to_berlin_approximate() -> None:
    # Warsaw (21.01, 52.22) → Berlin (13.40, 52.52), ~523 km by road; great-circle ~450–550 km
    distance = haversine_km(21.01, 52.22, 13.40, 52.52)
    assert 400 < distance < 600


def test_haversine_same_point_is_zero() -> None:
    assert haversine_km(19.0, 51.0, 19.0, 51.0) == 0.0
