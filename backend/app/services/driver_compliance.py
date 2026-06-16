"""EU 561/2006 driver-hours compliance checks for multi-stop sessions."""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import pairwise
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
                _DrivingEvent(
                    kind="stop",
                    minutes=max(0, stop_minutes[idx]),
                    event_index=event_index,
                ),
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


def _interpolate_on_geometry(
    geometry: list[list[float]], fraction: float
) -> tuple[float, float]:
    """Interpolate a [lat, lon] point at ``fraction`` of the polyline length.

    ``geometry`` is a list of ``[lat, lon]`` vertices. Segment lengths use plain
    euclidean distance in degree space, which is accurate enough for placing a
    rest marker on a single leg.
    """
    if not geometry:
        return (0.0, 0.0)
    if len(geometry) == 1:
        return (float(geometry[0][0]), float(geometry[0][1]))

    fraction = min(1.0, max(0.0, fraction))

    segments = list(pairwise(geometry))
    seg_lengths: list[float] = []
    total = 0.0
    for start, end in segments:
        length = math.dist((start[0], start[1]), (end[0], end[1]))
        seg_lengths.append(length)
        total += length

    if total <= 0:
        return (float(geometry[0][0]), float(geometry[0][1]))

    target = fraction * total
    accumulated = 0.0
    for (start, end), length in zip(segments, seg_lengths, strict=True):
        if accumulated + length >= target:
            t = (target - accumulated) / length if length > 0 else 0.0
            lat = start[0] + (end[0] - start[0]) * t
            lon = start[1] + (end[1] - start[1]) * t
            return (float(lat), float(lon))
        accumulated += length

    last = geometry[-1]
    return (float(last[0]), float(last[1]))


def compute_rest_points(
    leg_minutes: list[float],
    stop_minutes: list[float],
    leg_geometries: list[list[list[float]]],
) -> list[dict[str, object]]:
    """Locate mandatory breaks/rests geographically along a multi-leg route.

    Walks the route leg by leg, accumulating continuous driving (reset by a
    >= ``MIN_BREAK_MINUTES`` stop) and daily driving. When a leg crosses the
    4.5h continuous threshold a ``break_45`` point is emitted; when it crosses
    the 9h daily threshold a ``rest_11h`` point is emitted. Each point is
    interpolated onto that leg's geometry by the fraction of leg duration
    elapsed before the threshold.
    """
    break_threshold = MIN_BREAK_AFTER_HOURS * 60.0
    day_threshold = MAX_DAILY_DRIVING_HOURS * 60.0

    rest_points: list[dict[str, object]] = []
    continuous_driving = 0.0
    day_driving = 0.0
    route_minute = 0.0

    for index, raw_leg in enumerate(leg_minutes):
        leg_min = max(0.0, float(raw_leg))
        geometry = leg_geometries[index] if index < len(leg_geometries) else []
        leg_start_minute = route_minute

        events: list[tuple[float, str, float]] = []
        if leg_min > 0:
            if continuous_driving < break_threshold <= continuous_driving + leg_min:
                minutes_into_leg = break_threshold - continuous_driving
                events.append((minutes_into_leg, "break_45", break_threshold))
            if day_driving < day_threshold <= day_driving + leg_min:
                minutes_into_leg = day_threshold - day_driving
                events.append((minutes_into_leg, "rest_11h", day_threshold))

        events.sort(key=lambda item: item[0])

        new_continuous = continuous_driving + leg_min
        new_day = day_driving + leg_min
        for minutes_into_leg, rest_type, after_driving in events:
            fraction = minutes_into_leg / leg_min if leg_min > 0 else 0.0
            lat, lon = _interpolate_on_geometry(geometry, fraction)
            rest_points.append(
                {
                    "lat": lat,
                    "lon": lon,
                    "rest_type": rest_type,
                    "after_driving_minutes": round(after_driving),
                    "leg_id": index + 1,
                    "at_route_minute": round(leg_start_minute + minutes_into_leg),
                }
            )
            remaining = leg_min - minutes_into_leg
            if rest_type == "break_45":
                new_continuous = remaining
            elif rest_type == "rest_11h":
                new_day = remaining
                new_continuous = remaining

        continuous_driving = new_continuous
        day_driving = new_day
        route_minute += leg_min

        if index < len(stop_minutes):
            stop_min = max(0.0, float(stop_minutes[index]))
            route_minute += stop_min
            if stop_min >= MIN_BREAK_MINUTES:
                continuous_driving = 0.0

    return rest_points
