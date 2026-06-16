"""Fleet vehicle endpoints (`/api/v1/fleet`)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.lib.geo import haversine_km, lat_lon_from_geometry
from app.models.fleet_vehicle import FleetVehicle
from app.models.session import ConsolidationSession
from app.models.stop import RouteStop
from app.schemas.fleet import FleetVehicleCreate, FleetVehicleRead, FleetVehicleUpdate
from app.services.fleet_service import FleetService

router = APIRouter(prefix="/fleet", tags=["fleet"])


# ── Route-stops simulation schema ─────────────────────────────────────────────

class RouteStopSimEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sequence: int
    lat: float
    lon: float
    address_label: str | None = None
    stop_type: str
    cumulative_km: float


class FleetRouteStopsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: UUID | None = None
    simulation_started_at: datetime | None = None
    stops: list[RouteStopSimEntry]


# ── CRUD endpoints ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[FleetVehicleRead], summary="List all fleet vehicles")
async def list_fleet(db: AsyncSession = Depends(get_db)) -> list[FleetVehicleRead]:
    return await FleetService(db).list_fleet()


@router.post("", response_model=FleetVehicleRead, status_code=201, summary="Create fleet vehicle")
async def create_fleet_vehicle(
    payload: FleetVehicleCreate,
    db: AsyncSession = Depends(get_db),
) -> FleetVehicleRead:
    result = await FleetService(db).create_fleet_vehicle(payload)
    await db.commit()
    return result


@router.get(
    "/{fleet_id}/route-stops",
    response_model=FleetRouteStopsResponse,
    summary="Return ordered route stops for driver position simulation",
)
async def get_fleet_route_stops(
    fleet_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> FleetRouteStopsResponse:
    """Return stops for the fleet vehicle's active session, ordered by sequence.

    cumulative_km is computed from haversine distances between consecutive stops,
    allowing the frontend to interpolate the driver's position.
    """
    fv = await db.get(FleetVehicle, fleet_id)
    if fv is None:
        return FleetRouteStopsResponse(stops=[])

    # Find active session linked to this fleet vehicle
    stmt = (
        select(ConsolidationSession)
        .where(
            ConsolidationSession.fleet_vehicle_id == fleet_id,
            ConsolidationSession.status.in_(("confirmed", "dispatched")),
        )
        .order_by(ConsolidationSession.created_at.desc())
        .limit(1)
    )
    session = (await db.execute(stmt)).scalars().first()
    if session is None or fv.simulation_started_at is None:
        return FleetRouteStopsResponse(stops=[])

    # Load route stops ordered by sequence
    stops_stmt = (
        select(RouteStop)
        .where(RouteStop.session_id == session.id)
        .order_by(RouteStop.sequence_order)
    )
    stops = list((await db.execute(stops_stmt)).scalars().all())

    if not stops:
        return FleetRouteStopsResponse(
            session_id=session.id,
            simulation_started_at=fv.simulation_started_at,
            stops=[],
        )

    # Build entries with cumulative_km
    entries: list[RouteStopSimEntry] = []
    cumulative = 0.0
    prev_lat: float | None = None
    prev_lon: float | None = None

    for i, stop in enumerate(stops):
        try:
            lat, lon = lat_lon_from_geometry(stop.location)
        except Exception:
            continue
        if prev_lat is not None and prev_lon is not None:
            cumulative += haversine_km(prev_lon, prev_lat, lon, lat)
        entries.append(RouteStopSimEntry(
            sequence=i,
            lat=lat,
            lon=lon,
            address_label=stop.address_label,
            stop_type=stop.stop_type,
            cumulative_km=round(cumulative, 3),
        ))
        prev_lat = lat
        prev_lon = lon

    return FleetRouteStopsResponse(
        session_id=session.id,
        simulation_started_at=fv.simulation_started_at,
        stops=entries,
    )


@router.get("/{fleet_id}", response_model=FleetVehicleRead, summary="Get fleet vehicle")
async def get_fleet_vehicle(
    fleet_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> FleetVehicleRead:
    return await FleetService(db).get_fleet_vehicle(fleet_id)


@router.put("/{fleet_id}", response_model=FleetVehicleRead, summary="Update fleet vehicle")
async def update_fleet_vehicle(
    fleet_id: UUID,
    payload: FleetVehicleUpdate,
    db: AsyncSession = Depends(get_db),
) -> FleetVehicleRead:
    result = await FleetService(db).update_fleet_vehicle(fleet_id, payload)
    await db.commit()
    return result


@router.put(
    "/{fleet_id}/end-trip",
    response_model=FleetVehicleRead,
    summary="End active trip and reset vehicle to idle",
)
async def end_fleet_trip(
    fleet_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> FleetVehicleRead:
    result = await FleetService(db).end_trip(fleet_id)
    await db.commit()
    return result


@router.delete(
    "/{fleet_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    summary="Delete (or retire) fleet vehicle",
)
async def delete_fleet_vehicle(
    fleet_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    await FleetService(db).delete_fleet_vehicle(fleet_id)
    await db.commit()
