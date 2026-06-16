"""Build route-map payload: per-leg geometry and load-aware weights."""

from __future__ import annotations

import logging
from uuid import UUID

from shapely.geometry import LineString
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings, get_settings
from app.core.exceptions import NotFoundError
from app.lib.geo import geo_point_from_geometry, lat_lon_from_geometry
from app.lib.geocoder import coordinate_fallback
from app.lib.redis_client import get_redis
from app.lib.routing import RoutingProvider, get_routing_provider
from app.models import ConsolidationSession, RouteStop
from app.schemas.offer import GeoPoint
from app.schemas.route_map import (
    DriverRestPoint,
    RouteMapLeg,
    RouteMapResponse,
    RouteMapStop,
)
from app.services.driver_compliance import compute_rest_points
from app.services.route_builder import build_session_route
from app.services.stop_labels import ensure_stop_label

_logger = logging.getLogger(__name__)

_ROUTE_MAP_CACHE_TTL_SECONDS = 3600


def _linestring_to_leaflet_coords(line: LineString) -> list[list[float]]:
    if line.is_empty:
        return []
    return [[float(y), float(x)] for x, y in line.coords]


def _leg_fallback_coords(
    waypoints_lat_lon: list[tuple[float, float]],
    from_index: int,
    to_index: int,
) -> list[list[float]]:
    if from_index >= len(waypoints_lat_lon) or to_index >= len(waypoints_lat_lon):
        return []
    lat0, lon0 = waypoints_lat_lon[from_index]
    lat1, lon1 = waypoints_lat_lon[to_index]
    return [[lat0, lon0], [lat1, lon1]]


def _format_address_label(stop: RouteStop, label: str) -> str:
    kind = "Odbiór" if stop.stop_type == "pickup" else "Dostawa"
    return f"{kind} · {label}"


class RouteMapService:
    """Assembles geometry and weight data for the frontend route map."""

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

    async def get_route_map(self, session_id: UUID) -> RouteMapResponse:
        redis = get_redis()
        cache_key = f"route_map:v2:{session_id}"

        cached = await redis.get(cache_key)
        if cached is not None:
            _logger.info(
                "route map cache hit",
                extra={"event": "route_map:cache:hit", "session_id": str(session_id)},
            )
            return RouteMapResponse.model_validate_json(cached)

        _logger.info(
            "route map cache miss",
            extra={"event": "route_map:cache:miss", "session_id": str(session_id)},
        )

        session = await self._load_session(session_id)
        if session is None:
            raise NotFoundError(f"Session {session_id} not found.")

        # Single ORS multi-stop call + fuel + per-leg geometry split (shared).
        build = await build_session_route(
            session, routing=self._routing, settings=self._settings
        )
        vehicle = session.vehicle

        origin = GeoPoint(
            lon=float(session.origin_lon),
            lat=float(session.origin_lat),
        )

        legs: list[RouteMapLeg] = []
        leg_counts = (
            len(build.fuel_result.leg_costs),
            len(build.leg_geoms),
            len(build.route.legs),
        )
        if len(set(leg_counts)) != 1:
            _logger.warning(
                "route map leg segment count mismatch: costs=%d geoms=%d route_legs=%d",
                *leg_counts,
                extra={"event": "route_map:leg:mismatch", "session_id": str(session_id)},
            )
        leg_count = min(leg_counts)
        for leg_cost, geom, route_leg in zip(
            build.fuel_result.leg_costs[:leg_count],
            build.leg_geoms[:leg_count],
            build.route.legs[:leg_count],
            strict=True,
        ):
            coords = _linestring_to_leaflet_coords(geom)
            if not coords:
                _logger.warning(
                    "route map leg geometry empty; using straight-line fallback",
                    extra={
                        "event": "route_map:leg:fallback",
                        "session_id": str(session_id),
                        "leg_index": leg_cost.leg_index,
                    },
                )
                coords = _leg_fallback_coords(
                    build.waypoints_lat_lon,
                    route_leg.from_index,
                    route_leg.to_index,
                )
            max_weight = float(vehicle.max_weight_kg)
            max_ldm = float(vehicle.max_ldm)
            weight_ratio = leg_cost.weight_kg_at_leg / max_weight if max_weight > 0 else 0.0
            ldm_ratio = leg_cost.ldm_at_leg / max_ldm if max_ldm > 0 else 0.0
            load_ratio = round(min(1.0, max(weight_ratio, ldm_ratio)), 4)
            legs.append(
                RouteMapLeg(
                    leg_id=leg_cost.leg_index + 1,
                    weight_kg_at_leg=round(leg_cost.weight_kg_at_leg, 1),
                    ldm_at_leg=round(leg_cost.ldm_at_leg, 2),
                    geometry_coords=coords,
                    distance_km=round(leg_cost.distance_km, 3),
                    duration_minutes=route_leg.duration_minutes,
                    load_ratio=load_ratio,
                )
            )

        stop_rows: list[RouteMapStop] = []
        for index, stop in enumerate(build.stops):
            stop_rows.append(await self._stop_row(stop, is_current=(index == 0)))

        stop_minutes = [
            float(
                stop.offer.handling_time_minutes
                if stop.offer is not None
                and stop.offer.handling_time_minutes is not None
                else self._settings.STOP_COST_MINUTES
            )
            for stop in build.stops
        ]
        rest_points = [
            DriverRestPoint.model_validate(point)
            for point in compute_rest_points(
                leg_minutes=[float(leg.duration_minutes) for leg in legs],
                stop_minutes=stop_minutes,
                leg_geometries=[leg.geometry_coords for leg in legs],
            )
        ]

        result = RouteMapResponse(
            session_id=session.id,
            origin=origin,
            legs=legs,
            stops=stop_rows,
            rest_points=rest_points,
            vehicle_max_weight_kg=int(vehicle.max_weight_kg),
            total_distance_km=round(build.route.total_distance_km, 3),
            total_duration_minutes=build.route.total_duration_minutes,
        )

        await redis.setex(
            cache_key,
            _ROUTE_MAP_CACHE_TTL_SECONDS,
            result.model_dump_json(),
        )

        return result

    async def _stop_row(self, stop: RouteStop, *, is_current: bool) -> RouteMapStop:
        handling: int | None = None
        if stop.offer is not None and stop.offer.handling_time_minutes is not None:
            handling = int(stop.offer.handling_time_minutes)

        if stop.address_label:
            label = stop.address_label
        else:
            try:
                label = await ensure_stop_label(self._db, stop, redis=get_redis())
            except Exception:
                lat, lon = lat_lon_from_geometry(stop.location)
                label = coordinate_fallback(lat, lon)

        return RouteMapStop(
            id=stop.id,
            offer_id=stop.offer_id,
            stop_type=stop.stop_type,  # type: ignore[arg-type]
            sequence_order=stop.sequence_order,
            location=geo_point_from_geometry(stop.location),
            eta_minutes_from_start=stop.eta_minutes_from_start,
            stop_cost_eur=(
                float(stop.stop_cost_eur) if stop.stop_cost_eur is not None else None
            ),
            address_label=_format_address_label(stop, label),
            handling_time_minutes=handling,
            is_current=is_current,
        )

    async def _load_session(self, session_id: UUID) -> ConsolidationSession | None:
        stmt = (
            select(ConsolidationSession)
            .where(ConsolidationSession.id == session_id)
            .options(
                selectinload(ConsolidationSession.vehicle),
                selectinload(ConsolidationSession.route_stops).selectinload(
                    RouteStop.offer
                ),
            )
        )
        result = await self._db.execute(stmt)
        return result.scalar_one_or_none()
