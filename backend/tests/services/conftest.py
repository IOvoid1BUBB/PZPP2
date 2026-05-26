"""Shared fixtures for fuel calculator service tests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.lib.osrm import RouteLeg

FUEL_PRICE_EUR_PER_LITER = 1.75
WEIGHT_FUEL_FACTOR = 0.30


@dataclass(frozen=True)
class MockOffer:
    weight_kg: int


@dataclass(frozen=True)
class MockStop:
    stop_type: Literal["pickup", "delivery"]
    offer: MockOffer


@dataclass(frozen=True)
class MockVehicle:
    type: str
    fuel_per_100km_base: float
    max_weight_kg: int


def vehicle(
    vtype: str = "master_l2",
    *,
    fuel_per_100km_base: float = 18.5,
    max_weight_kg: int = 6000,
) -> MockVehicle:
    return MockVehicle(
        type=vtype,
        fuel_per_100km_base=fuel_per_100km_base,
        max_weight_kg=max_weight_kg,
    )


def stop(stop_type: Literal["pickup", "delivery"], weight_kg: int) -> MockStop:
    return MockStop(stop_type=stop_type, offer=MockOffer(weight_kg=weight_kg))


def leg(
    distance_km: float,
    *,
    from_index: int,
    to_index: int,
    duration_minutes: int = 30,
) -> RouteLeg:
    return RouteLeg(
        distance_km=distance_km,
        duration_minutes=duration_minutes,
        from_index=from_index,
        to_index=to_index,
    )
