"""EU 561/2006 driver-hours compliance checks for multi-stop sessions."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings, get_settings
from app.core.exceptions import NotFoundError, ValidationAppError
from app.lib.routing import RoutingProvider, get_routing_provider
from app.models import ConsolidationSession, RouteStop

MAX_DAILY_DRIVING_HOURS = 9.0
MAX_EXTENDED_DRIVING_HOURS = 10.0
MIN_BREAK_AFTER_HOURS = 4.5
MIN_DAILY_REST_MINUTES = 660
MIN_BREAK_MINUTES = 45


class DrivingDay(BaseModel):
    """Single driving-day summary."""

    model_config = ConfigDict(extra="forbid")

    day_number: int
    driving_hours: float
    working_minutes: int
    violations: list[str] = Field(default_factory=list)


class ComplianceResult(BaseModel):
    """Driver-compliance summary for a session route."""

    model_config = ConfigDict(extra="forbid")

    days: list[DrivingDay]
    total_days: int
    compliant: bool
    violations: list[str]
    recommended_overnight_stops: list[int]


@dataclass(slots=True)
class _DrivingEvent:
    kind: str
    minutes: int
    event_index: int


class DriverComplianceService:
    """Build route events and evaluate compliance against EU 561/2006 limits."""

    def __init__(
        self,
        db: AsyncSession,
        *,
        routing: RoutingProvider | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._db = db
        self._routing = routing or get_routing_provider()
        self._settings = settings or get_settings()

    async def evaluate_session(self, session_id: UUID) -> ComplianceResult:
        session = await self._load_session(session_id)
        if session is None:
            raise NotFoundError(f"Session {session_id} not found.")

        ordered_stops = sorted(session.route_stops, key=lambda stop: stop.sequence_order)
        if not ordered_stops:
            return ComplianceResult(
                days=[
                    DrivingDay(
                        day_number=1,
                        driving_hours=0.0,
                        working_minutes=0,
                        violations=[],
                    )
                ],
                total_days=1,
                compliant=True,
                violations=[],
                recommended_overnight_stops=[],
            )

        if session.origin_lat is None or session.origin_lon is None:
            raise ValidationAppError("Session origin coordinates are not set.")

        origin = (float(session.origin_lat), float(session.origin_lon))
        waypoints: list[tuple[float, float]] = [origin]
        from app.lib.geo import lat_lon_from_geometry

        for stop in ordered_stops:
            waypoints.append(lat_lon_from_geometry(stop.location))

        route = await self._routing.get_route_multi(waypoints)
        stop_durations = [
            (
                stop.offer.handling_time_minutes
                if stop.offer is not None and stop.offer.handling_time_minutes is not None
                else self._settings.STOP_COST_MINUTES
            )
            for stop in ordered_stops
        ]

        return evaluate_events(
            leg_minutes=[leg.duration_minutes for leg in route.legs],
            stop_minutes=stop_durations,
        )

    async def _load_session(self, session_id: UUID) -> ConsolidationSession | None:
        stmt = (
            select(ConsolidationSession)
            .where(ConsolidationSession.id == session_id)
            .options(
                selectinload(ConsolidationSession.route_stops).selectinload(RouteStop.offer),
            )
        )
        result = await self._db.execute(stmt)
        return result.scalar_one_or_none()


def evaluate_events(*, leg_minutes: list[int], stop_minutes: list[int]) -> ComplianceResult:
    """Evaluate route events (legs + stops) with day split recommendations."""

    events: list[_DrivingEvent] = []
    event_index = 0
    for idx, leg in enumerate(leg_minutes):
        events.append(_DrivingEvent(kind="drive", minutes=max(0, leg), event_index=event_index))
        event_index += 1
        if idx < len(stop_minutes):
            events.append(
                _DrivingEvent(kind="stop", minutes=max(0, stop_minutes[idx]), event_index=event_index),
            )
            event_index += 1

    if not events:
        return ComplianceResult(
            days=[DrivingDay(day_number=1, driving_hours=0.0, working_minutes=0, violations=[])],
            total_days=1,
            compliant=True,
            violations=[],
            recommended_overnight_stops=[],
        )

    day_number = 1
    day_driving_minutes = 0
    day_working_minutes = 0
    continuous_driving_minutes = 0
    days: list[DrivingDay] = []
    all_violations: list[str] = []
    recommended_overnight_stops: list[int] = []
    last_completed_event_index = -1

    def flush_day(violations: list[str]) -> None:
        days.append(
            DrivingDay(
                day_number=day_number,
                driving_hours=round(day_driving_minutes / 60, 2),
                working_minutes=day_working_minutes,
                violations=violations,
            ),
        )

    day_violations: list[str] = []
    for event in events:
        if event.kind == "drive" and continuous_driving_minutes / 60 > MIN_BREAK_AFTER_HOURS:
            violation = "Brak wymaganej przerwy po 4.5h jazdy"
            if violation not in day_violations:
                day_violations.append(violation)
                all_violations.append(violation)

        if (
            event.kind == "drive"
            and day_driving_minutes > 0
            and (day_driving_minutes + event.minutes) / 60 > MAX_DAILY_DRIVING_HOURS
        ):
            if last_completed_event_index >= 0:
                recommended_overnight_stops.append(last_completed_event_index)
            flush_day(day_violations)
            day_number += 1
            day_driving_minutes = 0
            day_working_minutes = MIN_DAILY_REST_MINUTES
            continuous_driving_minutes = 0
            day_violations = []

        day_working_minutes += event.minutes
        if event.kind == "drive":
            day_driving_minutes += event.minutes
            continuous_driving_minutes += event.minutes
            day_driving_hours = day_driving_minutes / 60
            if day_driving_hours > MAX_DAILY_DRIVING_HOURS:
                violation = "Przekroczono 9h jazdy w dobie"
                if violation not in day_violations:
                    day_violations.append(violation)
                    all_violations.append(violation)
            if day_driving_hours > MAX_EXTENDED_DRIVING_HOURS:
                violation = "Przekroczono 10h jazdy w dobie"
                if violation not in day_violations:
                    day_violations.append(violation)
                    all_violations.append(violation)
        elif event.minutes >= MIN_BREAK_MINUTES:
            continuous_driving_minutes = 0

        last_completed_event_index = event.event_index

    flush_day(day_violations)
    return ComplianceResult(
        days=days,
        total_days=len(days),
        compliant=len(all_violations) == 0,
        violations=all_violations,
        recommended_overnight_stops=recommended_overnight_stops,
    )
