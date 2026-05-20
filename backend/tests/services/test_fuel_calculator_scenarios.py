"""Route-level scenarios for multi-stop fuel calculation."""

from __future__ import annotations

import pytest
from app.services.fuel_calculator import (
    TARE_WEIGHTS_KG,
    MultistopFuelResult,
    _apply_stop_cargo_delta,
    calculate_multi_stop_fuel,
)
from tests.services.conftest import (
    FUEL_PRICE_EUR_PER_LITER,
    WEIGHT_FUEL_FACTOR,
    leg,
    stop,
    vehicle,
)


def test_pickup_increases_consumption_on_next_leg() -> None:
    test_vehicle = vehicle()
    legs = [
        leg(100.0, from_index=0, to_index=1),
        leg(100.0, from_index=1, to_index=2),
    ]
    stops = [
        stop("pickup", 3000),
        stop("pickup", 1000),
    ]

    result = calculate_multi_stop_fuel(
        legs,
        stops,
        test_vehicle,  # type: ignore[arg-type]
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
        weight_fuel_factor=WEIGHT_FUEL_FACTOR,
    )

    assert result.leg_costs[0].consumption_l100km < result.leg_costs[1].consumption_l100km
    assert result.leg_costs[0].load_ratio == pytest.approx(0.0)
    assert result.leg_costs[1].load_ratio == pytest.approx(0.5)


def test_delivery_decreases_consumption_on_next_leg() -> None:
    test_vehicle = vehicle()
    legs = [
        leg(50.0, from_index=0, to_index=1),
        leg(50.0, from_index=1, to_index=2),
        leg(50.0, from_index=2, to_index=3),
    ]
    stops = [
        stop("pickup", 4000),
        stop("delivery", 4000),
        stop("pickup", 0),
    ]

    result = calculate_multi_stop_fuel(
        legs,
        stops,
        test_vehicle,  # type: ignore[arg-type]
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
        weight_fuel_factor=WEIGHT_FUEL_FACTOR,
    )

    assert result.leg_costs[0].consumption_l100km < result.leg_costs[1].consumption_l100km
    assert result.leg_costs[1].consumption_l100km > result.leg_costs[2].consumption_l100km
    assert result.leg_costs[2].load_ratio == pytest.approx(0.0)


def test_delivery_never_drives_cargo_weight_below_zero() -> None:
    test_vehicle = vehicle()
    legs = [leg(10.0, from_index=0, to_index=1)]
    stops = [stop("delivery", 5000)]

    result = calculate_multi_stop_fuel(
        legs,
        stops,
        test_vehicle,  # type: ignore[arg-type]
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
        weight_fuel_factor=WEIGHT_FUEL_FACTOR,
    )

    assert result.leg_costs[0].load_ratio == pytest.approx(0.0)
    assert _apply_stop_cargo_delta(0.0, stops[0]) == pytest.approx(0.0)  # type: ignore[arg-type]


def test_empty_leg_has_zero_liters_but_reports_consumption() -> None:
    test_vehicle = vehicle()
    legs = [leg(0.0, from_index=0, to_index=1)]
    stops = [stop("pickup", 1000)]

    result = calculate_multi_stop_fuel(
        legs,
        stops,
        test_vehicle,  # type: ignore[arg-type]
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
        weight_fuel_factor=WEIGHT_FUEL_FACTOR,
    )

    leg_result = result.leg_costs[0]
    assert leg_result.liters == pytest.approx(0.0)
    assert leg_result.cost_eur == pytest.approx(0.0)
    assert leg_result.consumption_l100km == pytest.approx(18.5)


def test_avg_consumption_matches_total_liters_over_distance() -> None:
    test_vehicle = vehicle(fuel_per_100km_base=20.0)
    legs = [
        leg(120.0, from_index=0, to_index=1),
        leg(80.0, from_index=1, to_index=2),
    ]
    stops = [
        stop("pickup", 1500),
        stop("delivery", 500),
    ]

    result = calculate_multi_stop_fuel(
        legs,
        stops,
        test_vehicle,  # type: ignore[arg-type]
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
        weight_fuel_factor=WEIGHT_FUEL_FACTOR,
    )

    total_distance = sum(route_leg.distance_km for route_leg in legs)
    expected_avg = result.total_liters / total_distance * 100.0
    assert result.avg_consumption_l100km == pytest.approx(expected_avg)


def test_deterministic_for_identical_inputs() -> None:
    test_vehicle = vehicle("solo", fuel_per_100km_base=28.0, max_weight_kg=24000)
    legs = [
        leg(200.0, from_index=0, to_index=1),
        leg(150.0, from_index=1, to_index=2),
        leg(100.0, from_index=2, to_index=3),
    ]
    stops = [
        stop("pickup", 8000),
        stop("pickup", 4000),
        stop("delivery", 12000),
    ]

    first = calculate_multi_stop_fuel(
        legs,
        stops,
        test_vehicle,  # type: ignore[arg-type]
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
        weight_fuel_factor=WEIGHT_FUEL_FACTOR,
    )
    second = calculate_multi_stop_fuel(
        legs,
        stops,
        test_vehicle,  # type: ignore[arg-type]
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
        weight_fuel_factor=WEIGHT_FUEL_FACTOR,
    )

    assert first == second


def test_weight_at_leg_includes_tare_and_heaviest_leg_index() -> None:
    test_vehicle = vehicle("bus_9")
    legs = [
        leg(10.0, from_index=0, to_index=1),
        leg(10.0, from_index=1, to_index=2),
    ]
    stops = [
        stop("pickup", 2000),
        stop("pickup", 1000),
    ]

    result = calculate_multi_stop_fuel(
        legs,
        stops,
        test_vehicle,  # type: ignore[arg-type]
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
        weight_fuel_factor=WEIGHT_FUEL_FACTOR,
    )

    tare = TARE_WEIGHTS_KG["bus_9"]
    assert result.leg_costs[0].weight_kg_at_leg == pytest.approx(tare)
    assert result.leg_costs[1].weight_kg_at_leg == pytest.approx(tare + 2000)
    assert result.heaviest_leg_index == 1


def test_tare_weights_per_vehicle_type() -> None:
    for vtype, tare in TARE_WEIGHTS_KG.items():
        test_vehicle = vehicle(vtype)
        result = calculate_multi_stop_fuel(
            [leg(1.0, from_index=0, to_index=1)],
            [stop("pickup", 0)],
            test_vehicle,  # type: ignore[arg-type]
            fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
            weight_fuel_factor=WEIGHT_FUEL_FACTOR,
        )
        assert result.leg_costs[0].weight_kg_at_leg == pytest.approx(float(tare))


def test_no_legs_returns_empty_result() -> None:
    test_vehicle = vehicle()
    result = calculate_multi_stop_fuel(
        [],
        [],
        test_vehicle,  # type: ignore[arg-type]
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
        weight_fuel_factor=WEIGHT_FUEL_FACTOR,
    )

    assert result == MultistopFuelResult(
        leg_costs=[],
        total_liters=0.0,
        total_cost_eur=0.0,
        avg_consumption_l100km=0.0,
        heaviest_leg_index=None,
    )
