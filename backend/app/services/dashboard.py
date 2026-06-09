"""Aggregated dashboard metrics from consolidation sessions."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import ConsolidationSession, MarketOffer, RouteStop
from app.schemas.dashboard import DashboardKpi, DashboardResponse, DashboardSessionSummary


class DashboardService:
    """Build operational KPIs and recent session summaries."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_dashboard(self, *, recent_limit: int = 10) -> DashboardResponse:
        total_sessions = int(
            await self._db.scalar(select(func.count()).select_from(ConsolidationSession)) or 0,
        )
        active_sessions = int(
            await self._db.scalar(
                select(func.count())
                .select_from(ConsolidationSession)
                .where(ConsolidationSession.status.in_(("draft", "optimizing"))),
            )
            or 0,
        )
        market_offers_count = int(
            await self._db.scalar(select(func.count()).select_from(MarketOffer)) or 0,
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

        profit_values: list[float] = []
        fill_values: list[float] = []
        summaries: list[DashboardSessionSummary] = []

        for session in sessions:
            offers = [stop.offer for stop in session.route_stops if stop.offer is not None]
            unique_offer_ids = {stop.offer_id for stop in session.route_stops}
            vehicle = session.vehicle
            used_ldm = sum(float(o.ldm) for o in offers)
            max_ldm = float(vehicle.max_ldm) if vehicle else 0.0
            fill_pct = round((used_ldm / max_ldm) * 100, 2) if max_ldm > 0 else 0.0
            revenue = sum(float(o.price_eur) for o in offers)
            stop_costs = sum(float(s.stop_cost_eur or 0) for s in session.route_stops)
            estimated_profit = round(revenue - stop_costs, 2) if offers else None

            if estimated_profit is not None:
                profit_values.append(estimated_profit)
            if offers:
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
            ),
            recent_sessions=summaries,
        )
