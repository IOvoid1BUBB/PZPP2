"""Tests for stop sequence optimizer (precedence, 2-opt, exact DP, DB upsert)."""

from __future__ import annotations

import math
import random
from itertools import permutations
from uuid import UUID, uuid4

import pytest
from app.lib.geo import haversine_km
from app.lib.routing import DistanceMatrix
from app.models.stop import RouteStop
from app.services.sequence_optimizer import (
    SequenceOptimizerService,
    Stop,
    build_node_indices,
    compute_eta_minutes,
    is_precedence_valid,
    nearest_neighbor_with_precedence,
    optimize_exact_with_precedence,
    optimize_stop_sequence,
    sequence_total_distance_km,
    two_opt_with_precedence,
)


def _make_stop(
    *,
    offer_id: UUID | None = None,
    stop_type: str = "pickup",
    lat: float = 52.0,
    lon: float = 21.0,
    handling: int = 30,
    stop_id: str | None = None,
) -> Stop:
    oid = offer_id or uuid4()
    return Stop(
        id=stop_id or str(uuid4()),
        offer_id=oid,
        stop_type=stop_type,  # type: ignore[arg-type]
        location=(lat, lon),
        handling_time_minutes=handling,
    )


def _offer_pair(
    *,
    seed: int,
    base_lat: float = 52.0,
    base_lon: float = 21.0,
) -> tuple[Stop, Stop]:
    rng = random.Random(seed)
    offer_id = uuid4()
    pickup = _make_stop(
        offer_id=offer_id,
        stop_type="pickup",
        lat=base_lat + rng.uniform(-2, 2),
        lon=base_lon + rng.uniform(-2, 2),
        handling=rng.choice([15, 30, 45]),
    )
    delivery = _make_stop(
        offer_id=offer_id,
        stop_type="delivery",
        lat=base_lat + rng.uniform(-2, 2),
        lon=base_lon + rng.uniform(-2, 2),
        handling=rng.choice([15, 30, 45]),
    )
    return pickup, delivery


def _build_matrix(
    origin: tuple[float, float],
    stops: list[Stop],
) -> DistanceMatrix:
    locations = [origin, *(stop.location for stop in stops)]
    n = len(locations)
    distances_km: list[list[float]] = []
    durations_minutes: list[list[int]] = []
    for i in range(n):
        row_km: list[float] = []
        row_min: list[int] = []
        for j in range(n):
            if i == j:
                row_km.append(0.0)
                row_min.append(0)
            else:
                lat1, lon1 = locations[i]
                lat2, lon2 = locations[j]
                km = haversine_km(lon1, lat1, lon2, lat2)
                row_km.append(round(km, 3))
                row_min.append(max(1, int(km * 1.2)))
        distances_km.append(row_km)
        durations_minutes.append(row_min)
    return DistanceMatrix(distances_km=distances_km, durations_minutes=durations_minutes, n=n)


def _three_offers(seed: int) -> list[Stop]:
    stops: list[Stop] = []
    for offer_index in range(3):
        pickup, delivery = _offer_pair(seed=seed * 100 + offer_index)
        stops.extend([pickup, delivery])
    return stops


def _offers(count: int, seed: int) -> list[Stop]:
    stops: list[Stop] = []
    for offer_index in range(count):
        pickup, delivery = _offer_pair(seed=seed * 1000 + offer_index)
        stops.extend([pickup, delivery])
    return stops


def _brute_force_optimal(
    stops: list[Stop],
    *,
    matrix: DistanceMatrix,
    node_indices: dict[str, int],
) -> list[Stop]:
    best: list[Stop] | None = None
    best_distance = math.inf
    for perm in permutations(stops):
        candidate = list(perm)
        if not is_precedence_valid(candidate):
            continue
        distance = sequence_total_distance_km(candidate, matrix=matrix, node_indices=node_indices)
        if distance < best_distance:
            best_distance = distance
            best = candidate
    assert best is not None
    return best


# ---------------------------------------------------------------------------
# Reliability & algorithm properties
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("seed", range(100))
def test_precedence_never_violated_for_three_offers(seed: int) -> None:
    origin = (52.23, 21.01)
    stops = _three_offers(seed)
    matrix = _build_matrix(origin, stops)
    node_indices = build_node_indices(stops)
    ordered = optimize_stop_sequence(stops, matrix=matrix, node_indices=node_indices)
    assert is_precedence_valid(ordered)
    assert len(ordered) == len(stops)


def test_two_opt_never_worse_than_nearest_neighbor() -> None:
    origin = (52.23, 21.01)
    for seed in range(50):
        stops = _three_offers(seed)
        matrix = _build_matrix(origin, stops)
        node_indices = build_node_indices(stops)
        nn = nearest_neighbor_with_precedence(stops, matrix=matrix, node_indices=node_indices)
        improved = two_opt_with_precedence(nn, matrix=matrix, node_indices=node_indices)
        nn_distance = sequence_total_distance_km(nn, matrix=matrix, node_indices=node_indices)
        improved_distance = sequence_total_distance_km(
            improved,
            matrix=matrix,
            node_indices=node_indices,
        )
        assert improved_distance <= nn_distance + 1e-9
        assert is_precedence_valid(improved)


def test_exact_matches_brute_force_for_three_offers() -> None:
    origin = (52.23, 21.01)
    for seed in range(20):
        stops = _three_offers(seed)
        matrix = _build_matrix(origin, stops)
        node_indices = build_node_indices(stops)
        exact = optimize_exact_with_precedence(stops, matrix=matrix, node_indices=node_indices)
        brute = _brute_force_optimal(stops, matrix=matrix, node_indices=node_indices)
        exact_distance = sequence_total_distance_km(exact, matrix=matrix, node_indices=node_indices)
        brute_distance = sequence_total_distance_km(brute, matrix=matrix, node_indices=node_indices)
        assert abs(exact_distance - brute_distance) < 1e-6


def test_eta_minutes_increase_with_sequence_order() -> None:
    origin = (52.23, 21.01)
    stops = _three_offers(7)
    matrix = _build_matrix(origin, stops)
    node_indices = build_node_indices(stops)
    ordered = optimize_stop_sequence(stops, matrix=matrix, node_indices=node_indices)
    etas = compute_eta_minutes(ordered, matrix=matrix, node_indices=node_indices)
    assert etas == sorted(etas)
    assert all(eta >= 0 for eta in etas)


# ---------------------------------------------------------------------------
# Benchmarks (acceptance criteria)
# ---------------------------------------------------------------------------


def test_benchmark_exact_up_to_six_offers(benchmark) -> None:  # type: ignore[no-untyped-def]
    origin = (52.23, 21.01)
    stops = _offers(6, seed=42)
    matrix = _build_matrix(origin, stops)
    node_indices = build_node_indices(stops)

    def run() -> float:
        ordered = optimize_stop_sequence(stops, matrix=matrix, node_indices=node_indices)
        return sequence_total_distance_km(ordered, matrix=matrix, node_indices=node_indices)

    benchmark.pedantic(run, iterations=5, rounds=3)
    assert benchmark.stats.stats.max < 0.5


def test_benchmark_exact_up_to_ten_offers(benchmark) -> None:  # type: ignore[no-untyped-def]
    origin = (52.23, 21.01)
    stops = _offers(10, seed=99)
    matrix = _build_matrix(origin, stops)
    node_indices = build_node_indices(stops)

    def run() -> float:
        ordered = optimize_stop_sequence(stops, matrix=matrix, node_indices=node_indices)
        return sequence_total_distance_km(ordered, matrix=matrix, node_indices=node_indices)

    benchmark.pedantic(run, iterations=3, rounds=2)
    assert benchmark.stats.stats.max < 2.0


# ---------------------------------------------------------------------------
# Database idempotency (mocked persistence layer)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upsert_route_sequence_is_idempotent() -> None:
    from unittest.mock import AsyncMock, MagicMock

    session_id = uuid4()
    offer_id = uuid4()
    pickup_id = uuid4()
    delivery_id = uuid4()

    pickup_row = RouteStop(
        id=pickup_id,
        session_id=session_id,
        offer_id=offer_id,
        stop_type="pickup",
        sequence_order=0,
        location=None,
    )
    delivery_row = RouteStop(
        id=delivery_id,
        session_id=session_id,
        offer_id=offer_id,
        stop_type="delivery",
        sequence_order=1,
        location=None,
    )
    existing = [pickup_row, delivery_row]

    stops = [
        Stop(
            id=str(pickup_id),
            offer_id=offer_id,
            stop_type="pickup",
            location=(52.0, 21.0),
            handling_time_minutes=30,
        ),
        Stop(
            id=str(delivery_id),
            offer_id=offer_id,
            stop_type="delivery",
            location=(50.0, 19.0),
            handling_time_minutes=30,
        ),
    ]
    origin = (52.23, 21.01)
    matrix = _build_matrix(origin, stops)
    node_indices = build_node_indices(stops)
    ordered = optimize_stop_sequence(stops, matrix=matrix, node_indices=node_indices)

    db = AsyncMock()
    select_result = MagicMock()
    select_result.scalars.return_value.all.return_value = list(existing)
    db.execute = AsyncMock(return_value=select_result)
    db.flush = AsyncMock()

    service = SequenceOptimizerService()
    await service.upsert_route_sequence(
        db,
        session_id,
        ordered,
        matrix=matrix,
        node_indices=node_indices,
    )
    await service.upsert_route_sequence(
        db,
        session_id,
        list(reversed(ordered)),
        matrix=matrix,
        node_indices=node_indices,
    )

    assert db.add.call_count == 0
    assert pickup_row.sequence_order == 1
    assert delivery_row.sequence_order == 0
    rows_by_order = sorted([pickup_row, delivery_row], key=lambda row: row.sequence_order)
    etas = [row.eta_minutes_from_start for row in rows_by_order]
    assert etas == sorted(etas)
