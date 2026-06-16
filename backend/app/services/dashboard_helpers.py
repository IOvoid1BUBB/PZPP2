"""Pure dashboard metric helpers (no SQLAlchemy imports)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

if TYPE_CHECKING:
    from app.models import ConsolidationSession
    from app.schemas.dashboard import ActiveSessionSummary


def today_bounds(
    tz_name: str,
    *,
    reference: datetime | None = None,
) -> tuple[datetime, datetime]:
    """Return UTC-aware [start, end) for the calendar day in ``tz_name``."""
    zone = ZoneInfo(tz_name)
    ref = reference or datetime.now(UTC)
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=UTC)
    local_now = ref.astimezone(zone)
    local_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    local_end = local_start + timedelta(days=1)
    return local_start.astimezone(UTC), local_end.astimezone(UTC)


def format_coord_label(lat: float, lon: float) -> str:
    """Format coordinates as a short human-readable label."""
    return f"{lat:.4f}°N, {lon:.4f}°E"


def session_offer_count(session: ConsolidationSession) -> int:
    """Count distinct offers assigned to a session."""
    return len({stop.offer_id for stop in session.route_stops})


def session_used_ldm(session: ConsolidationSession) -> float:
    """Sum LDM from unique offers on session stops."""
    seen: set[Any] = set()
    total = 0.0
    for stop in session.route_stops:
        if stop.offer is None or stop.offer_id in seen:
            continue
        seen.add(stop.offer_id)
        total += float(stop.offer.ldm)
    return total


def compute_lfil_pct(session: ConsolidationSession) -> float:
    """Compute load fill percentage (LFILL) for a session."""
    vehicle = session.vehicle
    max_ldm = float(vehicle.max_ldm) if vehicle else 0.0
    if max_ldm <= 0:
        return 0.0
    return round((session_used_ldm(session) / max_ldm) * 100, 2)


def compute_session_profit_eur(session: ConsolidationSession) -> float:
    """Return net profit for KPI aggregation (persisted value or estimate)."""
    if session.net_profit_eur is not None:
        return round(float(session.net_profit_eur), 2)

    offers = [stop.offer for stop in session.route_stops if stop.offer is not None]
    if not offers:
        return 0.0
    seen: set[Any] = set()
    revenue = 0.0
    for stop in session.route_stops:
        if stop.offer is None or stop.offer_id in seen:
            continue
        seen.add(stop.offer_id)
        revenue += float(stop.offer.price_eur)
    stop_costs = sum(float(s.stop_cost_eur or 0) for s in session.route_stops)
    return round(revenue - stop_costs, 2)


def resolve_current_location(session: ConsolidationSession) -> str:
    """First pickup label, else session origin coordinates."""
    from app.lib.geo import lat_lon_from_geometry

    pickup_stops = sorted(
        (s for s in session.route_stops if s.stop_type == "pickup"),
        key=lambda stop: stop.sequence_order,
    )
    if pickup_stops:
        stop = pickup_stops[0]
        if stop.address_label:
            return stop.address_label
        lat, lon = lat_lon_from_geometry(stop.location)
        return format_coord_label(lat, lon)

    if session.origin_lat is not None and session.origin_lon is not None:
        return format_coord_label(float(session.origin_lat), float(session.origin_lon))
    return "Nieznana lokalizacja"


def resolve_destination(session: ConsolidationSession) -> str:
    """Last delivery label, else placeholder when route is empty."""
    from app.lib.geo import lat_lon_from_geometry

    delivery_stops = sorted(
        (s for s in session.route_stops if s.stop_type == "delivery"),
        key=lambda stop: stop.sequence_order,
    )
    if not delivery_stops:
        return "Brak celu"

    stop = delivery_stops[-1]
    if stop.address_label:
        return stop.address_label
    lat, lon = lat_lon_from_geometry(stop.location)
    return format_coord_label(lat, lon)


def compute_time_window_risk(session: ConsolidationSession) -> bool:
    """True when any assigned offer has a time-window score below 1.0."""
    from app.services.offer_scorer import calculate_time_window_score

    if session.created_at is None:
        return False

    reference_eta = session.created_at
    if reference_eta.tzinfo is None:
        reference_eta = reference_eta.replace(tzinfo=UTC)

    seen_offers: set[Any] = set()
    for stop in sorted(session.route_stops, key=lambda item: item.sequence_order):
        if stop.stop_type != "pickup" or stop.offer is None:
            continue
        if stop.offer_id in seen_offers:
            continue
        seen_offers.add(stop.offer_id)

        offer = stop.offer
        eta_at_pickup = reference_eta
        if stop.eta_minutes_from_start is not None:
            eta_at_pickup = reference_eta + timedelta(minutes=stop.eta_minutes_from_start)

        handling = offer.handling_time_minutes if offer.handling_time_minutes is not None else 30
        score = calculate_time_window_score(
            offer.time_window_open,
            offer.time_window_close,
            eta_at_pickup,
            handling_minutes=handling,
        )
        if score < 1.0:
            return True
    return False


def build_active_session_summary(session: ConsolidationSession) -> ActiveSessionSummary:
    """Map a loaded session ORM row to an API summary."""
    from app.schemas.dashboard import ActiveSessionSummary

    vehicle = session.vehicle
    vehicle_name = vehicle.name if vehicle else "Bez pojazdu"
    return ActiveSessionSummary(
        session_id=session.id,
        vehicle_name=vehicle_name,
        current_location=resolve_current_location(session),
        destination=resolve_destination(session),
        lfil_pct=compute_lfil_pct(session),
        status=session.status,  # type: ignore[arg-type]
        has_time_window_risk=compute_time_window_risk(session),
    )
