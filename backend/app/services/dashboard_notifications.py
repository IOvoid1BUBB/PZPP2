"""Pure notification builder for the dashboard feed."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from app.schemas.dashboard import DashboardNotification

DAY_MS = 24 * 60 * 60 * 1000
_ACTIVE_STATUSES = frozenset({"draft", "optimizing", "confirmed", "dispatched"})


@dataclass(frozen=True, slots=True)
class SessionNotificationContext:
    """Minimal session fields required to build dashboard notifications."""

    session_id: UUID
    status: str
    created_at: datetime
    vehicle_name: str | None
    offer_count: int
    has_time_window_risk: bool


def _short_id(session_id: UUID) -> str:
    return f"#{str(session_id)[:4].upper()}"


def build_dashboard_notifications(
    sessions: list[SessionNotificationContext],
    *,
    market_offers_count: int,
    now: datetime | None = None,
) -> list[DashboardNotification]:
    """Build alert feed: empty → stale → time-window → market-volume → empty-state."""
    reference = now or datetime.now(UTC)
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=UTC)

    alerts: list[DashboardNotification] = []

    for session in sessions:
        if session.status not in {"draft", "optimizing"} or session.offer_count > 0:
            continue
        vehicle_suffix = f" ({session.vehicle_name})" if session.vehicle_name else ""
        alerts.append(
            DashboardNotification(
                id=f"empty-{session.session_id}",
                type="free_space",
                title="Wolna przestrzeń",
                body=(
                    f"Sesja {_short_id(session.session_id)}{vehicle_suffix} "
                    "nie ma jeszcze ofert. Znajdź doładunek!"
                ),
                link="Zaplanuj załadunek →",
                href=f"/planner?session={session.session_id}",
            ),
        )

    for session in sessions:
        if session.status != "draft":
            continue
        created_at = session.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)
        age_ms = (reference - created_at).total_seconds() * 1000
        if age_ms > DAY_MS:
            alerts.append(
                DashboardNotification(
                    id=f"stale-{session.session_id}",
                    type="free_space",
                    title="Niedokończony plan",
                    body=(
                        f"Szkic {_short_id(session.session_id)} czeka ponad 24h. "
                        "Dokończ planowanie lub usuń sesję."
                    ),
                    link="Otwórz planner →",
                    href=f"/planner?session={session.session_id}",
                ),
            )

    for session in sessions:
        if not session.has_time_window_risk:
            continue
        alerts.append(
            DashboardNotification(
                id=f"time-window-{session.session_id}",
                type="time_window_risk",
                title="Ryzyko okna czasowego",
                body=(
                    f"Sesja {_short_id(session.session_id)} ma oferty z ryzykiem "
                    "naruszenia okna czasowego."
                ),
                link="Otwórz planner →",
                href=f"/planner?session={session.session_id}",
            ),
        )

    if market_offers_count > 0:
        alerts.append(
            DashboardNotification(
                id="market-volume",
                type="hot_offer",
                title="Aktywna giełda",
                body=(
                    f"Na rynku dostępnych jest {market_offers_count} ofert. "
                    "Sprawdź najlepiej rokujące trasy."
                ),
                link="Przejdź do giełdy →",
                href="/market",
            ),
        )

    if not alerts:
        alerts.append(
            DashboardNotification(
                id="empty-state",
                type="free_space",
                title="Wszystko pod kontrolą",
                body=(
                    "Brak alertów. Utwórz sesję lub wygeneruj oferty, "
                    "aby rozpocząć planowanie."
                ),
                link="Otwórz planner →",
                href="/planner",
            ),
        )

    return alerts


def is_active_status(status: str) -> bool:
    """Return whether a session status belongs on the active dashboard list."""
    return status in _ACTIVE_STATUSES
