"""Multi-stop fuel cost model with per-leg load-dependent consumption."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.lib.routing import RouteLeg

if TYPE_CHECKING:
    from app.models.stop import RouteStop
    from app.models.vehicle import Vehicle

TARE_WEIGHTS_KG: dict[str, int] = {
    "master_l2": 3500,
    "master_l3": 3600,
    "master_l4": 3800,
    "man_solo": 8000,
}


@dataclass(frozen=True)
class LegFuelCost:
    """Fuel cost breakdown for a single route leg."""

    leg_index: int
    distance_km: float
    weight_kg_at_leg: float
    load_ratio: float
    consumption_l100km: float
    liters: float
    cost_eur: float
    ldm_at_leg: float = 0.0


@dataclass(frozen=True)
class MultistopFuelResult:
    """Aggregated fuel metrics across all legs of a multi-stop route."""

    leg_costs: list[LegFuelCost]
    total_liters: float
    total_cost_eur: float
    avg_consumption_l100km: float
    heaviest_leg_index: int | None


def _tare_weight_kg(vehicle_type: str) -> int:
    try:
        return TARE_WEIGHTS_KG[vehicle_type]
    except KeyError as exc:
        msg = f"Unknown vehicle type for tare weight: {vehicle_type!r}"
        raise ValueError(msg) from exc


def _consumption_l100km(
    fuel_per_100km_base: float,
    load_ratio: float,
    weight_fuel_factor: float,
) -> float:
    return fuel_per_100km_base * (1.0 + load_ratio * weight_fuel_factor)


def _apply_stop_cargo_delta(current_cargo_kg: float, stop: RouteStop) -> float:
    weight = float(stop.offer.weight_kg)
    if stop.stop_type == "pickup":
        return current_cargo_kg + weight
    if stop.stop_type == "delivery":
        return max(0.0, current_cargo_kg - weight)
    msg = f"Unsupported stop_type: {stop.stop_type!r}"
    raise ValueError(msg)


def _apply_stop_ldm_delta(current_ldm: float, stop: RouteStop) -> float:
    ldm = float(stop.offer.ldm)
    if stop.stop_type == "pickup":
        return current_ldm + ldm
    if stop.stop_type == "delivery":
        return max(0.0, current_ldm - ldm)
    msg = f"Unsupported stop_type: {stop.stop_type!r}"
    raise ValueError(msg)


def calculate_multi_stop_fuel(
    legs: Sequence[RouteLeg],
    stops: Sequence[RouteStop],
    vehicle: Vehicle,
    *,
    fuel_price_eur_per_liter: float,
    weight_fuel_factor: float,
) -> MultistopFuelResult:
    """Compute per-leg fuel usage with cargo weight accumulated at each stop.

    Waypoint index ``0`` is the route origin (depot). Each leg's ``to_index``
    maps to ``stops[to_index - 1]`` when ``to_index >= 1``. Consumption on a
    leg uses the cargo weight *before* the destination stop is processed.
    """
    tare_kg = float(_tare_weight_kg(vehicle.type))
    base_consumption = float(vehicle.fuel_per_100km_base)
    max_weight = float(vehicle.max_weight_kg)

    current_cargo_kg = 0.0
    current_ldm = 0.0
    leg_costs: list[LegFuelCost] = []
    total_liters = 0.0
    total_cost_eur = 0.0
    total_distance_km = 0.0
    heaviest_weight = -1.0
    heaviest_leg_index: int | None = None

    for leg_index, leg in enumerate(legs):
        load_ratio = current_cargo_kg / max_weight if max_weight > 0 else 0.0
        consumption = _consumption_l100km(base_consumption, load_ratio, weight_fuel_factor)
        liters = leg.distance_km * consumption / 100.0
        cost_eur = liters * fuel_price_eur_per_liter
        weight_at_leg = tare_kg + current_cargo_kg

        leg_costs.append(
            LegFuelCost(
                leg_index=leg_index,
                distance_km=leg.distance_km,
                weight_kg_at_leg=weight_at_leg,
                load_ratio=load_ratio,
                consumption_l100km=consumption,
                liters=liters,
                cost_eur=cost_eur,
                ldm_at_leg=current_ldm,
            ),
        )

        total_liters += liters
        total_cost_eur += cost_eur
        total_distance_km += leg.distance_km

        if weight_at_leg > heaviest_weight:
            heaviest_weight = weight_at_leg
            heaviest_leg_index = leg_index

        if leg.to_index >= 1:
            stop = stops[leg.to_index - 1]
            current_cargo_kg = _apply_stop_cargo_delta(current_cargo_kg, stop)
            current_ldm = _apply_stop_ldm_delta(current_ldm, stop)

    avg_consumption = (total_liters / total_distance_km) * 100.0 if total_distance_km > 0 else 0.0

    return MultistopFuelResult(
        leg_costs=leg_costs,
        total_liters=total_liters,
        total_cost_eur=total_cost_eur,
        avg_consumption_l100km=avg_consumption,
        heaviest_leg_index=heaviest_leg_index,
    )
