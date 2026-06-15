"""Unit tests for dashboard notification builder."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.schemas.dashboard import DashboardNotification
from app.services.dashboard_notifications import (
    SessionNotificationContext,
    build_dashboard_notifications,
)

SESSION_A = UUID("11111111-1111-4111-8111-111111110001")
SESSION_B = UUID("22222222-2222-4222-8222-222222220002")
SESSION_C = UUID("33333333-3333-4333-8333-333333330003")
NOW = datetime(2026, 6, 15, 12, 0, tzinfo=UTC)


def _ctx(**kwargs: object) -> SessionNotificationContext:
    defaults = {
        "session_id": SESSION_A,
        "status": "draft",
        "created_at": NOW,
        "vehicle_name": "Renault Master L2",
        "offer_count": 0,
        "has_time_window_risk": False,
    }
    defaults.update(kwargs)
    return SessionNotificationContext(**defaults)  # type: ignore[arg-type]


def test_empty_state_when_no_conditions() -> None:
    alerts = build_dashboard_notifications([], market_offers_count=0, now=NOW)
    assert len(alerts) == 1
    assert alerts[0].id == "empty-state"
    assert alerts[0].type == "info"


def test_empty_session_notification() -> None:
    alerts = build_dashboard_notifications(
        [_ctx(status="draft", offer_count=0)],
        market_offers_count=0,
        now=NOW,
    )
    assert any(alert.id == f"empty-{SESSION_A}" for alert in alerts)
    empty = next(alert for alert in alerts if alert.id == f"empty-{SESSION_A}")
    assert empty.type == "info"
    assert "Wolna przestrzeń" in empty.title


def test_stale_draft_notification() -> None:
    stale_created = NOW - timedelta(hours=25)
    alerts = build_dashboard_notifications(
        [_ctx(created_at=stale_created, status="draft")],
        market_offers_count=0,
        now=NOW,
    )
    assert any(alert.id == f"stale-{SESSION_A}" for alert in alerts)


def test_time_window_risk_notification() -> None:
    alerts = build_dashboard_notifications(
        [_ctx(has_time_window_risk=True, offer_count=2)],
        market_offers_count=0,
        now=NOW,
    )
    assert any(alert.id == f"time-window-{SESSION_A}" for alert in alerts)
    tw = next(alert for alert in alerts if alert.id == f"time-window-{SESSION_A}")
    assert tw.type == "warning"


def test_market_volume_notification() -> None:
    alerts = build_dashboard_notifications([], market_offers_count=42, now=NOW)
    assert any(alert.id == "market-volume" for alert in alerts)
    market = next(alert for alert in alerts if alert.id == "market-volume")
    assert market.type == "opportunity"
    assert "42" in market.body


def test_notification_priority_order() -> None:
    alerts = build_dashboard_notifications(
        [
            _ctx(session_id=SESSION_A, offer_count=0),
            _ctx(
                session_id=SESSION_B,
                created_at=NOW - timedelta(hours=30),
                status="draft",
            ),
            _ctx(
                session_id=SESSION_C,
                has_time_window_risk=True,
                offer_count=1,
            ),
        ],
        market_offers_count=10,
        now=NOW,
    )
    ids = [alert.id for alert in alerts]
    assert ids.index(f"empty-{SESSION_A}") < ids.index(f"stale-{SESSION_B}")
    assert ids.index(f"stale-{SESSION_B}") < ids.index(f"time-window-{SESSION_C}")
    assert ids.index(f"time-window-{SESSION_C}") < ids.index("market-volume")


def test_optimizing_empty_session_also_triggers_empty_alert() -> None:
    alerts = build_dashboard_notifications(
        [_ctx(status="optimizing", offer_count=0)],
        market_offers_count=0,
        now=NOW,
    )
    assert any(alert.id.startswith("empty-") for alert in alerts)


def test_confirmed_empty_does_not_trigger_empty_alert() -> None:
    alerts = build_dashboard_notifications(
        [_ctx(status="confirmed", offer_count=0)],
        market_offers_count=0,
        now=NOW,
    )
    session_empty_ids = {
        alert.id for alert in alerts if alert.id.startswith("empty-") and alert.id != "empty-state"
    }
    assert session_empty_ids == set()
    assert alerts[0].id == "empty-state"


def test_notification_model_fields() -> None:
    alert = DashboardNotification(
        id="test",
        type="warning",
        title="Title",
        body="Body",
        link="Link",
        href="/planner",
    )
    assert alert.href == "/planner"
