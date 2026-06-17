"""Shared route assembly for map + geometry endpoints.

A single :func:`build_session_route` performs **one** ``get_route_multi`` ORS
call per request, computes load-aware fuel data, and splits the full geometry
into per-leg ``LineString`` segments. Both :class:`RouteMapService` and
:class:`RouteGeometryService` delegate here so the ORS/fuel/split logic lives
in exactly one place (DRY).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from shapely.geometry import LineString

from app.core.config import Settings
from app.core.exceptions import ValidationAppError
from app.lib.geo import haversine_km, lat_lon_from_geometry
from app.lib.routing import MultiStopRouteResult, RouteLeg, RoutingProvider
from app.models import ConsolidationSession, RouteStop
from app.services.fuel_calculator import MultistopFuelResult, calculate_multi_stop_fuel
from app.services.profit_calculator import split_route_into_leg_geometries

_logger = logging.getLogger(__name__)

# ORS hard limit: 6 000 000 m = 6 000 km per request.
# We warn (but still try ORS) when the haversine estimate approaches this.
_ORS_MAX_ROUTE_KM = 5_500.0


@dataclass(frozen=True)
class SessionRouteBuild:
    """Result of a single ORS multi-stop build for a consolidation session."""

    stops: list[RouteStop]
    waypoints_lat_lon: list[tuple[float, float]]
    route: MultiStopRouteResult
    leg_geoms: list[LineString]
    fuel_result: MultistopFuelResult


def _validate_and_order_stops(session: ConsolidationSession) -> list[RouteStop]:
    if session.vehicle is None:
        raise ValidationAppError("Session vehicle is not set.")
    if session.origin_lat is None or session.origin_lon is None:
        raise ValidationAppError("Session origin coordinates are not set.")

    stops = sorted(session.route_stops, key=lambda s: s.sequence_order)
    if not stops:
        raise ValidationAppError(
            "Session has no route stops; cannot build route geometry."
        )
    return stops


def _haversine_route_km(waypoints: list[tuple[float, float]]) -> float:
    """Sum of great-circle legs — fast estimate, no network call."""
    total = 0.0
    for i in range(len(waypoints) - 1):
        a_lat, a_lon = waypoints[i]
        b_lat, b_lon = waypoints[i + 1]
        total += haversine_km(a_lon, a_lat, b_lon, b_lat)
    return round(total, 3)


async def build_session_route(
    session: ConsolidationSession,
    *,
    routing: RoutingProvider,
    settings: Settings,
) -> SessionRouteBuild:
    """Build per-leg geometry + fuel data with a single ORS call.

    Raises
    ------
    ValidationAppError
        When the session has no vehicle, origin, or stops.
    RoutingUnavailableError
        When ORS cannot compute the route (propagated to caller).
    """
    stops = _validate_and_order_stops(session)
    vehicle = session.vehicle
    assert vehicle is not None  # guaranteed by _validate_and_order_stops

    waypoints_lat_lon: list[tuple[float, float]] = [
        (float(session.origin_lat or 0.0), float(session.origin_lon or 0.0))
    ]
    for stop in stops:
        waypoints_lat_lon.append(lat_lon_from_geometry(stop.location))

    estimated_km = _haversine_route_km(waypoints_lat_lon)
    if estimated_km > _ORS_MAX_ROUTE_KM:
        _logger.warning(
            "Route haversine estimate %.0f km approaches ORS limit (%.0f km) for session %s",
            estimated_km,
            _ORS_MAX_ROUTE_KM,
            session.id,
        )

    # Always use ORS for real road geometry — no straight-line fallback.
    route = await routing.get_route_multi(waypoints_lat_lon)

    fuel_result = calculate_multi_stop_fuel(
        route.legs,
        stops,
        vehicle,
        fuel_price_eur_per_liter=settings.FUEL_PRICE_EUR_PER_LITER,
        weight_fuel_factor=settings.WEIGHT_FUEL_FACTOR,
    )
    leg_geoms = split_route_into_leg_geometries(route)

    return SessionRouteBuild(
        stops=stops,
        waypoints_lat_lon=waypoints_lat_lon,
        route=route,
        leg_geoms=leg_geoms,
        fuel_result=fuel_result,
    )
