"""Unit tests for EU 561/2006 compliance evaluation."""

from __future__ import annotations

from app.services.driver_compliance import evaluate_events


def test_splits_11h2_route_into_two_days_and_stays_compliant() -> None:
    result = evaluate_events(
        leg_minutes=[90, 85, 80, 75, 70, 95, 85, 92],  # 11.2h total driving
        stop_minutes=[45, 50, 45, 60, 45, 50, 45, 45],
    )

    assert result.total_days == 2
    assert result.compliant is True
    assert result.violations == []
    assert result.recommended_overnight_stops


def test_single_10h_leg_without_break_reports_9h_daily_violation() -> None:
    result = evaluate_events(
        leg_minutes=[600],
        stop_minutes=[],
    )

    assert result.compliant is False
    assert "Przekroczono 9h jazdy w dobie" in result.violations


def test_simple_400km_route_is_single_day_compliant() -> None:
    result = evaluate_events(
        leg_minutes=[300],
        stop_minutes=[45],
    )

    assert result.compliant is True
    assert result.total_days == 1
    assert result.violations == []
