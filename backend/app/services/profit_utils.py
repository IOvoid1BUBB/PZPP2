"""Shared profit and fuel-cost calculations for sessions and dashboard."""

from __future__ import annotations


def calculate_net_profit(revenue: float, fuel_cost: float, stop_costs: float) -> float:
    """Net profit: revenue minus fuel and per-stop costs."""
    return round(revenue - fuel_cost - stop_costs, 2)


def estimate_fuel_cost(
    distance_km: float,
    fuel_per_100km: float,
    fuel_price_eur: float,
    weight_factor: float = 0.0,
) -> float:
    """Estimate fuel spend for a route leg at base consumption (optional weight uplift)."""
    consumption = fuel_per_100km * (1.0 + weight_factor)
    liters = distance_km * consumption / 100.0
    return round(liters * fuel_price_eur, 2)
