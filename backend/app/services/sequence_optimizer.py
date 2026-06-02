"""Stop sequence optimizer with pickup-before-delivery precedence constraints."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.lib.osrm import DistanceMatrix
from app.models.stop import RouteStop

StopType = Literal["pickup", "delivery"]

_ORIGIN_INDEX = 0
_MAX_EXACT_OFFERS = 10


@dataclass(frozen=True, slots=True)
class Stop:
    """A single pickup or delivery visit in the route."""

    id: str
    offer_id: UUID
    stop_type: StopType
    location: tuple[float, float]
    handling_time_minutes: int


def build_node_indices(
    stops: list[Stop],
) -> dict[str, int]:
    """Map each stop id to its row/column index in the distance matrix (origin is 0)."""
    return {stop.id: index + 1 for index, stop in enumerate(stops)}


def matrix_distance_km(
    from_index: int,
    to_index: int,
    matrix: DistanceMatrix,
) -> float:
    return matrix.distances_km[from_index][to_index]


def sequence_total_distance_km(
    sequence: list[Stop],
    *,
    matrix: DistanceMatrix,
    node_indices: dict[str, int],
) -> float:
    """Total travel distance for *sequence* starting at the matrix origin node."""
    if not sequence:
        return 0.0
    total = 0.0
    current = _ORIGIN_INDEX
    for stop in sequence:
        next_index = node_indices[stop.id]
        total += matrix_distance_km(current, next_index, matrix)
        current = next_index
    return total


def is_precedence_valid(sequence: list[Stop]) -> bool:
    """Return True when every pickup appears before its paired delivery."""
    pickup_positions: dict[UUID, int] = {}
    for index, stop in enumerate(sequence):
        if stop.stop_type == "pickup":
            pickup_positions[stop.offer_id] = index
        elif stop.stop_type == "delivery":
            pickup_index = pickup_positions.get(stop.offer_id)
            if pickup_index is None or pickup_index >= index:
                return False
    return True


def nearest_neighbor_with_precedence(
    stops: list[Stop],
    *,
    matrix: DistanceMatrix,
    node_indices: dict[str, int],
) -> list[Stop]:
    """Greedy nearest-neighbour tour respecting pickup-before-delivery precedence."""
    if not stops:
        return []

    remaining = list(stops)
    visited_pickups: set[UUID] = set()
    sequence: list[Stop] = []
    current_index = _ORIGIN_INDEX

    while remaining:
        best_stop: Stop | None = None
        best_distance = float("inf")

        for candidate in remaining:
            if candidate.stop_type == "delivery" and candidate.offer_id not in visited_pickups:
                continue
            next_index = node_indices[candidate.id]
            distance = matrix_distance_km(current_index, next_index, matrix)
            if distance < best_distance:
                best_distance = distance
                best_stop = candidate

        if best_stop is None:
            msg = "No valid next stop; precedence constraints may be unsatisfiable."
            raise ValueError(msg)

        remaining.remove(best_stop)
        sequence.append(best_stop)
        if best_stop.stop_type == "pickup":
            visited_pickups.add(best_stop.offer_id)
        current_index = node_indices[best_stop.id]

    return sequence


def two_opt_with_precedence(
    sequence: list[Stop],
    *,
    matrix: DistanceMatrix,
    node_indices: dict[str, int],
) -> list[Stop]:
    """Improve *sequence* with 2-opt reversals that preserve precedence."""
    if len(sequence) < 3:
        return list(sequence)

    best = list(sequence)
    best_distance = sequence_total_distance_km(best, matrix=matrix, node_indices=node_indices)
    improved = True

    while improved:
        improved = False
        for i in range(len(best) - 1):
            for j in range(i + 1, len(best)):
                candidate = best[:i] + list(reversed(best[i : j + 1])) + best[j + 1 :]
                if not is_precedence_valid(candidate):
                    continue
                candidate_distance = sequence_total_distance_km(
                    candidate,
                    matrix=matrix,
                    node_indices=node_indices,
                )
                if candidate_distance + 1e-9 < best_distance:
                    best = candidate
                    best_distance = candidate_distance
                    improved = True

    return best


def _offer_ids(stops: list[Stop]) -> list[UUID]:
    seen: list[UUID] = []
    for stop in stops:
        if stop.offer_id not in seen:
            seen.append(stop.offer_id)
    return seen


def _encode_offer_states(states: tuple[int, ...]) -> int:
    encoded = 0
    base = 1
    for value in states:
        encoded += value * base
        base *= 3
    return encoded


def optimize_exact_with_precedence(
    stops: list[Stop],
    *,
    matrix: DistanceMatrix,
    node_indices: dict[str, int],
) -> list[Stop]:
    """Minimum-distance tour via dynamic programming (valid for up to 10 offers)."""
    if not stops:
        return []

    offer_ids = _offer_ids(stops)
    offer_count = len(offer_ids)
    if offer_count > _MAX_EXACT_OFFERS:
        msg = f"Exact optimizer supports at most {_MAX_EXACT_OFFERS} offers, got {offer_count}."
        raise ValueError(msg)

    offer_index = {offer_id: index for index, offer_id in enumerate(offer_ids)}
    pickups: dict[UUID, Stop] = {}
    deliveries: dict[UUID, Stop] = {}
    for stop in stops:
        if stop.stop_type == "pickup":
            pickups[stop.offer_id] = stop
        else:
            deliveries[stop.offer_id] = stop

    node_count = matrix.n
    state_count = 3**offer_count
    inf = float("inf")
    costs = [[inf] * node_count for _ in range(state_count)]
    parents: list[list[tuple[int, int, Stop] | None]] = [
        [None] * node_count for _ in range(state_count)
    ]

    states_by_completion: list[list[tuple[int, tuple[int, ...]]]] = [
        [] for _ in range(offer_count * 2 + 1)
    ]
    transitions: list[list[tuple[int, int, Stop]]] = [[] for _ in range(state_count)]
    for state_code in range(state_count):
        states = _decode_offer_states(state_code, offer_count)
        states_by_completion[sum(states)].append((state_code, states))
        for offer_id in offer_ids:
            idx = offer_index[offer_id]
            status = states[idx]
            if status == 0:
                stop = pickups[offer_id]
                next_states = _set_offer_state(states, idx, 1)
            elif status == 1:
                stop = deliveries[offer_id]
                next_states = _set_offer_state(states, idx, 2)
            else:
                continue
            to_state = _encode_offer_states(next_states)
            to_index = node_indices[stop.id]
            transitions[state_code].append((to_state, to_index, stop))

    distances = matrix.distances_km
    initial_state = _encode_offer_states((0,) * offer_count)
    costs[initial_state][_ORIGIN_INDEX] = 0.0

    for completed, layer in enumerate(states_by_completion):
        if completed == len(states_by_completion) - 1:
            break
        for state_code, _states in layer:
            row_costs = costs[state_code]
            for last_index in range(node_count):
                current_cost = row_costs[last_index]
                if current_cost == inf:
                    continue
                distance_row = distances[last_index]
                for to_state, to_index, stop in transitions[state_code]:
                    new_cost = current_cost + distance_row[to_index]
                    if new_cost < costs[to_state][to_index]:
                        costs[to_state][to_index] = new_cost
                        parents[to_state][to_index] = (state_code, last_index, stop)

    final_state = _encode_offer_states((2,) * offer_count)
    best_index = min(range(node_count), key=lambda idx: costs[final_state][idx])
    if costs[final_state][best_index] == inf:
        msg = "No feasible precedence-respecting tour found."
        raise ValueError(msg)

    path: list[Stop] = []
    state_code = final_state
    node_index = best_index
    while parents[state_code][node_index] is not None:
        prev_state, prev_index, stop = parents[state_code][node_index]
        path.append(stop)
        state_code = prev_state
        node_index = prev_index
    path.reverse()
    return path


def _decode_offer_states(code: int, offer_count: int) -> tuple[int, ...]:
    states: list[int] = []
    value = code
    for _ in range(offer_count):
        states.append(value % 3)
        value //= 3
    return tuple(states)


def _set_offer_state(states: tuple[int, ...], offer_idx: int, new_value: int) -> tuple[int, ...]:
    as_list = list(states)
    as_list[offer_idx] = new_value
    return tuple(as_list)


def optimize_stop_sequence(
    stops: list[Stop],
    *,
    matrix: DistanceMatrix,
    node_indices: dict[str, int] | None = None,
    use_exact: bool = True,
) -> list[Stop]:
    """Return an optimized stop order (exact DP when ``use_exact`` and <= 10 offers)."""
    indices = node_indices or build_node_indices(stops)
    offer_count = len(_offer_ids(stops))
    if use_exact and offer_count <= _MAX_EXACT_OFFERS:
        return optimize_exact_with_precedence(stops, matrix=matrix, node_indices=indices)

    nn_sequence = nearest_neighbor_with_precedence(stops, matrix=matrix, node_indices=indices)
    return two_opt_with_precedence(nn_sequence, matrix=matrix, node_indices=indices)


def compute_eta_minutes(
    sequence: list[Stop],
    *,
    matrix: DistanceMatrix,
    node_indices: dict[str, int],
) -> list[int]:
    """Cumulative ETA at each stop (travel legs + prior handling times)."""
    etas: list[int] = []
    cumulative = 0
    current_index = _ORIGIN_INDEX
    for stop in sequence:
        next_index = node_indices[stop.id]
        cumulative += matrix.durations_minutes[current_index][next_index]
        etas.append(cumulative)
        cumulative += stop.handling_time_minutes
        current_index = next_index
    return etas


@dataclass(frozen=True, slots=True)
class RouteStopUpsertRow:
    """Values prepared for persisting an optimized sequence."""

    route_stop_id: UUID
    sequence_order: int
    eta_minutes_from_start: int


class SequenceOptimizerService:
    """Optimizes stop order and persists results to ``route_stops``."""

    async def optimize_and_persist(
        self,
        db: AsyncSession,
        session_id: UUID,
        stops: list[Stop],
        *,
        matrix: DistanceMatrix,
        node_indices: dict[str, int] | None = None,
    ) -> list[Stop]:
        """Optimize, replace the session sequence in the DB, and return the new order."""
        indices = node_indices or build_node_indices(stops)
        ordered = optimize_stop_sequence(stops, matrix=matrix, node_indices=indices)
        await self.upsert_route_sequence(
            db,
            session_id,
            ordered,
            matrix=matrix,
            node_indices=indices,
        )
        return ordered

    async def upsert_route_sequence(
        self,
        db: AsyncSession,
        session_id: UUID,
        sequence: list[Stop],
        *,
        matrix: DistanceMatrix,
        node_indices: dict[str, int],
    ) -> list[RouteStopUpsertRow]:
        """Replace route stop ordering for *session_id* without creating duplicates."""
        if not sequence:
            await db.execute(delete(RouteStop).where(RouteStop.session_id == session_id))
            await db.flush()
            return []

        stmt = select(RouteStop).where(RouteStop.session_id == session_id)
        result = await db.execute(stmt)
        existing = {str(row.id): row for row in result.scalars().all()}

        sequence_ids = {stop.id for stop in sequence}
        stale_ids = [row_id for row_id in existing if row_id not in sequence_ids]
        if stale_ids:
            await db.execute(
                delete(RouteStop).where(
                    RouteStop.session_id == session_id,
                    RouteStop.id.in_([existing[row_id].id for row_id in stale_ids]),
                ),
            )
            for row_id in stale_ids:
                existing.pop(row_id)

        etas = compute_eta_minutes(sequence, matrix=matrix, node_indices=node_indices)
        rows: list[RouteStopUpsertRow] = []

        for order, (stop, eta) in enumerate(zip(sequence, etas, strict=True)):
            route_stop = existing.get(stop.id)
            if route_stop is None:
                route_stop = RouteStop(
                    id=UUID(stop.id),
                    session_id=session_id,
                    offer_id=stop.offer_id,
                    stop_type=stop.stop_type,
                    sequence_order=order,
                    location=_point_from_lat_lon(stop.location),
                    eta_minutes_from_start=eta,
                )
                db.add(route_stop)
                existing[stop.id] = route_stop
            else:
                route_stop.sequence_order = order
                route_stop.eta_minutes_from_start = eta
                route_stop.stop_type = stop.stop_type
                route_stop.offer_id = stop.offer_id

            rows.append(
                RouteStopUpsertRow(
                    route_stop_id=route_stop.id,
                    sequence_order=order,
                    eta_minutes_from_start=eta,
                ),
            )

        await db.flush()
        return rows


def _point_from_lat_lon(location: tuple[float, float]) -> object:
    from app.lib.geo import point_from_lon_lat

    lat, lon = location
    return point_from_lon_lat(lon, lat)
