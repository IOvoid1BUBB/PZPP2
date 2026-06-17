"""Fleet vehicle CRUD service."""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, ValidationAppError
from app.models.fleet_vehicle import FleetVehicle
from app.models.session import ConsolidationSession
from app.models.stop import RouteStop
from app.models.vehicle import Vehicle
from app.schemas.fleet import FleetVehicleCreate, FleetVehicleRead, FleetVehicleUpdate


class FleetService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def list_fleet(self) -> list[FleetVehicleRead]:
        stmt = (
            select(FleetVehicle)
            .where(FleetVehicle.status != "retired")
            .order_by(FleetVehicle.created_at)
        )
        result = await self._db.execute(stmt)
        vehicles = list(result.scalars().all())
        return [await self._to_read(v) for v in vehicles]

    async def get_fleet_vehicle(self, fleet_id: UUID) -> FleetVehicleRead:
        fv = await self._load(fleet_id)
        return await self._to_read(fv)

    async def create_fleet_vehicle(self, payload: FleetVehicleCreate) -> FleetVehicleRead:
        # Validate type_id exists
        vt = await self._db.get(Vehicle, payload.type_id)
        if vt is None:
            raise NotFoundError(f"VehicleType {payload.type_id} not found.")

        fv = FleetVehicle(
            type_id=payload.type_id,
            registration=payload.registration,
            display_name=payload.display_name,
            status="idle",
            home_lat=payload.home_lat,
            home_lon=payload.home_lon,
        )
        self._db.add(fv)
        await self._db.flush()
        await self._db.refresh(fv)
        return await self._to_read(fv)

    async def update_fleet_vehicle(
        self, fleet_id: UUID, patch: FleetVehicleUpdate
    ) -> FleetVehicleRead:
        fv = await self._load(fleet_id)

        if patch.registration is not None:
            fv.registration = patch.registration
        if patch.display_name is not None:
            fv.display_name = patch.display_name
        if patch.status is not None:
            allowed = {"idle", "in_route", "maintenance", "retired"}
            if patch.status not in allowed:
                raise ValidationAppError(f"Invalid status '{patch.status}'.")
            fv.status = patch.status
        if patch.home_lat is not None:
            fv.home_lat = patch.home_lat
        if patch.home_lon is not None:
            fv.home_lon = patch.home_lon

        await self._db.flush()
        await self._db.refresh(fv)
        return await self._to_read(fv)

    async def end_trip(self, fleet_id: UUID) -> FleetVehicleRead:
        """End an active trip: reset vehicle to idle and clear simulation anchor."""
        fv = await self._load(fleet_id)
        fv.status = "idle"
        fv.simulation_started_at = None
        await self._db.flush()
        await self._db.refresh(fv)
        return await self._to_read(fv)

    async def delete_fleet_vehicle(self, fleet_id: UUID) -> None:
        fv = await self._load(fleet_id)

        # Check for active sessions referencing this vehicle
        active_stmt = (
            select(ConsolidationSession)
            .where(
                ConsolidationSession.fleet_vehicle_id == fleet_id,
                ConsolidationSession.status.in_(("draft", "optimizing", "confirmed", "dispatched")),
            )
            .limit(1)
        )
        active = (await self._db.execute(active_stmt)).scalars().first()
        if active is not None:
            # Soft delete — mark as retired
            fv.status = "retired"
            await self._db.flush()
        else:
            await self._db.delete(fv)
            await self._db.flush()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _load(self, fleet_id: UUID) -> FleetVehicle:
        fv = await self._db.get(FleetVehicle, fleet_id)
        if fv is None:
            raise NotFoundError(f"Fleet vehicle {fleet_id} not found.")
        return fv

    async def _to_read(self, fv: FleetVehicle) -> FleetVehicleRead:
        vt: Vehicle = fv.vehicle_type  # joined load

        # Find active session (optimizing / confirmed / dispatched)
        active_session_stmt = (
            select(ConsolidationSession)
            .where(
                ConsolidationSession.fleet_vehicle_id == fv.id,
                ConsolidationSession.status.in_(("optimizing", "confirmed", "dispatched")),
            )
            .order_by(ConsolidationSession.created_at.desc())
            .limit(1)
        )
        active_session = (
            await self._db.execute(active_session_stmt)
        ).scalars().first()

        current_lat: Decimal | None = None
        current_lon: Decimal | None = None
        current_session_id = None

        if active_session is not None:
            current_session_id = active_session.id
            # Find last delivery stop in the session, extract lat/lon from geometry
            last_stop_stmt = (
                select(
                    func.ST_Y(RouteStop.location).label("lat"),
                    func.ST_X(RouteStop.location).label("lon"),
                )
                .where(
                    RouteStop.session_id == active_session.id,
                    RouteStop.stop_type == "delivery",
                )
                .order_by(RouteStop.sequence_order.desc())
                .limit(1)
            )
            last_stop_row = (await self._db.execute(last_stop_stmt)).first()
            if last_stop_row is not None:
                current_lat = Decimal(str(last_stop_row.lat))
                current_lon = Decimal(str(last_stop_row.lon))

        # Fall back to home location if no active position
        if current_lat is None:
            current_lat = Decimal(str(fv.home_lat)) if fv.home_lat is not None else None
            current_lon = Decimal(str(fv.home_lon)) if fv.home_lon is not None else None

        return FleetVehicleRead(
            id=fv.id,
            type_id=vt.id,
            type_key=vt.type,
            type_name=vt.name,
            registration=fv.registration,
            display_name=fv.display_name,
            status=fv.status,
            max_ldm=Decimal(str(vt.max_ldm)),
            max_weight_kg=vt.max_weight_kg,
            trailer_length_cm=vt.trailer_length_cm,
            trailer_width_cm=vt.trailer_width_cm,
            payload_slots=vt.payload_slots,
            home_lat=Decimal(str(fv.home_lat)) if fv.home_lat is not None else None,
            home_lon=Decimal(str(fv.home_lon)) if fv.home_lon is not None else None,
            current_lat=current_lat,
            current_lon=current_lon,
            current_session_id=current_session_id,
            created_at=fv.created_at,
            simulation_started_at=fv.simulation_started_at,
        )
