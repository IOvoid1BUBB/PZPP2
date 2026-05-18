"""Service layer for :class:`ConsolidationSession`."""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings, get_settings
from app.core.exceptions import AppException, NotFoundError, ValidationAppError
from app.lib.geo import geo_point_from_geometry, lat_lon_from_geometry
from app.lib.osrm import OSRMClient, get_osrm_client
from app.models import ConsolidationSession, MarketOffer, RouteStop, Vehicle
from app.schemas.session import (
    OfferInSession,
    SessionCreate,
    SessionFullResponse,
    SessionMetrics,
    SessionStatus,
    StopResponse,
    VehicleResponse,
)
from app.services.stop_cost import StopCostCalculator

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
        osrm: OSRMClient | None = None,
        settings: Settings | None = None,
        stop_cost_calculator: StopCostCalculator | None = None,
    ) -> None:
        self._db = db
        self._osrm = osrm or get_osrm_client()
        self._settings = settings or get_settings()
        self._stop_costs = stop_cost_calculator or StopCostCalculator(self._settings)

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
        instance = ConsolidationSession(
            vehicle_id=payload.vehicle_id,
            status="draft",
            origin_lon=payload.origin_lon,
            origin_lat=payload.origin_lat,
            target_region_bbox=payload.target_region_bbox,
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

    async def add_offer(self, session_id: UUID, offer_id: UUID) -> SessionFullResponse:
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
        pickup_stop = RouteStop(
            session_id=session_id,
            offer_id=offer_id,
            stop_type="pickup",
            sequence_order=next_sequence,
            location=offer.pickup_point,
        )
        delivery_stop = RouteStop(
            session_id=session_id,
            offer_id=offer_id,
            stop_type="delivery",
            sequence_order=next_sequence + 1,
            location=offer.delivery_point,
        )
        self._db.add(pickup_stop)
        self._db.add(delivery_stop)
        await self._db.flush()

        await self._recalculate_route_stops(session)
        await self._db.refresh(session)
        return await self._build_full_response(session)

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

    async def update_status(
        self,
        session_id: UUID,
        new_status: SessionStatus,
    ) -> SessionFullResponse:
        session = await self.get(session_id)
        allowed_next = _ALLOWED_TRANSITIONS.get(session.status)
        if allowed_next != new_status:
            raise ValidationAppError("forbidden status transition")
        session.status = new_status
        await self._db.flush()
        await self._db.refresh(session)
        return await self._build_full_response(session)

    async def _load_session(self, session_id: UUID) -> ConsolidationSession | None:
        stmt = (
            select(ConsolidationSession)
            .where(ConsolidationSession.id == session_id)
            .options(
                selectinload(ConsolidationSession.vehicle),
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

        route = await self._osrm.get_route_multi(waypoints)

        cumulative_minutes = 0
        for index, stop in enumerate(stops):
            if index < len(route.legs):
                cumulative_minutes += route.legs[index].duration_minutes
            stop.eta_minutes_from_start = cumulative_minutes
            handling = None
            if stop.offer is not None:
                handling = stop.offer.handling_time_minutes
            stop.stop_cost_eur = self._stop_costs.calculate(handling)

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

        stop_responses = [self._stop_to_schema(stop) for stop in stops]
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
        route = await self._osrm.get_route_multi(waypoints)
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
        )
