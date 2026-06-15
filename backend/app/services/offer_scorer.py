"""Deterministic multi-criteria offer scoring for consolidation sessions."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from typing import TYPE_CHECKING
from uuid import UUID

from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError, ValidationAppError
from app.lib.geo import haversine_km, lat_lon_from_geometry
from app.lib.routing import RoutingProvider, get_routing_provider
from app.lib.redis_client import get_redis
from app.lib.regional_p90 import get_regional_p90
from app.models import ConsolidationSession, MarketOffer, RouteStop, Vehicle
from app.schemas.offer import OfferScore, RankedOffersResponse
from app.services.offer_detour import (
    COST_PER_KM_EUR,
    MAX_DETOUR_KM,
    calculate_added_detour,
    haversine_added_detour_km,
)

if TYPE_CHECKING:
    pass

_logger = logging.getLogger("offer.scorer")

WEIGHT_REVENUE = 0.40
WEIGHT_DETOUR = 0.30
WEIGHT_FILL = 0.20
WEIGHT_TIME_WINDOW = 0.10

REORDER_SLACK_AFTER_CLOSE_MINUTES = 60
MAX_WAIT_BEFORE_WINDOW_MINUTES = 180


@dataclass(frozen=True)
class SessionScoringContext:
    """Precomputed session state shared across many offer scores."""

    used_ldm: float
    baseline_km: float
    waypoints: list[tuple[float, float]]
    reference_eta: datetime | None
    pickup_eta_minutes: int | None


def compute_fill_contribution_score(offer_ldm: float, free_ldm: float) -> float:
    """Fill contribution in ``[0, 1]`` (0 when no free LDM)."""
    if free_ldm <= 0:
        return 0.0
    return round(min(1.0, offer_ldm / free_ldm), 4)


def compute_revenue_density_score(
    price_eur: float,
    ldm: float,
    p90_price_per_ldm: float,
) -> float:
    """Revenue density relative to regional P90 €/LDM."""
    if ldm <= 0 or p90_price_per_ldm <= 0:
        return 0.0
    ratio = (price_eur / ldm) / p90_price_per_ldm
    return round(min(1.0, ratio), 4)


def compute_detour_penalty_score(added_km: float) -> float:
    """Detour penalty in ``[-0.5, 1]``."""
    raw = 1.0 - (added_km / MAX_DETOUR_KM)
    return round(max(-0.5, raw), 4)


def compute_total_score(
    revenue_density_score: float,
    detour_penalty_score: float,
    fill_contribution_score: float,
    time_window_score: float,
) -> float:
    """Weighted total score rounded to 4 decimals."""
    total = (
        WEIGHT_REVENUE * revenue_density_score
        + WEIGHT_DETOUR * detour_penalty_score
        + WEIGHT_FILL * fill_contribution_score
        + WEIGHT_TIME_WINDOW * time_window_score
    )
    return round(total, 4)


def _parse_hhmm(value: str) -> time:
    hour_str, minute_str = value.split(":", 1)
    return time(hour=int(hour_str), minute=int(minute_str))


def calculate_time_window_score(
    window_open: datetime | None,
    window_close: datetime | None,
    eta_at_pickup: datetime | None,
    *,
    handling_minutes: int = 30,
) -> float:
    """Time-window compatibility: 1.0 ok, 0.5 reorder, 0.0 hard conflict."""
    if window_open is None or window_close is None:
        return 1.0
    if eta_at_pickup is None:
        return 1.0

    if eta_at_pickup.tzinfo is None:
        eta_at_pickup = eta_at_pickup.replace(tzinfo=UTC)
    if window_open.tzinfo is None:
        window_open = window_open.replace(tzinfo=UTC)
    if window_close.tzinfo is None:
        window_close = window_close.replace(tzinfo=UTC)

    service_end = eta_at_pickup + timedelta(minutes=handling_minutes)
    slack_close = window_close + timedelta(minutes=REORDER_SLACK_AFTER_CLOSE_MINUTES)

    if eta_at_pickup > slack_close or service_end > slack_close:
        return 0.0

    if eta_at_pickup > window_close or service_end > window_close:
        return 0.5

    if eta_at_pickup < window_open:
        wait_minutes = (window_open - eta_at_pickup).total_seconds() / 60.0
        if wait_minutes <= MAX_WAIT_BEFORE_WINDOW_MINUTES:
            return 0.5
        return 0.0

    return 1.0


def calculate_time_window_score_from_strings(
    offer_window: str,
    session_eta: str,
    *,
    handling_minutes: int = 30,
) -> float:
    """Parse ``HH:MM-HH:MM`` window and ``HH:MM`` ETA for tests and tooling."""
    open_str, close_str = offer_window.split("-", 1)
    window_open = datetime.combine(datetime.min.date(), _parse_hhmm(open_str), tzinfo=UTC)
    window_close = datetime.combine(datetime.min.date(), _parse_hhmm(close_str), tzinfo=UTC)
    eta = datetime.combine(datetime.min.date(), _parse_hhmm(session_eta), tzinfo=UTC)
    return calculate_time_window_score(
        window_open,
        window_close,
        eta,
        handling_minutes=handling_minutes,
    )


def estimate_pickup_eta(
    reference_eta: datetime | None,
    waypoints: list[tuple[float, float]],
    pickup: tuple[float, float],
    *,
    average_speed_kmh: float = 60.0,
) -> datetime | None:
    """Estimate pickup arrival from reference ETA and haversine leg."""
    if reference_eta is None:
        return None
    if not waypoints:
        return reference_eta
    last = waypoints[-1]
    last_lat, last_lon = last[0], last[1]
    pick_lat, pick_lon = pickup[0], pickup[1]
    leg_km = haversine_km(last_lon, last_lat, pick_lon, pick_lat)
    travel_minutes = int((leg_km / average_speed_kmh) * 60) if average_speed_kmh > 0 else 0
    return reference_eta + timedelta(minutes=travel_minutes)


async def score_offer(
    offer: MarketOffer,
    session: ConsolidationSession,
    vehicle: Vehicle,
    routing_client: RoutingProvider,
    *,
    context: SessionScoringContext,
    redis: Redis | None = None,
    db: AsyncSession | None = None,
    p90_memory_cache: dict[str, float] | None = None,
    detour_km_override: float | None = None,
) -> OfferScore:
    """Score a single market offer against a consolidation session."""
    try:
        pickup = lat_lon_from_geometry(offer.pickup_point)
        delivery = lat_lon_from_geometry(offer.delivery_point)
        pickup_lat, pickup_lon = pickup[0], pickup[1]

        p90 = await get_regional_p90(
            pickup_lat,
            pickup_lon,
            redis=redis,
            db=db,
            memory_cache=p90_memory_cache,
        )
        revenue_score = compute_revenue_density_score(
            float(offer.price_eur),
            float(offer.ldm),
            p90,
        )

        if detour_km_override is not None:
            added_km = round(detour_km_override, 2)
        else:
            added_km = await calculate_added_detour(
                routing_client,
                context.baseline_km,
                context.waypoints,
                pickup,
                delivery,
            )

        detour_score = compute_detour_penalty_score(added_km)
        free_ldm = float(vehicle.max_ldm) - context.used_ldm
        fill_score = compute_fill_contribution_score(float(offer.ldm), free_ldm)

        eta_at_pickup = estimate_pickup_eta(
            context.reference_eta,
            context.waypoints,
            pickup,
        )
        handling = offer.handling_time_minutes if offer.handling_time_minutes is not None else 30
        tw_score = calculate_time_window_score(
            offer.time_window_open,
            offer.time_window_close,
            eta_at_pickup,
            handling_minutes=handling,
        )

        total = compute_total_score(revenue_score, detour_score, fill_score, tw_score)

        # Buduj label z adresu lub koordynatów
        pickup_label = f"{pickup_lat:.4f}°N, {pickup_lon:.4f}°E"
        delivery_label = f"{delivery[0]:.4f}°N, {delivery[1]:.4f}°E"

        return OfferScore(
            offer_id=offer.id,
            total_score=total,
            revenue_density_score=revenue_score,
            detour_penalty_score=detour_score,
            fill_contribution_score=fill_score,
            time_window_score=tw_score,
            added_km=added_km,
            estimated_added_cost_eur=round(added_km * COST_PER_KM_EUR, 4),
            ldm=offer.ldm,
            weight_kg=int(offer.weight_kg),
            price_eur=offer.price_eur,
            stackable=bool(offer.stackable),
            pickup_label=pickup_label,
            delivery_label=delivery_label,
        )
    except Exception as exc:
        _logger.exception(
            "Offer scoring failed; returning zero score",
            extra={"event": "offer:score:error", "offer_id": str(offer.id), "error": str(exc)},
        )
        return OfferScore(
            offer_id=offer.id,
            total_score=0.0,
            revenue_density_score=0.0,
            detour_penalty_score=0.0,
            fill_contribution_score=0.0,
            time_window_score=0.0,
            added_km=0.0,
            estimated_added_cost_eur=0.0,
            ldm=offer.ldm,
            weight_kg=int(offer.weight_kg),
            price_eur=offer.price_eur,
            stackable=bool(offer.stackable),
        )


class OfferScorerService:
    """Rank candidate market offers for a consolidation session."""

    def __init__(
        self,
        db: AsyncSession,
        *,
        routing: RoutingProvider | None = None,
        redis: Redis | None = None,
    ) -> None:
        self._db = db
        self._routing = routing or get_routing_provider()
        self._redis = redis if redis is not None else get_redis()

    async def rank_offers(
        self,
        session_id: UUID,
        *,
        limit: int = 50,
    ) -> RankedOffersResponse:
        """Score all eligible offers and return the top *limit* by total score."""
        session = await self._load_session(session_id)
        if session is None:
            raise NotFoundError(f"Session {session_id} not found.")
        if session.vehicle is None:
            raise ValidationAppError("Session has no vehicle assigned.")
        vehicle = session.vehicle

        context = await self._build_scoring_context(session)
        candidates = await self._fetch_candidate_offers(session)
        assigned_ids = {stop.offer_id for stop in session.route_stops if stop.stop_type == "pickup"}
        candidates = [o for o in candidates if o.id not in assigned_ids]

        p90_cache: dict[str, float] = {}
        detour_overrides = self._batch_haversine_detours(context.waypoints, candidates)

        scores = await asyncio.gather(
            *[
                score_offer(
                    offer,
                    session,
                    vehicle,
                    self._routing,
                    context=context,
                    redis=self._redis,
                    db=self._db,
                    p90_memory_cache=p90_cache,
                    detour_km_override=detour_overrides.get(offer.id),
                )
                for offer in candidates
            ],
        )

        ranked = sorted(scores, key=lambda s: (-s.total_score, str(s.offer_id)))[:limit]
        return RankedOffersResponse(
            session_id=session_id,
            limit=limit,
            scored_count=len(candidates),
            offers=ranked,
        )

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

    async def _build_scoring_context(self, session: ConsolidationSession) -> SessionScoringContext:
        stops = sorted(session.route_stops, key=lambda s: s.sequence_order)
        used_ldm = sum(
            float(stop.offer.ldm)
            for stop in stops
            if stop.stop_type == "pickup" and stop.offer is not None
        )

        waypoints: list[tuple[float, float]] = []
        if session.origin_lat is not None and session.origin_lon is not None:
            waypoints.append((float(session.origin_lat), float(session.origin_lon)))
        for stop in stops:
            waypoints.append(lat_lon_from_geometry(stop.location))

        baseline_km = 0.0
        if len(waypoints) >= 2:
            try:
                route = await self._routing.get_route_multi(waypoints)
                baseline_km = route.total_distance_km
            except Exception as exc:
                _logger.warning(
                    "Baseline route failed; haversine fallback",
                    extra={"event": "scorer:baseline:fallback", "error": str(exc)},
                )
                baseline_km = self._haversine_route_km(waypoints)

        reference_eta: datetime | None = None
        pickup_eta_minutes: int | None = None
        if stops:
            last_pickup_stop = next(
                (s for s in reversed(stops) if s.stop_type == "pickup"),
                None,
            )
            if last_pickup_stop is not None and last_pickup_stop.eta_minutes_from_start is not None:
                pickup_eta_minutes = last_pickup_stop.eta_minutes_from_start
                if session.created_at is not None:
                    reference_eta = session.created_at + timedelta(
                        minutes=pickup_eta_minutes,
                    )
        elif session.created_at is not None:
            reference_eta = session.created_at

        return SessionScoringContext(
            used_ldm=used_ldm,
            baseline_km=baseline_km,
            waypoints=waypoints,
            reference_eta=reference_eta,
            pickup_eta_minutes=pickup_eta_minutes,
        )

    async def _fetch_candidate_offers(self, session: ConsolidationSession) -> list[MarketOffer]:
        stmt = select(MarketOffer)
        bbox = session.target_region_bbox
        if bbox is not None and len(bbox) == 4:
            min_lon, min_lat, max_lon, max_lat = bbox
            envelope = func.ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
            stmt = stmt.where(func.ST_Within(MarketOffer.pickup_point, envelope))
        stmt = stmt.order_by(MarketOffer.id)
        result = await self._db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    def _haversine_route_km(waypoints: list[tuple[float, float]]) -> float:
        total = 0.0
        for i in range(len(waypoints) - 1):
            a_lat, a_lon = waypoints[i]
            b_lat, b_lon = waypoints[i + 1]
            total += haversine_km(a_lon, a_lat, b_lon, b_lat)
        return round(total, 3)

    @staticmethod
    def _batch_haversine_detours(
        waypoints: list[tuple[float, float]],
        offers: list[MarketOffer],
    ) -> dict[UUID, float]:
        """Precompute detour km via haversine to avoid N routing calls per request."""
        overrides: dict[UUID, float] = {}
        for offer in offers:
            pickup = lat_lon_from_geometry(offer.pickup_point)
            delivery = lat_lon_from_geometry(offer.delivery_point)
            overrides[offer.id] = round(
                haversine_added_detour_km(waypoints, pickup, delivery),
                2,
            )
        return overrides
