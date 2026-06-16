"""Idempotent seed helper for dashboard integration tests and local dev."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.lib.geo import point_from_lon_lat
from app.models import ConsolidationSession, DriverProfile, MarketOffer, RouteStop, Vehicle
from app.services.dashboard_helpers import today_bounds

logger = logging.getLogger(__name__)

DEFAULT_TARGET_COUNT = 20
_ORIGIN_LON = 21.0
_ORIGIN_LAT = 52.0
_BBOX = [14.0, 49.0, 24.0, 55.0]

_STATUS_PLAN: tuple[str, ...] = (
    "draft",
    "draft",
    "draft",
    "draft",
    "draft",
    "draft",
    "draft",
    "draft",
    "draft",
    "draft",
    "optimizing",
    "optimizing",
    "optimizing",
    "confirmed",
    "confirmed",
    "draft",
    "draft",
    "draft",
    "draft",
    "draft",
)


async def count_today_sessions(session: AsyncSession) -> int:
    """Return how many consolidation sessions were created today."""
    settings = get_settings()
    day_start, day_end = today_bounds(settings.APP_TIMEZONE)
    result = await session.scalar(
        select(func.count())
        .select_from(ConsolidationSession)
        .where(
            ConsolidationSession.created_at >= day_start,
            ConsolidationSession.created_at < day_end,
        ),
    )
    return int(result or 0)


async def seed_dashboard_sessions(
    session: AsyncSession,
    *,
    target_count: int = DEFAULT_TARGET_COUNT,
) -> int:
    """Ensure at least ``target_count`` dashboard sessions exist for today.

    Returns the number of sessions created in this run (0 when already seeded).
    """
    existing = await count_today_sessions(session)
    if existing >= target_count:
        logger.info(
            "Dashboard seed skipped: %s sessions already exist for today (target=%s)",
            existing,
            target_count,
        )
        return 0

    vehicle = await session.scalar(select(Vehicle).order_by(Vehicle.name).limit(1))
    profile = await session.scalar(select(DriverProfile).order_by(DriverProfile.code).limit(1))
    if vehicle is None or profile is None:
        raise RuntimeError("seed vehicles and driver profiles required before dashboard seed")

    offers = list(
        await session.scalars(select(MarketOffer).order_by(MarketOffer.id).limit(30)),
    )
    if not offers:
        raise RuntimeError("seed market offers required before dashboard seed")

    to_create = target_count - existing
    now = datetime.now(UTC)
    created = 0

    for index in range(to_create):
        status = _STATUS_PLAN[index % len(_STATUS_PLAN)]
        with_offers = index >= 5 and index < 15

        consolidation = ConsolidationSession(
            vehicle_id=vehicle.id,
            driver_profile_id=profile.id,
            status=status,
            origin_lon=_ORIGIN_LON + index * 0.01,
            origin_lat=_ORIGIN_LAT + index * 0.005,
            target_region_bbox=_BBOX,
            created_at=now - timedelta(minutes=index),
        )
        session.add(consolidation)
        await session.flush()

        if with_offers:
            offer = offers[index % len(offers)]
            pickup = RouteStop(
                session_id=consolidation.id,
                offer_id=offer.id,
                stop_type="pickup",
                sequence_order=0,
                location=offer.pickup_point,
                eta_minutes_from_start=30 + index * 5,
                address_label=f"Pickup hub {index}",
            )
            delivery = RouteStop(
                session_id=consolidation.id,
                offer_id=offer.id,
                stop_type="delivery",
                sequence_order=1,
                location=offer.delivery_point,
                eta_minutes_from_start=90 + index * 5,
                address_label=f"Delivery hub {index}",
            )
            session.add(pickup)
            session.add(delivery)

            revenue = float(offer.price_eur)
            consolidation.total_revenue_eur = Decimal(str(round(revenue, 2)))
            consolidation.net_profit_eur = Decimal(str(round(revenue * 0.6, 2)))

        if index == 15 and offers:
            risk_offer = MarketOffer(
                pickup_point=offers[0].pickup_point,
                delivery_point=offers[0].delivery_point,
                ldm=Decimal("1.2"),
                weight_kg=400,
                price_eur=Decimal("450.00"),
                time_window_open=now + timedelta(hours=1),
                time_window_close=now + timedelta(hours=2),
                handling_time_minutes=30,
                stackable=True,
            )
            session.add(risk_offer)
            await session.flush()

            session.add(
                RouteStop(
                    session_id=consolidation.id,
                    offer_id=risk_offer.id,
                    stop_type="pickup",
                    sequence_order=2,
                    location=risk_offer.pickup_point,
                    eta_minutes_from_start=240,
                    address_label="Risk pickup",
                ),
            )
            session.add(
                RouteStop(
                    session_id=consolidation.id,
                    offer_id=risk_offer.id,
                    stop_type="delivery",
                    sequence_order=3,
                    location=risk_offer.delivery_point,
                    eta_minutes_from_start=300,
                    address_label="Risk delivery",
                ),
            )

        created += 1

    await session.commit()
    logger.info("Dashboard seed created %s sessions for today", created)
    return created
