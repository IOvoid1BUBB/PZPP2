"""Unit tests for EU 561/2006 compliance logic (evaluate_events, rest points).

These exercise the pure functions in ``app.services.driver_compliance`` without
touching the database or routing provider.
"""

from __future__ import annotations

from app.services.driver_compliance import compute_rest_points, evaluate_events

_EXTENDED_VIOLATION = (
    "Przekroczono limit 2 dni z jazdą przedłużoną (9–10h) "
    "w tygodniu (EU 561/2006 art. 6(2))"
)
_WEEKLY_VIOLATION = "Przekroczono 56h jazdy w tygodniu (EU 561/2006 art. 6(2))"


def test_no_violation_exactly_45h_driving() -> None:
    # Exactly 4.5h continuous driving does not require a break yet.
    result = evaluate_events(leg_minutes=[270], stop_minutes=[])

    assert result.compliant is True
    assert result.violations == []


def test_violation_over_45h_no_break() -> None:
    # 4.52h continuous driving without a break breaches art. 7.
    result = evaluate_events(leg_minutes=[271], stop_minutes=[])

    assert result.compliant is False
    assert any("4.5h" in violation for violation in result.violations)


def test_split_day_at_9h() -> None:
    # A >9h route broken by 45 min breaks splits into a second day, no violation.
    result = evaluate_events(
        leg_minutes=[240, 240, 240],
        stop_minutes=[45, 45],
    )

    assert result.total_days == 2
    assert result.violations == []


def test_extended_day_allowed_twice() -> None:
    # Two 9.5h driving days are permitted extended driving (no extension violation).
    result = evaluate_events(leg_minutes=[570, 570], stop_minutes=[])

    assert _EXTENDED_VIOLATION not in result.violations


def test_extended_day_violation_third_time() -> None:
    # A third 9.5h day in the same week exceeds the 2x extended-driving allowance.
    result = evaluate_events(leg_minutes=[570, 570, 570], stop_minutes=[])

    assert _EXTENDED_VIOLATION in result.violations


def test_weekly_limit_exceeded() -> None:
    # Seven 9h days = 63h driving, over the 56h weekly ceiling (art. 6(2)).
    result = evaluate_events(leg_minutes=[540] * 7, stop_minutes=[])

    assert _WEEKLY_VIOLATION in result.violations


def test_rest_11h_resets_continuous() -> None:
    # After the overnight rest on leg 1, continuous driving resets to 0, so the
    # short second leg (<4.5h) does not trigger a 45 min break.
    rest_points = compute_rest_points(
        leg_minutes=[600, 200],
        stop_minutes=[],
        leg_geometries=[],
    )

    leg2_breaks = [
        point
        for point in rest_points
        if point["leg_id"] == 2 and point["rest_type"] == "break_45"
    ]
    assert leg2_breaks == []
