"""Session profit calculator — 5-category cost breakdown with CostEvent persistence."""

from __future__ import annotations

import math
import logging
from uuid import UUID

from shapely.geometry import LineString, shape
from shapely.ops import substring
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings, get_settings
from app.core.exceptions import NotFoundError, ValidationAppError
from app.lib.geo import lat_lon_from_geometry
from app.lib.osrm import MultiStopRouteResult, OSRMClient, get_osrm_client
from app.models import ConsolidationSession, CostEvent, RouteStop
from app.schemas.profit import SessionProfitBreakdown
from app.services.fuel_calculator import calculate_multi_stop_fuel
from app.services.stop_cost_calculator import StopCostRates, calculate_stop_cost
from app.services.toll_calculator import calculate_route_tolls

_logger = logging.getLogger(__name__)

_COST_TYPES = ("fuel", "toll", "stop", "driver", "maintenance")


def split_route_into_leg_geometries(route: MultiStopRouteResult) -> list[LineString]:
    """Proportionally split the route LineString into per-leg LineStrings.

    OSRM provides a single geometry for the full route. We split it into
    per-leg segments proportionally by each leg's distance_km. The result
    is fed to the toll calculator which intersects each segment with country
    boundaries.
    """
    if not route.legs:
        return []

    full_line = shape(route.geometry_geojson)
    total_km = sum(leg.distance_km for leg in route.legs)

    if total_km == 0:
        return [LineString() for _ in route.legs]

    leg_geoms: list[LineString] = []
    cumulative = 0.0
    for leg in route.legs:
        start_frac = cumulative / total_km
        cumulative += leg.distance_km
        end_frac = min(cumulative / total_km, 1.0)
        seg = substring(full_line, start_frac, end_frac, normalized=True)
        # substring returns a Point when start == end; fall back to empty LineString
        if not isinstance(seg, LineString):
            seg = LineString()
        leg_geoms.append(seg)

    return leg_geoms


class SessionProfitCalculator:
    """Computes the full 5-category profit breakdown for a consolidation session."""

    def __init__(
        self,
        db: AsyncSession,
        *,
        osrm: OSRMClient | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._db = db
        self._osrm = osrm or get_osrm_client()
        self._settings = settings or get_settings()

    async def calculate_session_profit(self, session_id: UUID) -> SessionProfitBreakdown:
        session = await self._load_session(session_id)
        if session is None:
            raise NotFoundError(f"Session {session_id} not found.")

        vehicle = session.vehicle
        if vehicle is None:
            raise ValidationAppError("Session vehicle is not set.")
        if session.origin_lat is None or session.origin_lon is None:
            raise ValidationAppError("Session origin coordinates are not set.")

        stops = sorted(session.route_stops, key=lambda s: s.sequence_order)
        if not stops:
            raise ValidationAppError(
                "Session has no route stops; cannot calculate profit."
            )

        origin = (float(session.origin_lat), float(session.origin_lon))
        waypoints = [origin] + [lat_lon_from_geometry(s.location) for s in stops]
        route = await self._osrm.get_route_multi(waypoints)

        driver_profile = session.driver_profile
        rates = StopCostRates.from_driver_profile(driver_profile)

        # Step 1 — Revenue: sum unique pickup offer prices
        revenue = sum(
            float(s.offer.price_eur)
            for s in stops
            if s.stop_type == "pickup" and s.offer is not None
        )

        # Step 2 — Fuel (load-aware per-leg consumption)
        fuel_result = calculate_multi_stop_fuel(
            route.legs,
            stops,
            vehicle,
            fuel_price_eur_per_liter=self._settings.FUEL_PRICE_EUR_PER_LITER,
            weight_fuel_factor=self._settings.WEIGHT_FUEL_FACTOR,
        )
        fuel_eur = round(fuel_result.total_cost_eur, 2)

        # Step 3 — Tolls (proportional geometry split → country intersection)
        leg_geoms = split_route_into_leg_geometries(route)
        toll_breakdown = calculate_route_tolls(leg_geoms, vehicle.type)
        toll_eur = round(toll_breakdown.total_eur, 2)

        # Step 4 — Stop costs (per stop, from driver profile rates)
        stop_costs_acc = 0.0
        for stop in stops:
            handling = (
                stop.offer.handling_time_minutes
                if stop.offer is not None
                and stop.offer.handling_time_minutes is not None
                else self._settings.STOP_COST_MINUTES
            )
            breakdown = calculate_stop_cost(
                handling,
                vehicle.type,
                rates=rates,
                fuel_price_eur_per_liter=self._settings.FUEL_PRICE_EUR_PER_LITER,
            )
            stop_costs_acc += breakdown.total_eur
        stop_costs_eur = round(stop_costs_acc, 2)

        # Step 5 — Driver (daily allowance based on driving hours)
        total_duration_hours = sum(leg.duration_minutes for leg in route.legs) / 60.0
        days_on_road = math.ceil(total_duration_hours / 9.0)
        driver_eur = round(days_on_road * self._settings.DRIVER_DAILY_ALLOWANCE_EUR, 2)

        # Step 6 — Maintenance
        total_distance_km = sum(leg.distance_km for leg in route.legs)
        maintenance_eur = round(
            total_distance_km * self._settings.MAINTENANCE_EUR_PER_KM, 2
        )

        # Step 7 — Aggregate
        total_cost = round(
            fuel_eur + toll_eur + stop_costs_eur + driver_eur + maintenance_eur, 2
        )
        net_profit = round(revenue - total_cost, 2)

        max_ldm = float(vehicle.max_ldm) if float(vehicle.max_ldm) > 0 else 1.0
        profit_margin_pct = round(net_profit / revenue * 100, 2) if revenue > 0 else 0.0
        cost_per_km_eur = (
            round(total_cost / total_distance_km, 4) if total_distance_km > 0 else 0.0
        )
        revenue_per_ldm_eur = round(revenue / max_ldm, 2)
        breakeven_fill_pct = (
            round(total_cost / revenue * 100, 2) if revenue > 0 else None
        )

        # Persist: replace cost events + update session columns
        await self._upsert_cost_events(
            session.id,
            fuel_eur=fuel_eur,
            toll_eur=toll_eur,
            stop_eur=stop_costs_eur,
            driver_eur=driver_eur,
            maintenance_eur=maintenance_eur,
        )
        session.net_profit_eur = net_profit
        session.total_revenue_eur = revenue
        await self._db.flush()

        _logger.info(
            "profit calculated",
            extra={
                "session_id": str(session_id),
                "net_profit_eur": net_profit,
                "total_cost_eur": total_cost,
                "distance_km": total_distance_km,
            },
        )

        return SessionProfitBreakdown(
            revenue_eur=round(revenue, 2),
            fuel_eur=fuel_eur,
            toll_eur=toll_eur,
            stop_costs_eur=stop_costs_eur,
            driver_eur=driver_eur,
            maintenance_eur=maintenance_eur,
            total_cost_eur=total_cost,
            net_profit_eur=net_profit,
            profit_margin_pct=profit_margin_pct,
            cost_per_km_eur=cost_per_km_eur,
            revenue_per_ldm_eur=revenue_per_ldm_eur,
            breakeven_fill_pct=breakeven_fill_pct,
        )

    async def _load_session(self, session_id: UUID) -> ConsolidationSession | None:
        stmt = (
            select(ConsolidationSession)
            .where(ConsolidationSession.id == session_id)
            .options(
                selectinload(ConsolidationSession.vehicle),
                selectinload(ConsolidationSession.driver_profile),
                selectinload(ConsolidationSession.route_stops).selectinload(
                    RouteStop.offer
                ),
            )
        )
        result = await self._db.execute(stmt)
        return result.scalars().first()

    async def _upsert_cost_events(
        self,
        session_id: UUID,
        *,
        fuel_eur: float,
        toll_eur: float,
        stop_eur: float,
        driver_eur: float,
        maintenance_eur: float,
    ) -> None:
        await self._db.execute(
            delete(CostEvent).where(
                CostEvent.session_id == session_id,
                CostEvent.cost_type.in_(_COST_TYPES),
            )
        )
        amounts: dict[str, float] = {
            "fuel": fuel_eur,
            "toll": toll_eur,
            "stop": stop_eur,
            "driver": driver_eur,
            "maintenance": maintenance_eur,
        }
        for cost_type, amount in amounts.items():
            self._db.add(
                CostEvent(
                    session_id=session_id,
                    cost_type=cost_type,
                    amount_eur=amount,
                )
            )
