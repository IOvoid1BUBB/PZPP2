"""Per-stop operational cost model (driver time, idle fuel, admin fee)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.driver_profile import DriverProfile


@dataclass(frozen=True)
class StopCostRates:
    """Stop-cost parameters sourced from the assigned driver profile."""

    hourly_cost_eur: float
    idle_fuel_l_per_hour: float
    stop_admin_fee_eur: float

    @classmethod
    def from_driver_profile(cls, profile: DriverProfile) -> StopCostRates:
        return cls(
            hourly_cost_eur=float(profile.hourly_cost_eur),
            idle_fuel_l_per_hour=float(profile.idle_fuel_l_per_hour),
            stop_admin_fee_eur=float(profile.stop_admin_fee_eur),
        )


@dataclass(frozen=True)
class StopCostBreakdown:
    """Cost components for a single loading or unloading stop."""

    time_cost_eur: float
    idle_fuel_cost_eur: float
    admin_flat_fee_eur: float
    total_eur: float
    handling_time_minutes: int


def calculate_stop_cost(
    handling_time_minutes: int,
    vehicle_type: str,
    *,
    rates: StopCostRates,
    fuel_price_eur_per_liter: float,
) -> StopCostBreakdown:
    """Estimate operational cost at a route stop.

    ``vehicle_type`` is reserved for future per-vehicle idle-fuel rates; it does
    not affect the current formula. Driver-specific rates come from
    :class:`StopCostRates` (typically built from :class:`DriverProfile`).
    """
    _ = vehicle_type

    time_cost = (handling_time_minutes / 60.0) * rates.hourly_cost_eur
    idle_fuel_liters = (handling_time_minutes / 60.0) * rates.idle_fuel_l_per_hour
    idle_fuel_cost = idle_fuel_liters * fuel_price_eur_per_liter
    admin_flat_fee = rates.stop_admin_fee_eur

    total = time_cost + idle_fuel_cost + admin_flat_fee
    return StopCostBreakdown(
        time_cost_eur=round(time_cost, 4),
        idle_fuel_cost_eur=round(idle_fuel_cost, 4),
        admin_flat_fee_eur=admin_flat_fee,
        total_eur=round(total, 4),
        handling_time_minutes=handling_time_minutes,
    )
