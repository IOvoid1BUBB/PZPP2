"""Unit tests for fuel calculator helpers and data structures."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from app.services.fuel_calculator import (
    LegFuelCost,
    _apply_stop_cargo_delta,
    _consumption_l100km,
    calculate_multi_stop_fuel,
)
from tests.services.conftest import (
    FUEL_PRICE_EUR_PER_LITER,
    WEIGHT_FUEL_FACTOR,
    leg,
    stop,
    vehicle,
)


def test_consumption_formula_helper() -> None:
    assert _consumption_l100km(18.5, 0.0, 0.30) == pytest.approx(18.5)
    assert _consumption_l100km(18.5, 1.0, 0.30) == pytest.approx(18.5 * 1.30)


def test_unknown_vehicle_type_raises() -> None:
    test_vehicle = vehicle("invalid")
    with pytest.raises(ValueError, match="Unknown vehicle type"):
        calculate_multi_stop_fuel(
            [leg(1.0, from_index=0, to_index=1)],
            [stop("pickup", 1)],
            test_vehicle,  # type: ignore[arg-type]
            fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
            weight_fuel_factor=WEIGHT_FUEL_FACTOR,
        )


def test_invalid_stop_type_raises() -> None:
    bad_stop = SimpleNamespace(stop_type="reload", offer=SimpleNamespace(weight_kg=100))
    with pytest.raises(ValueError, match="Unsupported stop_type"):
        _apply_stop_cargo_delta(0.0, bad_stop)  # type: ignore[arg-type]


def test_leg_fuel_cost_dataclass_fields() -> None:
    leg_cost = LegFuelCost(
        leg_index=0,
        distance_km=10.0,
        weight_kg_at_leg=3500.0,
        load_ratio=0.0,
        consumption_l100km=18.5,
        liters=1.85,
        cost_eur=3.2375,
    )
    assert leg_cost.leg_index == 0
    assert leg_cost.distance_km == 10.0
