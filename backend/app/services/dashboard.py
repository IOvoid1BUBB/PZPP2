"""Aggregated dashboard metrics from consolidation sessions."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import ConsolidationSession, FleetVehicle, MarketOffer, RouteStop
from app.schemas.dashboard import DashboardKpi, DashboardResponse, DashboardSessionSummary

_OPERATIONAL_STATUSES = ("draft", "optimizing", "confirmed", "dispatched")


class DashboardService:
    """Build operational KPIs and recent session summaries."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_dashboard(self, *, recent_limit: int = 10) -> DashboardResponse:
        total_sessions = int(
            await self._db.scalar(select(func.count()).select_from(ConsolidationSession)) or 0,
        )

        has_offers = (
            select(RouteStop.id)
            .where(
                RouteStop.session_id == ConsolidationSession.id,
                RouteStop.offer_id.isnot(None),
            )
            .limit(1)
        )
        active_sessions = int(
            await self._db.scalar(
                select(func.count())
                .select_from(ConsolidationSession)
                .where(
                    ConsolidationSession.status.in_(("optimizing", "confirmed", "dispatched"))
                    | (
                        (ConsolidationSession.status == "draft")
                        & exists(has_offers).correlate(ConsolidationSession)
                    ),
                ),
            )
            or 0,
        )
        market_offers_count = int(
            await self._db.scalar(select(func.count()).select_from(MarketOffer)) or 0,
        )
        vehicles_in_route = int(
            await self._db.scalar(
                select(func.count())
                .select_from(FleetVehicle)
                .where(FleetVehicle.status == "in_route"),
            )
            or 0,
        )

        stmt = (
            select(ConsolidationSession)
            .options(
                selectinload(ConsolidationSession.vehicle),
                selectinload(ConsolidationSession.route_stops).selectinload(RouteStop.offer),
            )
            .order_by(ConsolidationSession.created_at.desc())
            .limit(recent_limit)
        )
        result = await self._db.execute(stmt)
        sessions = list(result.scalars().all())

        # KPI profit: only sum confirmed/dispatched sessions created today (UTC).
        today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)

        profit_values: list[float] = []
        fill_values: list[float] = []
        summaries: list[DashboardSessionSummary] = []

        for session in sessions:
            seen_offers: dict = {}
            for stop in session.route_stops:
                if stop.offer is not None and stop.offer_id not in seen_offers:
                    seen_offers[stop.offer_id] = stop.offer
            offers = list(seen_offers.values())
            unique_offer_ids = set(seen_offers.keys())
            vehicle = session.vehicle
            used_ldm = sum(float(o.ldm) for o in offers)
            max_ldm = float(vehicle.max_ldm) if vehicle else 0.0
            fill_pct = round((used_ldm / max_ldm) * 100, 2) if max_ldm > 0 else 0.0
            fill_pct = min(fill_pct, 100.0)
            estimated_profit = (
                float(session.net_profit_eur)
                if session.net_profit_eur is not None
                else None
            )

            is_realized = session.status in ("confirmed", "dispatched")
            created_at = session.created_at
            if created_at and created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=UTC)
            is_today = created_at is not None and created_at >= today_start

            if estimated_profit is not None and is_realized and is_today:
                profit_values.append(estimated_profit)
            if offers and session.status in _OPERATIONAL_STATUSES:
                fill_values.append(fill_pct)

            summaries.append(
                DashboardSessionSummary(
                    id=session.id,
                    status=session.status,  # type: ignore[arg-type]
                    created_at=session.created_at,
                    vehicle_name=vehicle.name if vehicle else None,
                    stop_count=len(session.route_stops),
                    offer_count=len(unique_offer_ids),
                    estimated_net_profit_eur=estimated_profit,
                ),
            )

        return DashboardResponse(
            kpis=DashboardKpi(
                active_sessions=active_sessions,
                total_sessions=total_sessions,
                total_estimated_profit_eur=round(sum(profit_values), 2),
                average_fill_pct=round(sum(fill_values) / len(fill_values), 2) if fill_values else 0.0,
                market_offers_count=market_offers_count,
                vehicles_in_route=vehicles_in_route,
            ),
            recent_sessions=summaries,
        )
