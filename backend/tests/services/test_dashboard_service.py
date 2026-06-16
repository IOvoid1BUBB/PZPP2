"""Unit tests for dashboard service helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.dashboard_helpers import (
    build_active_session_summary,
    compute_lfil_pct,
    compute_session_profit_eur,
    compute_time_window_risk,
    format_coord_label,
    resolve_current_location,
    resolve_destination,
    session_offer_count,
    today_bounds,
)


def test_today_bounds_utc() -> None:
    ref = datetime(2026, 6, 15, 14, 30, tzinfo=UTC)
    start, end = today_bounds("UTC", reference=ref)
    assert start == datetime(2026, 6, 15, 0, 0, tzinfo=UTC)
    assert end == datetime(2026, 6, 16, 0, 0, tzinfo=UTC)


def test_today_bounds_warsaw() -> None:
    ref = datetime(2026, 6, 15, 22, 30, tzinfo=UTC)
    start, end = today_bounds("Europe/Warsaw", reference=ref)
    assert start.utcoffset() == timedelta(0)
    assert end > start
    local_start = start.astimezone(UTC).astimezone(
        __import__("zoneinfo").ZoneInfo("Europe/Warsaw"),
    )
    assert local_start.hour == 0


def test_format_coord_label() -> None:
    assert format_coord_label(52.22, 21.01) == "52.2200°N, 21.0100°E"


def test_session_offer_count_deduplicates() -> None:
    offer_id = uuid4()
    session = SimpleNamespace(
        route_stops=[
            SimpleNamespace(offer_id=offer_id),
            SimpleNamespace(offer_id=offer_id),
        ],
    )
    assert session_offer_count(session) == 1  # type: ignore[arg-type]


def test_compute_lfil_pct() -> None:
    offer_id = uuid4()
    offer = SimpleNamespace(offer_id=offer_id, ldm=4.0)
    session = SimpleNamespace(
        vehicle=SimpleNamespace(max_ldm=8.0),
        route_stops=[
            SimpleNamespace(offer_id=offer_id, offer=offer, stop_type="pickup"),
            SimpleNamespace(offer_id=offer_id, offer=offer, stop_type="delivery"),
        ],
    )
    assert compute_lfil_pct(session) == 50.0  # type: ignore[arg-type]


def test_compute_session_profit_uses_persisted_value() -> None:
    session = SimpleNamespace(
        net_profit_eur=123.45,
        route_stops=[],
    )
    assert compute_session_profit_eur(session) == 123.45  # type: ignore[arg-type]


def test_compute_session_profit_estimates_from_offers() -> None:
    offer = SimpleNamespace(offer_id=uuid4(), price_eur=1000.0, ldm=2.0)
    session = SimpleNamespace(
        net_profit_eur=None,
        route_stops=[
            SimpleNamespace(
                offer_id=offer.offer_id,
                offer=offer,
                stop_cost_eur=50.0,
            ),
            SimpleNamespace(
                offer_id=offer.offer_id,
                offer=offer,
                stop_cost_eur=25.0,
            ),
        ],
    )
    assert compute_session_profit_eur(session) == 925.0  # type: ignore[arg-type]


def test_resolve_current_location_from_origin() -> None:
    session = SimpleNamespace(
        origin_lat=52.22,
        origin_lon=21.01,
        route_stops=[],
    )
    assert resolve_current_location(session) == "52.2200°N, 21.0100°E"  # type: ignore[arg-type]


def test_resolve_current_location_from_pickup_label() -> None:
    session = SimpleNamespace(
        origin_lat=52.0,
        origin_lon=21.0,
        route_stops=[
            SimpleNamespace(
                stop_type="pickup",
                sequence_order=0,
                address_label="Warszawa, PL",
                location=None,
            ),
        ],
    )
    assert resolve_current_location(session) == "Warszawa, PL"  # type: ignore[arg-type]


def test_resolve_destination_when_no_stops() -> None:
    session = SimpleNamespace(route_stops=[])
    assert resolve_destination(session) == "Brak celu"  # type: ignore[arg-type]


def test_compute_time_window_risk_detects_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.offer_scorer.calculate_time_window_score",
        lambda *args, **kwargs: 0.0,
    )
    created = datetime(2026, 6, 15, 8, 0, tzinfo=UTC)
    offer = SimpleNamespace(
        time_window_open=created,
        time_window_close=created,
        handling_time_minutes=30,
    )
    session = SimpleNamespace(
        created_at=created,
        route_stops=[
            SimpleNamespace(
                stop_type="pickup",
                sequence_order=0,
                offer_id=uuid4(),
                offer=offer,
                eta_minutes_from_start=180,
            ),
        ],
    )
    assert compute_time_window_risk(session) is True  # type: ignore[arg-type]


def test_compute_time_window_risk_ok_when_in_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.offer_scorer.calculate_time_window_score",
        lambda *args, **kwargs: 1.0,
    )
    created = datetime(2026, 6, 15, 8, 0, tzinfo=UTC)
    offer = SimpleNamespace(
        time_window_open=created,
        time_window_close=created,
        handling_time_minutes=30,
    )
    session = SimpleNamespace(
        created_at=created,
        route_stops=[
            SimpleNamespace(
                stop_type="pickup",
                sequence_order=0,
                offer_id=uuid4(),
                offer=offer,
                eta_minutes_from_start=60,
            ),
        ],
    )
    assert compute_time_window_risk(session) is False  # type: ignore[arg-type]


def test_build_active_session_summary() -> None:
    offer = SimpleNamespace(
        offer_id=uuid4(),
        ldm=2.0,
        time_window_open=None,
        time_window_close=None,
        handling_time_minutes=30,
    )
    session = SimpleNamespace(
        id=uuid4(),
        status="confirmed",
        created_at=datetime.now(UTC),
        vehicle=SimpleNamespace(name="Master L3", max_ldm=10.0),
        origin_lat=52.0,
        origin_lon=21.0,
        route_stops=[
            SimpleNamespace(
                stop_type="pickup",
                sequence_order=0,
                offer_id=offer.offer_id,
                offer=offer,
                address_label="Pickup",
                location=None,
                eta_minutes_from_start=30,
            ),
            SimpleNamespace(
                stop_type="delivery",
                sequence_order=1,
                offer_id=offer.offer_id,
                offer=offer,
                address_label="Delivery",
                location=None,
                eta_minutes_from_start=90,
            ),
        ],
    )
    summary = build_active_session_summary(session)  # type: ignore[arg-type]
    assert summary.vehicle_name == "Master L3"
    assert summary.current_location == "Pickup"
    assert summary.destination == "Delivery"
    assert summary.lfil_pct == 20.0
    assert summary.status == "confirmed"
