"""Detour estimation helpers for offer scoring."""

from __future__ import annotations

import logging
from typing import Sequence

from app.core.exceptions import RoutingUnavailableError
from app.lib.geo import haversine_km
from app.lib.routing import RoutingProvider

_logger = logging.getLogger("offer.detour")

MAX_DETOUR_KM = 200.0
COST_PER_KM_EUR = 0.45


def haversine_added_detour_km(
    waypoints: Sequence[tuple[float, float]],
    pickup: tuple[float, float],
    delivery: tuple[float, float],
) -> float:
    """Returns extra km driven vs going directly last→delivery.

    Returns full pickup→delivery distance when route has no prior waypoints.
    Zero when pickup lies on the direct path.

    When *waypoints* is empty the vehicle has no prior route reference, so the
    full pickup→delivery leg is returned as the cost of the first load.
    When *waypoints* is non-empty the true added detour is:
        (last→pickup + pickup→delivery) − (last→delivery)
    clamped to zero from below (handles the case where pickup is on the
    direct path).
    """
    pick_lat, pick_lon = pickup[0], pickup[1]
    del_lat, del_lon = delivery[0], delivery[1]

    if not waypoints:
        # No prior route — full pickup→delivery leg is the initial cost.
        return (
            haversine_km(pick_lon, pick_lat, del_lon, del_lat)
            if pickup != delivery
            else 0.0
        )

    last = waypoints[-1]
    last_lat, last_lon = last[0], last[1]
    via_pickup_km = haversine_km(last_lon, last_lat, pick_lon, pick_lat) + haversine_km(
        pick_lon, pick_lat, del_lon, del_lat
    )
    direct_km = haversine_km(last_lon, last_lat, del_lon, del_lat)
    return max(0.0, round(via_pickup_km - direct_km, 2))


async def calculate_added_detour(
    routing: RoutingProvider,
    baseline_km: float,
    waypoints: Sequence[tuple[float, float]],
    pickup: tuple[float, float],
    delivery: tuple[float, float],
) -> float:
    """Compute added route km when appending pickup + delivery to *waypoints*.

    Falls back to :func:`haversine_added_detour_km` when routing is unavailable.
    """
    if not waypoints and pickup == delivery:
        return 0.0

    extended = [*waypoints, pickup, delivery]
    try:
        if len(extended) < 2:
            return 0.0
        route = await routing.get_route_multi(list(extended))
        if baseline_km == 0:
            # Empty route — full new route distance is the added cost.
            added = route.total_distance_km
        else:
            added = max(0.0, route.total_distance_km - baseline_km)
        return round(added, 2)
    except RoutingUnavailableError as exc:
        _logger.warning(
            "Routing detour failed; using haversine fallback",
            extra={"event": "detour:routing:fallback", "error": str(exc)},
        )
        return round(haversine_added_detour_km(waypoints, pickup, delivery), 2)
    except Exception as exc:
        _logger.warning(
            "Unexpected detour error; using haversine fallback",
            extra={"event": "detour:error", "error": str(exc)},
        )
        return round(haversine_added_detour_km(waypoints, pickup, delivery), 2)
