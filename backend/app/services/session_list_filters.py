"""SQL filter helpers for listing consolidation sessions."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from app.models import ConsolidationSession

if TYPE_CHECKING:
    from sqlalchemy.sql.selectable import Select


def calendar_day_bounds(day: date, tz_name: str) -> tuple[datetime, datetime]:
    """Return UTC-aware [start, end) for a calendar day in ``tz_name``."""
    zone = ZoneInfo(tz_name)
    local_start = datetime(day.year, day.month, day.day, tzinfo=zone)
    local_end = local_start + timedelta(days=1)
    return local_start.astimezone(UTC), local_end.astimezone(UTC)


def apply_session_list_filters(
    stmt: Select[tuple[ConsolidationSession]],
    *,
    status: str | None,
    day: date | None,
    tz_name: str,
) -> Select[tuple[ConsolidationSession]]:
    """Apply optional status and calendar-day filters to a session list query."""
    if status is not None:
        stmt = stmt.where(ConsolidationSession.status == status)
    if day is not None:
        day_start, day_end = calendar_day_bounds(day, tz_name)
        stmt = stmt.where(
            ConsolidationSession.created_at >= day_start,
            ConsolidationSession.created_at < day_end,
        )
    return stmt
