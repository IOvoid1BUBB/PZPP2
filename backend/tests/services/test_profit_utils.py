"""Unit tests for profit_utils."""

from __future__ import annotations

from app.services.profit_utils import calculate_net_profit, estimate_fuel_cost


def test_calculate_net_profit_subtracts_fuel_and_stops() -> None:
    assert calculate_net_profit(1000.0, 260.0, 40.0) == 700.0


def test_estimate_fuel_cost_500km() -> None:
    # 500 km × 30 L/100km = 150 L × 1.75 EUR/L = 262.50
    assert estimate_fuel_cost(500.0, 30.0, 1.75) == 262.5
