"""Build route geometry payload with GeoJSON and per-leg load data for Leaflet heat-map."""

from __future__ import annotations

import logging
from uuid import UUID

from shapely.geometry import LineString, mapping
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings, get_settings
from app.core.exceptions import NotFoundError, ValidationAppError
from app.lib.geo import lat_lon_from_geometry
from app.lib.osrm import OSRMClient, get_osrm_client
from app.lib.redis_client import get_redis
from app.models import ConsolidationSession, RouteStop
from app.schemas.route_geometry import LegGeometry, RouteGeometry
from app.services.fuel_calculator import calculate_multi_stop_fuel
from app.services.profit_calculator import split_route_into_leg_geometries

_logger = logging.getLogger(__name__)

_ROUTE_GEOM_CACHE_TTL_SECONDS = 3600


class RouteGeometryService:
    """Assembles GeoJSON geometry and load-aware per-leg data for the frontend route map."""

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

    async def get_route_geometry(self, session_id: UUID) -> RouteGeometry:
        redis = get_redis()
        cache_key = f"route_geom:{session_id}"

        cached = await redis.get(cache_key)
        if cached is not None:
            _logger.info(
                "route geometry cache hit",
                extra={"event": "route_geom:cache:hit", "session_id": str(session_id)},
            )
            return RouteGeometry.model_validate_json(cached)

        _logger.info(
            "route geometry cache miss",
            extra={"event": "route_geom:cache:miss", "session_id": str(session_id)},
        )

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
                "Session has no route stops; cannot build route geometry."
            )

        origin = (float(session.origin_lat), float(session.origin_lon))
        waypoints: list[tuple[float, float]] = [origin]
        for stop in stops:
            waypoints.append(lat_lon_from_geometry(stop.location))

        route = await self._osrm.get_route_multi(waypoints)

        fuel_result = calculate_multi_stop_fuel(
            route.legs,
            stops,
            vehicle,
            fuel_price_eur_per_liter=self._settings.FUEL_PRICE_EUR_PER_LITER,
            weight_fuel_factor=self._settings.WEIGHT_FUEL_FACTOR,
        )

        leg_geoms = split_route_into_leg_geometries(route)

        leg_geometries: list[LegGeometry] = []
        for leg_cost, geom, osrm_leg in zip(
            fuel_result.leg_costs,
            leg_geoms,
            route.legs,
            strict=False,
        ):
            from_stop_id = self._map_stop_id(stops, osrm_leg.from_index)
            to_stop_id = self._map_stop_id(stops, osrm_leg.to_index)

            geometry_geojson = self._linestring_to_geojson(geom)

            leg_geometries.append(
                LegGeometry(
                    leg_index=leg_cost.leg_index,
                    from_stop_id=from_stop_id,
                    to_stop_id=to_stop_id,
                    geometry_geojson=geometry_geojson,
                    distance_km=round(leg_cost.distance_km, 3),
                    duration_minutes=osrm_leg.duration_minutes,
                    weight_kg_at_leg=round(leg_cost.weight_kg_at_leg, 1),
                    load_ratio=round(leg_cost.load_ratio, 4),
                )
            )

        result = RouteGeometry(
            session_id=session_id,
            total_distance_km=round(route.total_distance_km, 3),
            total_duration_minutes=route.total_duration_minutes,
            geometry_geojson=route.geometry_geojson,
            legs=leg_geometries,
            vehicle_max_weight_kg=int(vehicle.max_weight_kg),
        )

        await redis.setex(
            cache_key,
            _ROUTE_GEOM_CACHE_TTL_SECONDS,
            result.model_dump_json(),
        )

        return result

    @staticmethod
    def _map_stop_id(stops: list[RouteStop], waypoint_index: int) -> UUID | None:
        """Map waypoint index to stop ID. Waypoint 0 is origin (no ID)."""
        if waypoint_index == 0:
            return None
        stop_index = waypoint_index - 1
        if 0 <= stop_index < len(stops):
            return stops[stop_index].id
        return None

    @staticmethod
    def _linestring_to_geojson(line: LineString) -> dict:
        """Convert Shapely LineString to GeoJSON dict with [lon, lat] coordinates."""
        if line.is_empty:
            return {"type": "LineString", "coordinates": []}
        return dict(mapping(line))

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
