"""Build route-map payload: per-leg geometry and load-aware weights."""

from __future__ import annotations

from uuid import UUID

from shapely.geometry import LineString
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings, get_settings
from app.core.exceptions import NotFoundError, ValidationAppError
from app.lib.geo import geo_point_from_geometry, lat_lon_from_geometry
from app.lib.geocoder import coordinate_fallback
from app.lib.osrm import OSRMClient, get_osrm_client
from app.lib.redis_client import get_redis
from app.models import ConsolidationSession, RouteStop
from app.schemas.offer import GeoPoint
from app.schemas.route_map import RouteMapLeg, RouteMapResponse, RouteMapStop
from app.services.fuel_calculator import calculate_multi_stop_fuel
from app.services.profit_calculator import split_route_into_leg_geometries
from app.services.stop_labels import ensure_stop_label


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
                "Session has no route stops; cannot build route map."
            )

        origin = GeoPoint(
            lon=float(session.origin_lon),
            lat=float(session.origin_lat),
        )
        waypoints_lat_lon: list[tuple[float, float]] = [
            (float(session.origin_lat), float(session.origin_lon))
        ]
        for stop in stops:
            waypoints_lat_lon.append(lat_lon_from_geometry(stop.location))

        route = await self._osrm.get_route_multi(waypoints_lat_lon)
        fuel_result = calculate_multi_stop_fuel(
            route.legs,
            stops,
            vehicle,
            fuel_price_eur_per_liter=self._settings.FUEL_PRICE_EUR_PER_LITER,
            weight_fuel_factor=self._settings.WEIGHT_FUEL_FACTOR,
        )
        leg_geoms = split_route_into_leg_geometries(route)

        legs: list[RouteMapLeg] = []
        for leg_cost, geom, osrm_leg in zip(
            fuel_result.leg_costs,
            leg_geoms,
            route.legs,
            strict=False,
        ):
            coords = _linestring_to_leaflet_coords(geom)
            if not coords:
                coords = _leg_fallback_coords(
                    waypoints_lat_lon,
                    osrm_leg.from_index,
                    osrm_leg.to_index,
                )
            legs.append(
                RouteMapLeg(
                    leg_id=leg_cost.leg_index + 1,
                    weight_kg_at_leg=round(leg_cost.weight_kg_at_leg, 1),
                    geometry_coords=coords,
                )
            )

        stop_rows: list[RouteMapStop] = []
        for index, stop in enumerate(stops):
            stop_rows.append(await self._stop_row(stop, is_current=(index == 0)))

        return RouteMapResponse(
            session_id=session.id,
            origin=origin,
            legs=legs,
            stops=stop_rows,
            vehicle_max_weight_kg=int(vehicle.max_weight_kg),
        )

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
