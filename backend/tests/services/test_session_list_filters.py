"""Unit tests for session list filter helpers."""

from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import select

from app.models import ConsolidationSession
from app.services.session_list_filters import (
    apply_session_list_filters,
    calendar_day_bounds,
    parse_session_list_date,
)


def test_calendar_day_bounds_utc() -> None:
    day_start, day_end = calendar_day_bounds(date(2026, 6, 2), "UTC")

    assert day_start == datetime(2026, 6, 2, 0, 0, tzinfo=UTC)
    assert day_end == datetime(2026, 6, 3, 0, 0, tzinfo=UTC)


def test_calendar_day_bounds_warsaw() -> None:
    day_start, day_end = calendar_day_bounds(date(2026, 6, 2), "Europe/Warsaw")

    assert day_start == datetime(2026, 6, 1, 22, 0, tzinfo=UTC)
    assert day_end == datetime(2026, 6, 2, 22, 0, tzinfo=UTC)


def test_apply_session_list_filters_no_params() -> None:
    stmt = select(ConsolidationSession)
    filtered = apply_session_list_filters(stmt, status=None, day=None, tz_name="UTC")

    assert filtered is stmt
    assert filtered.whereclause is None


def test_apply_session_list_filters_status_only() -> None:
    stmt = select(ConsolidationSession)
    filtered = apply_session_list_filters(stmt, status="dispatched", day=None, tz_name="UTC")

    assert filtered.whereclause is not None
    compiled = str(filtered.whereclause.compile(compile_kwargs={"literal_binds": True}))
    assert "consolidation_sessions.status" in compiled
    assert "dispatched" in compiled


def test_apply_session_list_filters_date_only() -> None:
    stmt = select(ConsolidationSession)
    filtered = apply_session_list_filters(
        stmt,
        status=None,
        day=date(2026, 6, 2),
        tz_name="UTC",
    )

    assert filtered.whereclause is not None
    compiled = str(filtered.whereclause.compile(compile_kwargs={"literal_binds": True}))
    assert "consolidation_sessions.created_at" in compiled


def test_apply_session_list_filters_status_and_date() -> None:
    stmt = select(ConsolidationSession)
    filtered = apply_session_list_filters(
        stmt,
        status="dispatched",
        day=date(2026, 6, 2),
        tz_name="UTC",
    )

    assert filtered.whereclause is not None
    compiled = str(filtered.whereclause.compile(compile_kwargs={"literal_binds": True}))
    assert "consolidation_sessions.status" in compiled
    assert "consolidation_sessions.created_at" in compiled
    assert "dispatched" in compiled


def test_parse_session_list_date_iso() -> None:
    assert parse_session_list_date("2026-06-02", tz_name="UTC") == date(2026, 6, 2)


def test_parse_session_list_date_today() -> None:
    parsed = parse_session_list_date("today", tz_name="UTC")
    assert parsed == datetime.now(UTC).date()


def test_parse_session_list_date_none() -> None:
    assert parse_session_list_date(None, tz_name="UTC") is None
