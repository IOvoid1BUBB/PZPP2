"""Acceptance scenario: 15 t pickup and delivery cycle."""

from __future__ import annotations

import pytest
from app.services.fuel_calculator import calculate_multi_stop_fuel
from tests.services.conftest import (
    FUEL_PRICE_EUR_PER_LITER,
    WEIGHT_FUEL_FACTOR,
    leg,
    stop,
    vehicle,
)


def test_pickup_15t_then_delivery_15t_restores_consumption_and_load_ratio() -> None:
    """15 t pickup raises consumption; 15 t delivery restores pre-pickup level."""
    test_vehicle = vehicle(max_weight_kg=24000)
    legs = [
        leg(100.0, from_index=0, to_index=1),
        leg(100.0, from_index=1, to_index=2),
        leg(100.0, from_index=2, to_index=3),
    ]
    stops = [
        stop("pickup", 15_000),
        stop("delivery", 15_000),
        stop("pickup", 0),
    ]

    result = calculate_multi_stop_fuel(
        legs,
        stops,
        test_vehicle,  # type: ignore[arg-type]
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
        weight_fuel_factor=WEIGHT_FUEL_FACTOR,
    )

    leg_before_pickup, leg_after_pickup, leg_after_delivery = result.leg_costs

    assert leg_after_pickup.consumption_l100km > leg_before_pickup.consumption_l100km
    assert leg_after_delivery.consumption_l100km == pytest.approx(
        leg_before_pickup.consumption_l100km,
    )
    assert leg_after_pickup.load_ratio == pytest.approx(15_000 / 24_000)
    assert leg_after_delivery.load_ratio == pytest.approx(0.0)
