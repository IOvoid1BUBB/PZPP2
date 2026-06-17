"""Unit tests for ETA computation with mandatory-break overhead.

Covers ``compute_eta_minutes`` (sequence_optimizer) combined with
``compute_break_overhead_minutes`` (driver_compliance).
"""

from __future__ import annotations

from uuid import uuid4

from app.lib.routing import DistanceMatrix
from app.services.driver_compliance import compute_break_overhead_minutes
from app.services.sequence_optimizer import (
    Stop,
    build_node_indices,
    compute_eta_minutes,
)


def _stop(handling: int = 30) -> Stop:
    return Stop(
        id=str(uuid4()),
        offer_id=uuid4(),
        stop_type="pickup",  # type: ignore[arg-type]
        location=(52.0, 21.0),
        handling_time_minutes=handling,
    )


def _matrix_from_legs(leg_minutes: list[int]) -> tuple[DistanceMatrix, list[Stop]]:
    """Build a chain matrix (origin -> stop0 -> stop1 ...) from leg durations."""
    stops = [_stop() for _ in leg_minutes]
    n = len(leg_minutes) + 1
    durations = [[0 for _ in range(n)] for _ in range(n)]
    distances = [[0.0 for _ in range(n)] for _ in range(n)]
    # Leg i connects node i (origin=0) to node i+1.
    for i, minutes in enumerate(leg_minutes):
        durations[i][i + 1] = minutes
        distances[i][i + 1] = float(minutes)
    matrix = DistanceMatrix(distances_km=distances, durations_minutes=durations, n=n)
    return matrix, stops


def test_eta_without_breaks() -> None:
    matrix, stops = _matrix_from_legs([120, 100])
    node_indices = build_node_indices(stops)

    etas = compute_eta_minutes(
        stops,
        matrix=matrix,
        node_indices=node_indices,
        break_overhead=[0, 0],
    )

    # Stop 0: 120 min travel. Stop 1: 120 + 30 handling + 100 travel = 250.
    assert etas == [120, 250]


def test_eta_with_45min_break() -> None:
    leg_minutes = [271, 60]
    matrix, stops = _matrix_from_legs(leg_minutes)
    node_indices = build_node_indices(stops)
    stop_minutes = [float(s.handling_time_minutes) for s in stops]

    break_overhead = compute_break_overhead_minutes(
        [float(m) for m in leg_minutes], stop_minutes
    )
    assert break_overhead[0] == 45

    etas_no_break = compute_eta_minutes(stops, matrix=matrix, node_indices=node_indices)
    etas_with_break = compute_eta_minutes(
        stops,
        matrix=matrix,
        node_indices=node_indices,
        break_overhead=break_overhead,
    )

    # First stop's ETA is delayed by the 45 min break taken en route.
    assert etas_with_break[0] == etas_no_break[0] + 45


def test_eta_with_overnight_rest() -> None:
    leg_minutes = [541, 60]
    matrix, stops = _matrix_from_legs(leg_minutes)
    node_indices = build_node_indices(stops)
    stop_minutes = [float(s.handling_time_minutes) for s in stops]

    break_overhead = compute_break_overhead_minutes(
        [float(m) for m in leg_minutes], stop_minutes
    )
    assert break_overhead[0] == 660

    etas_no_break = compute_eta_minutes(stops, matrix=matrix, node_indices=node_indices)
    etas_with_rest = compute_eta_minutes(
        stops,
        matrix=matrix,
        node_indices=node_indices,
        break_overhead=break_overhead,
    )

    assert etas_with_rest[0] == etas_no_break[0] + 660
