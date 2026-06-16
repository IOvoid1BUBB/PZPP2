"""Service layer for :class:`ConsolidationSession`."""

from __future__ import annotations

from datetime import UTC, datetime
from collections.abc import Sequence
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings, get_settings
from app.core.exceptions import AppException, NotFoundError, ValidationAppError
from app.lib.geo import geo_point_from_geometry, lat_lon_from_geometry
from app.lib.routing import RoutingProvider, get_routing_provider
from app.lib.redis_client import get_redis
from app.models import ConsolidationSession, DriverProfile, MarketOffer, RouteStop, Vehicle
from app.models.fleet_vehicle import FleetVehicle
from app.schemas.driver_profile import DriverProfileRead
from app.schemas.session import (
    OfferInSession,
    SessionCreate,
    SessionFullResponse,
    SessionMetrics,
    SessionStatus,
    StopResponse,
    VehicleResponse,
)
from app.schemas.solver import StopSequenceEntry
from app.services.sequence_optimizer import SequenceOptimizerService, Stop
from app.services.stop_cost_calculator import (
    StopCostRates,
    calculate_stop_cost,
)
from app.services.stop_labels import ensure_stop_label

_ALLOWED_TRANSITIONS: dict[str, str] = {
    "draft": "optimizing",
    "optimizing": "confirmed",
    "confirmed": "dispatched",
}


class SessionService:
    """Consolidation session lifecycle, offer assignment, and route recalculation."""

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

    async def list_all(self, *, limit: int = 100, offset: int = 0) -> list[ConsolidationSession]:
        stmt = (
            select(ConsolidationSession)
            .order_by(ConsolidationSession.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self._db.execute(stmt)
        return list(result.scalars().all())

    async def get(self, session_id: UUID) -> ConsolidationSession:
        instance = await self._load_session(session_id)
        if instance is None:
            raise NotFoundError(f"Session {session_id} not found.")
        return instance

    async def create(self, payload: SessionCreate) -> ConsolidationSession:
        vehicle = await self._get_vehicle(payload.vehicle_id)
        _ = vehicle
        driver_profile = await self._get_driver_profile(payload.driver_profile_id)
        _ = driver_profile

        origin_lon = payload.origin_lon
        origin_lat = payload.origin_lat
        fleet_vehicle_id = payload.fleet_vehicle_id

        if fleet_vehicle_id is not None:
            fv = await self._db.get(FleetVehicle, fleet_vehicle_id)
            if fv is None:
                raise NotFoundError(f"Fleet vehicle {fleet_vehicle_id} not found.")
            if fv.type_id != vehicle.id:
                raise ValidationAppError(
                    "Fleet vehicle type does not match the selected vehicle type.",
                )
            if fv.home_lat is not None and fv.home_lon is not None:
                origin_lat = float(fv.home_lat)
                origin_lon = float(fv.home_lon)

        instance = ConsolidationSession(
            vehicle_id=payload.vehicle_id,
            driver_profile_id=payload.driver_profile_id,
            status="draft",
            origin_lon=origin_lon,
            origin_lat=origin_lat,
            target_region_bbox=payload.target_region_bbox,
            fleet_vehicle_id=fleet_vehicle_id,
        )
        self._db.add(instance)
        await self._db.flush()
        await self._db.refresh(instance)
        return instance

    async def delete(self, session_id: UUID) -> None:
        instance = await self.get(session_id)
        await self._db.delete(instance)
        await self._db.flush()

    async def get_full(self, session_id: UUID) -> SessionFullResponse:
        session = await self.get(session_id)
        return await self._build_full_response(session)

    async def add_offer(
        self,
        session_id: UUID,
        offer_id: UUID,
    ) -> tuple[SessionFullResponse, list[UUID]]:
        session = await self.get(session_id)
        self._ensure_draft(session)
        vehicle = await self._require_vehicle(session)
        offer = await self._get_offer(offer_id)

        existing_offer_ids = await self._session_offer_ids(session_id)
        if offer_id in existing_offer_ids:
            raise AppException(
                detail="Offer is already assigned to this session.",
                status_code=409,
                error_code="offer_already_in_session",
            )

        used_ldm, used_weight = await self._capacity_used(session_id, existing_offer_ids)
        offer_ldm = float(offer.ldm)
        offer_weight = int(offer.weight_kg)
        max_ldm = float(vehicle.max_ldm)
        max_weight = int(vehicle.max_weight_kg)

        if used_ldm + offer_ldm > max_ldm:
            raise AppException(
                detail="Insufficient loading meter capacity.",
                status_code=409,
                error_code="insufficient_ldm",
                context={
                    "free_ldm": round(max_ldm - used_ldm, 2),
                    "required_ldm": offer_ldm,
                },
            )
        if used_weight + offer_weight > max_weight:
            raise AppException(
                detail="Insufficient weight capacity.",
                status_code=409,
                error_code="insufficient_weight",
                context={
                    "free_weight_kg": max_weight - used_weight,
                    "required_weight_kg": offer_weight,
                },
            )

        next_sequence = len(existing_offer_ids) * 2
        pickup_stop, delivery_stop = self._create_stops_for_offer(
            session_id,
            offer,
            base_sequence=next_sequence,
        )
        self._db.add(pickup_stop)
        self._db.add(delivery_stop)
        await self._db.flush()
        new_stop_ids = [pickup_stop.id, delivery_stop.id]

        await self._recalculate_route_stops(session)
        await self._db.refresh(session)
        response = await self._build_full_response(session)
        return response, new_stop_ids

    async def remove_offer(self, session_id: UUID, offer_id: UUID) -> SessionFullResponse:
        session = await self.get(session_id)
        self._ensure_draft(session)

        existing_offer_ids = await self._session_offer_ids(session_id)
        if offer_id not in existing_offer_ids:
            raise NotFoundError(f"Offer {offer_id} is not in session {session_id}.")

        await self._db.execute(
            delete(RouteStop).where(
                RouteStop.session_id == session_id,
                RouteStop.offer_id == offer_id,
            ),
        )
        await self._db.flush()
        await self._resequence_stops(session_id)
        await self._recalculate_route_stops(session)
        await self._db.refresh(session)
        return await self._build_full_response(session)

    async def replace_offers(
        self,
        session_id: UUID,
        offer_ids: list[UUID],
    ) -> tuple[SessionFullResponse, list[UUID]]:
        session = await self.get(session_id)
        self._ensure_draft(session)
        vehicle = await self._require_vehicle(session)

        if not offer_ids:
            raise ValidationAppError("At least one offer_id is required.")

        offers = await self._get_offers(offer_ids)
        used_ldm = sum(float(o.ldm) for o in offers)
        used_weight = sum(int(o.weight_kg) for o in offers)
        max_ldm = float(vehicle.max_ldm)
        max_weight = int(vehicle.max_weight_kg)

        if used_ldm > max_ldm:
            raise AppException(
                detail="Insufficient loading meter capacity.",
                status_code=409,
                error_code="insufficient_ldm",
                context={
                    "free_ldm": round(max_ldm - 0, 2),
                    "required_ldm": round(used_ldm, 2),
                },
            )
        if used_weight > max_weight:
            raise AppException(
                detail="Insufficient weight capacity.",
                status_code=409,
                error_code="insufficient_weight",
                context={
                    "free_weight_kg": max_weight,
                    "required_weight_kg": used_weight,
                },
            )

        ordered_stops = await self._apply_offers_and_optimize_route(session_id, offer_ids)
        await self._db.refresh(session)
        response = await self._build_full_response(session)
        return response, [stop.id for stop in ordered_stops]

    async def update_status(
        self,
        session_id: UUID,
        new_status: SessionStatus,
        fleet_vehicle_id: UUID | None = None,
    ) -> SessionFullResponse:
        session = await self.get(session_id)

        # Idempotent: if already in the target status, return as-is
        if session.status == new_status:
            return await self._build_full_response(session)

        allowed_next = _ALLOWED_TRANSITIONS.get(session.status)
        if allowed_next != new_status:
            raise ValidationAppError("forbidden status transition")

        session.status = new_status

        # On confirm: link fleet vehicle (explicit or auto)
        if new_status == "confirmed" and session.fleet_vehicle_id is None:
            await self._link_fleet_vehicle_on_confirm(session, fleet_vehicle_id)

        # On dispatch: ensure linked fleet vehicle stays in_route
        if new_status == "dispatched" and session.fleet_vehicle_id is not None:
            fv = await self._db.get(FleetVehicle, session.fleet_vehicle_id)
            if fv is not None:
                fv.status = "in_route"

        await self._db.flush()
        await self._db.refresh(session)
        return await self._build_full_response(session)

    async def _link_fleet_vehicle_on_confirm(
        self,
        session: ConsolidationSession,
        fleet_vehicle_id: UUID | None,
    ) -> None:
        """Link session to a fleet vehicle on confirmation."""
        if session.vehicle_id is None:
            return

        if fleet_vehicle_id is not None:
            fv = await self._db.get(FleetVehicle, fleet_vehicle_id)
            if fv is None:
                raise NotFoundError(f"Fleet vehicle {fleet_vehicle_id} not found.")
            if fv.type_id != session.vehicle_id:
                raise ValidationAppError("Fleet vehicle type does not match session vehicle type.")
            if fv.status != "idle":
                raise ValidationAppError("Fleet vehicle is not idle.")
            fleet_vehicle = fv
        else:
            fleet_vehicle = await self._find_least_busy_idle_fleet_vehicle(session.vehicle_id)

        if fleet_vehicle is None:
            return

        fleet_vehicle.status = "in_route"
        fleet_vehicle.simulation_started_at = datetime.now(UTC)
        session.fleet_vehicle_id = fleet_vehicle.id
        await self._db.flush()

    async def _find_least_busy_idle_fleet_vehicle(
        self,
        vehicle_type_id: UUID,
    ) -> FleetVehicle | None:
        """Pick idle fleet vehicle of matching type with fewest active sessions."""
        stmt = (
            select(FleetVehicle)
            .where(
                FleetVehicle.type_id == vehicle_type_id,
                FleetVehicle.status == "idle",
            )
            .order_by(FleetVehicle.created_at)
        )
        candidates = list((await self._db.execute(stmt)).scalars().all())
        if not candidates:
            return None

        async def _active_session_count(fv_id: UUID) -> int:
            count_stmt = (
                select(func.count())
                .select_from(ConsolidationSession)
                .where(
                    ConsolidationSession.fleet_vehicle_id == fv_id,
                    ConsolidationSession.status.in_(("confirmed", "dispatched")),
                )
            )
            return int((await self._db.execute(count_stmt)).scalar_one())

        scored: list[tuple[int, FleetVehicle]] = []
        for fv in candidates:
            scored.append((await _active_session_count(fv.id), fv))

        scored.sort(key=lambda item: (item[0], item[1].created_at))
        return scored[0][1]

    async def _auto_link_fleet_vehicle(self, session: ConsolidationSession) -> None:
        """Deprecated alias — kept for internal callers."""
        await self._link_fleet_vehicle_on_confirm(session, None)

    async def _load_session(self, session_id: UUID) -> ConsolidationSession | None:
        stmt = (
            select(ConsolidationSession)
            .where(ConsolidationSession.id == session_id)
            .options(
                selectinload(ConsolidationSession.vehicle),
                selectinload(ConsolidationSession.driver_profile),
                selectinload(ConsolidationSession.route_stops).selectinload(RouteStop.offer),
            )
        )
        result = await self._db.execute(stmt)
        return result.scalar_one_or_none()

    async def _get_vehicle(self, vehicle_id: UUID) -> Vehicle:
        result = await self._db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))
        vehicle = result.scalar_one_or_none()
        if vehicle is None:
            raise NotFoundError(f"Vehicle {vehicle_id} not found.")
        return vehicle

    async def _get_driver_profile(self, driver_profile_id: UUID) -> DriverProfile:
        result = await self._db.execute(
            select(DriverProfile).where(DriverProfile.id == driver_profile_id),
        )
        profile = result.scalar_one_or_none()
        if profile is None:
            raise NotFoundError(f"Driver profile {driver_profile_id} not found.")
        return profile

    async def _require_driver_profile(self, session: ConsolidationSession) -> DriverProfile:
        if session.driver_profile is not None:
            return session.driver_profile
        return await self._get_driver_profile(session.driver_profile_id)

    async def _require_vehicle(self, session: ConsolidationSession) -> Vehicle:
        if session.vehicle_id is None:
            raise ValidationAppError("Session has no vehicle assigned.")
        if session.vehicle is not None:
            return session.vehicle
        return await self._get_vehicle(session.vehicle_id)

    async def _get_offer(self, offer_id: UUID) -> MarketOffer:
        result = await self._db.execute(select(MarketOffer).where(MarketOffer.id == offer_id))
        offer = result.scalar_one_or_none()
        if offer is None:
            raise NotFoundError(f"Offer {offer_id} not found.")
        return offer

    async def _get_offers(self, offer_ids: list[UUID]) -> list[MarketOffer]:
        stmt = select(MarketOffer).where(MarketOffer.id.in_(offer_ids))
        result = await self._db.execute(stmt)
        offers_by_id = {o.id: o for o in result.scalars().all()}
        missing = [oid for oid in offer_ids if oid not in offers_by_id]
        if missing:
            raise NotFoundError(f"Offer {missing[0]} not found.")
        return [offers_by_id[oid] for oid in offer_ids]

    @staticmethod
    def _create_stops_for_offer(
        session_id: UUID,
        offer: MarketOffer,
        *,
        base_sequence: int,
    ) -> tuple[RouteStop, RouteStop]:
        pickup_stop = RouteStop(
            session_id=session_id,
            offer_id=offer.id,
            stop_type="pickup",
            sequence_order=base_sequence,
            location=offer.pickup_point,
        )
        delivery_stop = RouteStop(
            session_id=session_id,
            offer_id=offer.id,
            stop_type="delivery",
            sequence_order=base_sequence + 1,
            location=offer.delivery_point,
        )
        return pickup_stop, delivery_stop

    async def _apply_offers_and_optimize_route(
        self,
        session_id: UUID,
        offer_ids: list[UUID],
    ) -> list[RouteStop]:
        session = await self.get(session_id)
        if session.origin_lat is None or session.origin_lon is None:
            raise ValidationAppError("Session origin coordinates are not set.")

        await self._db.execute(
            delete(RouteStop).where(RouteStop.session_id == session_id),
        )
        await self._db.flush()

        offers = await self._get_offers(offer_ids)
        route_stops: list[RouteStop] = []
        for index, offer in enumerate(offers):
            pickup_stop, delivery_stop = self._create_stops_for_offer(
                session_id,
                offer,
                base_sequence=index * 2,
            )
            self._db.add(pickup_stop)
            self._db.add(delivery_stop)
            route_stops.extend([pickup_stop, delivery_stop])
        await self._db.flush()

        if not route_stops:
            return []

        stmt = (
            select(RouteStop)
            .where(RouteStop.session_id == session_id)
            .options(selectinload(RouteStop.offer))
        )
        result = await self._db.execute(stmt)
        db_stops = list(result.scalars().all())
        stops = self._build_stops_from_route_stops(db_stops)

        origin = (float(session.origin_lat), float(session.origin_lon))
        waypoints = [origin] + [stop.location for stop in stops]
        matrix = await self._routing.get_distance_matrix(waypoints)

        optimizer = SequenceOptimizerService()
        await optimizer.optimize_and_persist(
            self._db,
            session_id,
            stops,
            matrix=matrix,
        )

        await self._recalculate_route_stops(session)

        stmt = (
            select(RouteStop)
            .where(RouteStop.session_id == session_id)
            .order_by(RouteStop.sequence_order)
            .options(selectinload(RouteStop.offer))
        )
        result = await self._db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    def _build_stops_from_route_stops(route_stops: list[RouteStop]) -> list[Stop]:
        ordered = sorted(route_stops, key=lambda s: s.sequence_order)
        stops: list[Stop] = []
        for stop in ordered:
            handling = 30
            if stop.offer is not None and stop.offer.handling_time_minutes is not None:
                handling = stop.offer.handling_time_minutes
            stops.append(
                Stop(
                    id=str(stop.id),
                    offer_id=stop.offer_id,
                    stop_type=stop.stop_type,  # type: ignore[arg-type]
                    location=lat_lon_from_geometry(stop.location),
                    handling_time_minutes=handling,
                ),
            )
        return stops

    @staticmethod
    def serialize_stop_sequence(route_stops: list[RouteStop]) -> list[StopSequenceEntry]:
        ordered = sorted(route_stops, key=lambda s: s.sequence_order)
        return [
            StopSequenceEntry(
                route_stop_id=stop.id,
                offer_id=stop.offer_id,
                stop_type=stop.stop_type,  # type: ignore[arg-type]
                sequence_order=index,
            )
            for index, stop in enumerate(ordered)
        ]

    @staticmethod
    def _ensure_draft(session: ConsolidationSession) -> None:
        if session.status != "draft":
            raise ValidationAppError(
                "Offers can only be modified while session is in draft status.",
            )

    async def _session_offer_ids(self, session_id: UUID) -> list[UUID]:
        stmt = (
            select(RouteStop.offer_id, RouteStop.sequence_order)
            .where(
                RouteStop.session_id == session_id,
                RouteStop.stop_type == "pickup",
            )
            .order_by(RouteStop.sequence_order)
        )
        result = await self._db.execute(stmt)
        return [row[0] for row in result.all()]

    async def _capacity_used(
        self,
        session_id: UUID,
        offer_ids: Sequence[UUID],
    ) -> tuple[float, int]:
        if not offer_ids:
            return 0.0, 0
        stmt = select(MarketOffer).where(MarketOffer.id.in_(offer_ids))
        result = await self._db.execute(stmt)
        offers = list(result.scalars().all())
        used_ldm = sum(float(o.ldm) for o in offers)
        used_weight = sum(int(o.weight_kg) for o in offers)
        return used_ldm, used_weight

    async def _resequence_stops(self, session_id: UUID) -> None:
        offer_ids = await self._session_offer_ids(session_id)
        stmt = select(RouteStop).where(RouteStop.session_id == session_id)
        result = await self._db.execute(stmt)
        stops_by_offer: dict[UUID, dict[str, RouteStop]] = {}
        for stop in result.scalars().all():
            stops_by_offer.setdefault(stop.offer_id, {})[stop.stop_type] = stop

        for index, offer_id in enumerate(offer_ids):
            pair = stops_by_offer.get(offer_id)
            if pair is None:
                continue
            pickup = pair.get("pickup")
            delivery = pair.get("delivery")
            if pickup is not None:
                pickup.sequence_order = index * 2
            if delivery is not None:
                delivery.sequence_order = index * 2 + 1
        await self._db.flush()

    async def _recalculate_route_stops(self, session: ConsolidationSession) -> None:
        stmt = (
            select(RouteStop)
            .where(RouteStop.session_id == session.id)
            .order_by(RouteStop.sequence_order)
            .options(selectinload(RouteStop.offer))
        )
        result = await self._db.execute(stmt)
        stops = list(result.scalars().all())

        if not stops:
            return

        if session.origin_lat is None or session.origin_lon is None:
            raise ValidationAppError("Session origin coordinates are not set.")

        origin = (float(session.origin_lat), float(session.origin_lon))
        waypoints: list[tuple[float, float]] = [origin]
        for stop in stops:
            waypoints.append(lat_lon_from_geometry(stop.location))

        route = await self._routing.get_route_multi(waypoints)

        driver_profile = await self._require_driver_profile(session)
        rates = StopCostRates.from_driver_profile(driver_profile)
        fuel_price = self._settings.FUEL_PRICE_EUR_PER_LITER

        cumulative_minutes = 0
        for index, stop in enumerate(stops):
            if index < len(route.legs):
                cumulative_minutes += route.legs[index].duration_minutes
            stop.eta_minutes_from_start = cumulative_minutes
            handling = None
            if stop.offer is not None:
                handling = stop.offer.handling_time_minutes
            handling = handling if handling is not None else self._settings.STOP_COST_MINUTES
            vehicle = session.vehicle
            if vehicle is None:
                raise ValidationAppError("Session vehicle is not set.")
            breakdown = calculate_stop_cost(
                handling,
                vehicle.type,
                rates=rates,
                fuel_price_eur_per_liter=fuel_price,
            )
            stop.stop_cost_eur = breakdown.total_eur

        session.total_revenue_eur = await self._total_revenue(session.id)
        fuel_cost = self._estimate_fuel_cost(route.total_distance_km, session)
        stop_cost_total = sum(float(s.stop_cost_eur or 0) for s in stops)
        revenue = float(session.total_revenue_eur or 0)
        session.net_profit_eur = round(revenue - fuel_cost - stop_cost_total, 2)
        await self._db.flush()

    async def _total_revenue(self, session_id: UUID) -> float:
        offer_ids = await self._session_offer_ids(session_id)
        if not offer_ids:
            return 0.0
        stmt = select(MarketOffer.price_eur).where(MarketOffer.id.in_(offer_ids))
        result = await self._db.execute(stmt)
        return sum(float(price) for price in result.scalars().all())

    def _estimate_fuel_cost(self, distance_km: float, session: ConsolidationSession) -> float:
        vehicle = session.vehicle
        if vehicle is None:
            return 0.0
        liters = distance_km * float(vehicle.fuel_per_100km_base) / 100.0
        return round(liters * self._settings.FUEL_PRICE_EUR_PER_LITER, 2)

    async def _build_full_response(self, session: ConsolidationSession) -> SessionFullResponse:
        loaded = await self._load_session(session.id)
        if loaded is None:
            raise NotFoundError(f"Session {session.id} not found.")
        session = loaded

        vehicle = await self._require_vehicle(session)
        driver_profile = await self._require_driver_profile(session)
        stops = sorted(session.route_stops, key=lambda s: s.sequence_order)
        offer_ids = await self._session_offer_ids(session.id)

        offers: list[OfferInSession] = []
        if offer_ids:
            stmt = select(MarketOffer).where(MarketOffer.id.in_(offer_ids))
            result = await self._db.execute(stmt)
            offers_by_id = {o.id: o for o in result.scalars().all()}
            for offer_id in offer_ids:
                offer = offers_by_id.get(offer_id)
                if offer is not None:
                    offers.append(self._offer_to_schema(offer))

        redis = get_redis()
        stop_responses: list[StopResponse] = []
        for stop in stops:
            await ensure_stop_label(self._db, stop, redis=redis)
            stop_responses.append(self._stop_to_schema(stop))
        total_distance_km = await self._route_distance_km(session, stops)
        metrics = self._compute_metrics(
            session,
            vehicle,
            offers,
            stops,
            total_distance_km=total_distance_km,
        )

        return SessionFullResponse(
            id=session.id,
            status=session.status,  # type: ignore[arg-type]
            vehicle=VehicleResponse.model_validate(vehicle),
            driver_profile=DriverProfileRead.model_validate(driver_profile),
            offers=offers,
            stops=stop_responses,
            metrics=metrics,
            created_at=session.created_at,
        )

    async def _route_distance_km(
        self,
        session: ConsolidationSession,
        stops: list[RouteStop],
    ) -> float:
        if not stops or session.origin_lat is None or session.origin_lon is None:
            return 0.0
        origin = (float(session.origin_lat), float(session.origin_lon))
        waypoints: list[tuple[float, float]] = [origin]
        for stop in stops:
            waypoints.append(lat_lon_from_geometry(stop.location))
        route = await self._routing.get_route_multi(waypoints)
        return route.total_distance_km

    def _compute_metrics(
        self,
        session: ConsolidationSession,
        vehicle: Vehicle,
        offers: list[OfferInSession],
        stops: list[RouteStop],
        *,
        total_distance_km: float,
    ) -> SessionMetrics:
        used_ldm = sum(float(o.ldm) for o in offers)
        max_ldm = float(vehicle.max_ldm)
        used_weight = sum(o.weight_kg for o in offers)
        max_weight = int(vehicle.max_weight_kg)
        fill_pct = round((used_ldm / max_ldm) * 100, 2) if max_ldm > 0 else 0.0
        weight_pct = round((used_weight / max_weight) * 100, 2) if max_weight > 0 else 0.0

        stop_costs = sum(float(s.stop_cost_eur or 0) for s in stops)
        revenue = sum(float(o.price_eur) for o in offers)
        fuel_cost = self._estimate_fuel_cost(total_distance_km, session)
        estimated_profit: float | None = None
        if offers:
            estimated_profit = round(revenue - fuel_cost - stop_costs, 2)

        return SessionMetrics(
            used_ldm=round(used_ldm, 2),
            fill_pct=fill_pct,
            used_weight_kg=used_weight,
            weight_pct=weight_pct,
            total_distance_km=round(total_distance_km, 3),
            estimated_net_profit_eur=estimated_profit,
            stop_count=len(stops),
            client_count=len(offers),
            stop_costs_eur=round(stop_costs, 4),
        )

    @staticmethod
    def _offer_to_schema(offer: MarketOffer) -> OfferInSession:
        return OfferInSession(
            id=offer.id,
            pickup=geo_point_from_geometry(offer.pickup_point),
            delivery=geo_point_from_geometry(offer.delivery_point),
            ldm=Decimal(str(offer.ldm)),
            weight_kg=int(offer.weight_kg),
            price_eur=Decimal(str(offer.price_eur)),
            time_window_open=offer.time_window_open,
            time_window_close=offer.time_window_close,
            handling_time_minutes=offer.handling_time_minutes,
            stackable=bool(offer.stackable),
            is_within_corridor=bool(offer.is_within_corridor),
            pickup_label=offer.pickup_label,
            delivery_label=offer.delivery_label,
            shipper_company=offer.shipper_company,
        )

    @staticmethod
    def _stop_to_schema(stop: RouteStop) -> StopResponse:
        location = geo_point_from_geometry(stop.location)
        return StopResponse(
            id=stop.id,
            session_id=stop.session_id,
            offer_id=stop.offer_id,
            stop_type=stop.stop_type,  # type: ignore[arg-type]
            sequence_order=stop.sequence_order,
            location=location,
            eta_minutes_from_start=stop.eta_minutes_from_start,
            stop_cost_eur=(
                Decimal(str(stop.stop_cost_eur)) if stop.stop_cost_eur is not None else None
            ),
            address_label=stop.address_label,
        )
