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
from app.lib.osrm import OSRMClient, get_osrm_client
from app.lib.redis_client import get_redis
from app.models import ConsolidationSession, RouteStop
from app.schemas.offer import GeoPoint
from app.schemas.route_map import RouteMapLeg, RouteMapResponse, RouteMapStop
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
        osrm: OSRMClient | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._db = db
        self._osrm = osrm or get_osrm_client()
        self._settings = settings or get_settings()

    async def get_route_map(self, session_id: UUID) -> RouteMapResponse:
        redis = get_redis()
        cache_key = f"route_map:{session_id}"

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

        # Single OSRM multi-stop call + fuel + per-leg geometry split (shared).
        build = await build_session_route(
            session, osrm=self._osrm, settings=self._settings
        )
        vehicle = session.vehicle

        origin = GeoPoint(
            lon=float(session.origin_lon),
            lat=float(session.origin_lat),
        )

        legs: list[RouteMapLeg] = []
        for leg_cost, geom, osrm_leg in zip(
            build.fuel_result.leg_costs,
            build.leg_geoms,
            build.route.legs,
            strict=False,
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
                    osrm_leg.from_index,
                    osrm_leg.to_index,
                )
            legs.append(
                RouteMapLeg(
                    leg_id=leg_cost.leg_index + 1,
                    weight_kg_at_leg=round(leg_cost.weight_kg_at_leg, 1),
                    geometry_coords=coords,
                    distance_km=round(leg_cost.distance_km, 3),
                    duration_minutes=osrm_leg.duration_minutes,
                    load_ratio=round(leg_cost.load_ratio, 4),
                )
            )

        stop_rows: list[RouteMapStop] = []
        for index, stop in enumerate(build.stops):
            stop_rows.append(await self._stop_row(stop, is_current=(index == 0)))

        result = RouteMapResponse(
            session_id=session.id,
            origin=origin,
            legs=legs,
            stops=stop_rows,
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
