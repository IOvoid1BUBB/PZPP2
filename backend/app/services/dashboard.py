"""Aggregated dashboard metrics from consolidation sessions."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings, get_settings
from app.models import ConsolidationSession, MarketOffer, RouteStop
from app.schemas.dashboard import DashboardResponse
from app.services.dashboard_helpers import (
    build_active_session_summary,
    compute_lfil_pct,
    compute_session_profit_eur,
    compute_time_window_risk,
    session_offer_count,
    today_bounds,
)
from app.services.dashboard_notifications import (
    SessionNotificationContext,
    build_dashboard_notifications,
    is_active_status,
)


class DashboardService:
    """Build operational KPIs, active sessions, and notifications in one pass."""

    def __init__(
        self,
        db: AsyncSession,
        *,
        settings: Settings | None = None,
    ) -> None:
        self._db = db
        self._settings = settings or get_settings()

    async def get_dashboard(self) -> DashboardResponse:
        day_start, day_end = today_bounds(self._settings.APP_TIMEZONE)

        market_offers_count = int(
            await self._db.scalar(select(func.count()).select_from(MarketOffer)) or 0,
        )

        stmt = (
            select(ConsolidationSession)
            .where(
                ConsolidationSession.created_at >= day_start,
                ConsolidationSession.created_at < day_end,
            )
            .options(
                selectinload(ConsolidationSession.vehicle),
                selectinload(ConsolidationSession.route_stops).selectinload(RouteStop.offer),
            )
            .order_by(ConsolidationSession.created_at.desc())
        )
        result = await self._db.execute(stmt)
        today_sessions = list(result.scalars().all())

        profit_total = 0.0
        fill_values: list[float] = []
        empty_count = 0

        for session in today_sessions:
            offer_count = session_offer_count(session)
            if offer_count == 0:
                empty_count += 1
            else:
                fill_values.append(compute_lfil_pct(session))
            profit_total += compute_session_profit_eur(session)

        total_today = len(today_sessions)
        empty_runs_pct = round((empty_count / total_today) * 100, 2) if total_today else 0.0
        avg_lfill_pct = round(sum(fill_values) / len(fill_values), 2) if fill_values else 0.0

        active_sessions = [
            build_active_session_summary(session)
            for session in today_sessions
            if is_active_status(session.status)
        ]

        notification_contexts = [
            SessionNotificationContext(
                session_id=session.id,
                status=session.status,
                created_at=session.created_at,
                vehicle_name=session.vehicle.name if session.vehicle else None,
                offer_count=session_offer_count(session),
                has_time_window_risk=compute_time_window_risk(session),
            )
            for session in today_sessions
        ]

        notifications = build_dashboard_notifications(
            notification_contexts,
            market_offers_count=market_offers_count,
        )

        eur_to_pln = self._settings.EUR_TO_PLN
        return DashboardResponse(
            today_net_profit_eur=round(profit_total, 2),
            today_net_profit_pln=round(profit_total * eur_to_pln, 2),
            avg_lfill_pct=avg_lfill_pct,
            empty_runs_pct=empty_runs_pct,
            active_sessions=active_sessions,
            notifications=notifications,
        )
