"""Unit tests for per-stop operational cost calculation."""

from __future__ import annotations

import pytest

from app.services.stop_cost_calculator import StopCostRates, calculate_stop_cost

FUEL_PRICE_EUR_PER_LITER = 1.75

STANDARD_RATES = StopCostRates(
    hourly_cost_eur=18.0,
    idle_fuel_l_per_hour=2.5,
    stop_admin_fee_eur=5.0,
)

SENIOR_RATES = StopCostRates(
    hourly_cost_eur=22.0,
    idle_fuel_l_per_hour=2.5,
    stop_admin_fee_eur=5.0,
)


def test_default_30min_total_in_acceptance_range() -> None:
    breakdown = calculate_stop_cost(
        30,
        "solo",
        rates=STANDARD_RATES,
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
    )

    assert 15.5 <= breakdown.total_eur <= 17.0
    assert breakdown.handling_time_minutes == 30


def test_driver_profile_hourly_rate_affects_total() -> None:
    base = calculate_stop_cost(
        30,
        "bus_10",
        rates=STANDARD_RATES,
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
    )
    higher = calculate_stop_cost(
        30,
        "bus_10",
        rates=SENIOR_RATES,
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
    )

    assert higher.time_cost_eur > base.time_cost_eur
    assert higher.total_eur > base.total_eur


def test_15min_total_always_positive() -> None:
    breakdown = calculate_stop_cost(
        15,
        "solo",
        rates=STANDARD_RATES,
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
    )

    assert breakdown.total_eur > 0.0


def test_rates_from_driver_profile() -> None:
    class _Profile:
        hourly_cost_eur = 22.0
        idle_fuel_l_per_hour = 2.5
        stop_admin_fee_eur = 5.0

    rates = StopCostRates.from_driver_profile(_Profile())  # type: ignore[arg-type]
    assert rates.hourly_cost_eur == 22.0
    assert rates.idle_fuel_l_per_hour == 2.5
    assert rates.stop_admin_fee_eur == 5.0


def test_breakdown_components_sum() -> None:
    breakdown = calculate_stop_cost(
        30,
        "solo",
        rates=STANDARD_RATES,
        fuel_price_eur_per_liter=FUEL_PRICE_EUR_PER_LITER,
    )

    component_sum = (
        breakdown.time_cost_eur
        + breakdown.idle_fuel_cost_eur
        + breakdown.admin_flat_fee_eur
    )
    assert breakdown.total_eur == pytest.approx(component_sum, abs=0.0001)
