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
from app.lib.routing import MultiStopRouteResult, RoutingProvider, get_routing_provider
from app.models import ConsolidationSession, CostEvent, RouteStop
from app.schemas.profit import (
    CostFormulaMeta,
    LegCostBreakdown,
    LegFuelBreakdown,
    OfferRevenueRow,
    ProfitFormulas,
    SessionProfitBreakdown,
)
from app.services.driver_compliance import MAX_DAILY_DRIVING_HOURS
from app.services.fuel_calculator import calculate_multi_stop_fuel
from app.services.stop_cost_calculator import StopCostRates, calculate_stop_cost
from app.services.toll_calculator import calculate_route_tolls

_logger = logging.getLogger(__name__)

_COST_TYPES = ("fuel", "toll", "stop", "driver", "maintenance")


def split_route_into_leg_geometries(route: MultiStopRouteResult) -> list[LineString]:
    """Proportionally split the route LineString into per-leg LineStrings.

    The routing provider returns a single geometry for the full route. We split it into
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
        routing: RoutingProvider | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._db = db
        self._routing = routing or get_routing_provider()
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
        route = await self._routing.get_route_multi(waypoints)

        driver_profile = session.driver_profile
        rates = StopCostRates.from_driver_profile(driver_profile)

        # Step 1 — Revenue: sum unique pickup offer prices
        offer_revenue_rows: list[OfferRevenueRow] = []
        seen_pickup_offers: set[UUID] = set()
        revenue = 0.0
        for stop in stops:
            if stop.stop_type != "pickup" or stop.offer is None:
                continue
            offer_id = stop.offer.id
            if offer_id in seen_pickup_offers:
                continue
            seen_pickup_offers.add(offer_id)
            price = float(stop.offer.price_eur)
            revenue += price
            offer_revenue_rows.append(
                OfferRevenueRow(offer_id=offer_id, revenue_eur=round(price, 2))
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

        # Step 4 — Stop costs (sum from persisted stop_cost_eur, recalculate if missing)
        stop_costs_acc = 0.0
        needs_recalc = False
        for stop in stops:
            if stop.stop_cost_eur is not None:
                stop_costs_acc += float(stop.stop_cost_eur)
            else:
                needs_recalc = True
                break

        if needs_recalc:
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
                stop.stop_cost_eur = breakdown.total_eur
                stop_costs_acc += breakdown.total_eur

        stop_costs_eur = round(stop_costs_acc, 2)
        stop_count = len(stops)
        per_stop_cost = (
            round(stop_costs_eur / stop_count, 2) if stop_count > 0 else 0.0
        )

        # Step 5 — Driver (daily allowance). Days-on-road must match the EU 561/2006
        # day split used by DriverComplianceService.evaluate_session, which starts a
        # new driving day once accumulated driving exceeds MAX_DAILY_DRIVING_HOURS (9h).
        # Using the same formula here keeps diet (allowance) and compliance day counts
        # consistent: days = ceil(total_driving_minutes / (9h * 60)).
        total_driving_minutes = sum(leg.duration_minutes for leg in route.legs)
        days_on_road = max(
            1,
            math.ceil(total_driving_minutes / (MAX_DAILY_DRIVING_HOURS * 60.0)),
        )
        driver_eur = round(days_on_road * self._settings.DRIVER_DAILY_ALLOWANCE_EUR, 2)

        # Step 6 — Maintenance
        total_distance_km = sum(leg.distance_km for leg in route.legs)
        maintenance_eur = round(
            total_distance_km * self._settings.MAINTENANCE_EUR_PER_KM, 2
        )

        fuel_price = self._settings.FUEL_PRICE_EUR_PER_LITER
        daily_allowance = self._settings.DRIVER_DAILY_ALLOWANCE_EUR
        maint_rate = self._settings.MAINTENANCE_EUR_PER_KM

        leg_rows = [
            LegFuelBreakdown(
                leg_id=leg_cost.leg_index + 1,
                fuel_consumption=round(leg_cost.liters, 2),
            )
            for leg_cost in fuel_result.leg_costs
        ]

        leg_cost_rows = [
            LegCostBreakdown(
                leg_index=leg_cost.leg_index,
                distance_km=round(leg_cost.distance_km, 3),
                duration_minutes=route.legs[leg_cost.leg_index].duration_minutes,
                weight_kg_at_leg=round(leg_cost.weight_kg_at_leg, 1),
                load_ratio=round(leg_cost.load_ratio, 4),
                consumption_l100km=round(leg_cost.consumption_l100km, 2),
                liters=round(leg_cost.liters, 2),
                cost_eur=round(leg_cost.cost_eur, 2),
            )
            for leg_cost in fuel_result.leg_costs
        ]

        formulas = ProfitFormulas(
            fuel=CostFormulaMeta(
                liters_total=round(fuel_result.total_liters, 2),
                fuel_price=fuel_price,
            ),
            toll=CostFormulaMeta(distance_km=round(total_distance_km, 2)),
            stops=CostFormulaMeta(
                stop_count=stop_count,
                per_stop_cost=per_stop_cost,
            ),
            driver=CostFormulaMeta(
                days_on_road=days_on_road,
                daily_allowance=daily_allowance,
            ),
            maintenance=CostFormulaMeta(
                distance_km=round(total_distance_km, 2),
                maint_rate=maint_rate,
            ),
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
            session_id=session_id,
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
            stop_count=stop_count,
            total_distance_km=round(total_distance_km, 3),
            days_on_road=days_on_road,
            total_liters=round(fuel_result.total_liters, 2),
            toll_is_estimated=True,
            formulas=formulas,
            legs=leg_rows,
            leg_costs=leg_cost_rows,
            offer_revenue=offer_revenue_rows,
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
