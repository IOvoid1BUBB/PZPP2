"""Unit tests for the CP-SAT VRP solver.

Tests run fully in-memory without a database connection:
- time-window conflict exclusions
- capacity constraints (LDM / weight / stop count)
- determinism with random_seed=42
- INFEASIBLE when capacity is zero
- property: 100 random instances satisfy LDM bound
"""

from __future__ import annotations

import os
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)

from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.services.sequence_optimizer import Stop, is_precedence_valid
from app.services.sessions import SessionService
from app.services.vrp_solver import _solve_cp_sat, _solve_mock, _time_windows_overlap


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _loc(lat: float = 52.0, lon: float = 21.0) -> Any:
    return from_shape(Point(lon, lat), srid=4326)


@dataclass
class _Offer:
    """Minimal stand-in for MarketOffer."""

    id: Any
    price_eur: float
    ldm: float
    weight_kg: int
    handling_time_minutes: int = 30
    time_window_open: datetime | None = None
    time_window_close: datetime | None = None
    pickup_point: Any = None
    delivery_point: Any = None

    def __post_init__(self) -> None:
        if self.pickup_point is None:
            self.pickup_point = _loc()
        if self.delivery_point is None:
            self.delivery_point = _loc(51.0, 20.0)


def _offer(
    price: float = 500.0,
    ldm: float = 2.0,
    weight_kg: int = 500,
    *,
    open_dt: datetime | None = None,
    close_dt: datetime | None = None,
) -> _Offer:
    return _Offer(
        id=uuid4(),
        price_eur=price,
        ldm=ldm,
        weight_kg=weight_kg,
        time_window_open=open_dt,
        time_window_close=close_dt,
    )


def _net_cents(offers: list[_Offer], net_per_offer: float = 200.0) -> list[int]:
    return [int(net_per_offer * 100)] * len(offers)


# ---------------------------------------------------------------------------
# _time_windows_overlap unit tests
# ---------------------------------------------------------------------------

def test_overlap_both_none() -> None:
    assert _time_windows_overlap(None, None, None, None) is False


def test_overlap_one_none() -> None:
    now = datetime.now(UTC)
    later = now + timedelta(hours=2)
    assert _time_windows_overlap(now, later, None, None) is False


def test_overlap_true() -> None:
    t0 = datetime(2025, 6, 1, 8, 0, tzinfo=UTC)
    t1 = datetime(2025, 6, 1, 12, 0, tzinfo=UTC)
    t2 = datetime(2025, 6, 1, 10, 0, tzinfo=UTC)
    t3 = datetime(2025, 6, 1, 14, 0, tzinfo=UTC)
    assert _time_windows_overlap(t0, t1, t2, t3) is True


def test_overlap_non_overlapping() -> None:
    t0 = datetime(2025, 6, 1, 8, 0, tzinfo=UTC)
    t1 = datetime(2025, 6, 1, 10, 0, tzinfo=UTC)
    t2 = datetime(2025, 6, 1, 12, 0, tzinfo=UTC)
    t3 = datetime(2025, 6, 1, 14, 0, tzinfo=UTC)
    assert _time_windows_overlap(t0, t1, t2, t3) is False


def test_overlap_adjacent_windows_is_overlap() -> None:
    """Windows [8,10] and [10,12] share endpoint — treated as overlap."""
    t0 = datetime(2025, 6, 1, 8, 0, tzinfo=UTC)
    t1 = datetime(2025, 6, 1, 10, 0, tzinfo=UTC)
    t2 = datetime(2025, 6, 1, 10, 0, tzinfo=UTC)
    t3 = datetime(2025, 6, 1, 12, 0, tzinfo=UTC)
    assert _time_windows_overlap(t0, t1, t2, t3) is True


# ---------------------------------------------------------------------------
# _solve_cp_sat — capacity constraints
# ---------------------------------------------------------------------------

def test_ldm_constraint_not_exceeded() -> None:
    offers = [_offer(ldm=3.0) for _ in range(4)]
    free_ldm = 6.0  # at most 2 offers
    net_cents = _net_cents(offers)
    selected, _, status, _, _ = _solve_cp_sat(
        offers, free_ldm, 99_999, 10, net_cents, 5.0
    )
    total_ldm = sum(float(offers[i].ldm) for i in selected)
    assert total_ldm <= free_ldm
    assert status in ("OPTIMAL", "FEASIBLE")


def test_weight_constraint_not_exceeded() -> None:
    offers = [_offer(weight_kg=500) for _ in range(6)]
    free_weight = 1200  # at most 2 offers
    net_cents = _net_cents(offers)
    selected, _, _, _, _ = _solve_cp_sat(
        offers, 99.0, free_weight, 10, net_cents, 5.0
    )
    total_weight = sum(offers[i].weight_kg for i in selected)
    assert total_weight <= free_weight


def test_max_stops_constraint() -> None:
    offers = [_offer() for _ in range(10)]
    net_cents = _net_cents(offers, 100.0)
    selected, _, _, _, _ = _solve_cp_sat(
        offers, 99.0, 999_999, 3, net_cents, 5.0
    )
    assert len(selected) <= 3


def test_zero_capacity_selects_nothing() -> None:
    """When free_ldm=0 the only feasible solution is to select nothing.

    OR-Tools returns OPTIMAL (the empty selection satisfies all constraints)
    rather than INFEASIBLE, since selecting 0 offers is always a valid solution.
    """
    offers = [_offer(ldm=5.0)]
    selected, obj_cents, status, _, _ = _solve_cp_sat(
        offers, 0.0, 0, 10, [100], 5.0
    )
    assert selected == []
    assert obj_cents == 0
    assert status in ("OPTIMAL", "FEASIBLE")


def test_max_stops_zero_selects_nothing() -> None:
    """max_offer_slots=0 forces the empty selection, resolved as OPTIMAL."""
    offers = [_offer() for _ in range(5)]
    selected, _, status, _, _ = _solve_cp_sat(
        offers, 10.0, 99_999, 0, _net_cents(offers), 5.0
    )
    assert selected == []
    assert status in ("OPTIMAL", "FEASIBLE")


# ---------------------------------------------------------------------------
# _solve_cp_sat — time-window conflict exclusions
# ---------------------------------------------------------------------------

def test_time_window_conflicts_excluded() -> None:
    """
    5 offers with 2 conflicting pairs:
      (o0, o1) overlap  [08:00–12:00] vs [10:00–14:00]
      (o3, o4) overlap  [15:00–17:00] vs [16:00–18:00]
    Solver must not select both members of any conflicting pair.
    """
    t = lambda h: datetime(2025, 6, 1, h, 0, tzinfo=UTC)

    offers = [
        _offer(price=600.0, ldm=1.0, open_dt=t(8),  close_dt=t(12)),
        _offer(price=600.0, ldm=1.0, open_dt=t(10), close_dt=t(14)),
        _offer(price=500.0, ldm=1.0),  # no time window
        _offer(price=550.0, ldm=1.0, open_dt=t(15), close_dt=t(17)),
        _offer(price=550.0, ldm=1.0, open_dt=t(16), close_dt=t(18)),
    ]
    net_cents = [int(o.price_eur * 100) for o in offers]

    selected, _, status, _, _ = _solve_cp_sat(
        offers, 10.0, 99_999, 5, net_cents, 5.0
    )
    assert status in ("OPTIMAL", "FEASIBLE")

    selected_set = set(selected)
    assert not ({0, 1} <= selected_set), "conflicting pair (0, 1) both selected"
    assert not ({3, 4} <= selected_set), "conflicting pair (3, 4) both selected"


# ---------------------------------------------------------------------------
# _solve_cp_sat — determinism
# ---------------------------------------------------------------------------

def test_determinism_same_input_same_output() -> None:
    """Same input + random_seed=42 must always produce the same selection."""
    offers = [_offer(ldm=1.0, weight_kg=200) for _ in range(10)]
    net_cents = [i * 1000 + 500 for i in range(10)]

    sel1, obj1, _, _, _ = _solve_cp_sat(
        offers, 5.0, 99_999, 5, net_cents, 5.0
    )
    sel2, obj2, _, _, _ = _solve_cp_sat(
        offers, 5.0, 99_999, 5, net_cents, 5.0
    )

    assert sel1 == sel2
    assert obj1 == obj2


# ---------------------------------------------------------------------------
# Property test: 100 random instances — LDM always respected
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("seed", range(100))
def test_ldm_always_respected_random_instances(seed: int) -> None:
    """For 100 random problem instances, selected LDM <= free_ldm."""
    rng = random.Random(seed)
    n = rng.randint(1, 15)
    free_ldm = rng.uniform(2.0, 20.0)
    free_weight = rng.randint(500, 10_000)
    max_slots = rng.randint(1, n)

    offers = [
        _offer(
            ldm=round(rng.uniform(0.5, 4.0), 1),
            weight_kg=rng.randint(100, 1000),
        )
        for _ in range(n)
    ]
    net_cents = [rng.randint(-500, 5000) for _ in range(n)]

    selected, _, status, _, _ = _solve_cp_sat(
        offers, free_ldm, free_weight, max_slots, net_cents, 2.0
    )

    if status in ("OPTIMAL", "FEASIBLE"):
        total_ldm = sum(float(offers[i].ldm) for i in selected)
        assert total_ldm <= free_ldm + 1e-6, (
            f"LDM {total_ldm:.3f} exceeds free_ldm {free_ldm:.3f} (seed={seed})"
        )


# ---------------------------------------------------------------------------
# Mock solver branch
# ---------------------------------------------------------------------------

def test_mock_solver_branch() -> None:
    """Mock solver picks first 3 offers without OR-Tools."""
    offers = [_offer(price=100.0 + i) for i in range(5)]
    selected, obj_cents, status, is_optimal, elapsed_ms = _solve_mock(offers)
    assert selected == [0, 1, 2]
    assert status == "OPTIMAL"
    assert is_optimal is True
    assert elapsed_ms == 42
    assert obj_cents == int((100.0 + 101.0 + 102.0) * 100)


def test_build_stop_sequence_precedence() -> None:
    """Serialized stop sequence respects pickup-before-delivery per offer."""
    offer_a, offer_b = uuid4(), uuid4()
    stops = [
        Stop(
            id="1",
            offer_id=offer_a,
            stop_type="pickup",
            location=(52.0, 21.0),
            handling_time_minutes=30,
        ),
        Stop(
            id="2",
            offer_id=offer_b,
            stop_type="pickup",
            location=(52.1, 21.1),
            handling_time_minutes=30,
        ),
        Stop(
            id="3",
            offer_id=offer_a,
            stop_type="delivery",
            location=(51.0, 20.0),
            handling_time_minutes=30,
        ),
        Stop(
            id="4",
            offer_id=offer_b,
            stop_type="delivery",
            location=(51.1, 20.1),
            handling_time_minutes=30,
        ),
    ]
    assert is_precedence_valid(stops)

    stop_ids = [uuid4() for _ in range(4)]

    class _FakeStop:
        def __init__(self, stop_id: Any, offer_id: Any, stop_type: str, seq: int) -> None:
            self.id = stop_id
            self.offer_id = offer_id
            self.stop_type = stop_type
            self.sequence_order = seq

    fake_route_stops = [
        _FakeStop(stop_ids[0], offer_a, "pickup", 0),
        _FakeStop(stop_ids[1], offer_b, "pickup", 1),
        _FakeStop(stop_ids[2], offer_a, "delivery", 2),
        _FakeStop(stop_ids[3], offer_b, "delivery", 3),
    ]
    entries = SessionService.serialize_stop_sequence(fake_route_stops)  # type: ignore[arg-type]
    assert len(entries) == 4
    pickup_orders = {
        e.offer_id: e.sequence_order for e in entries if e.stop_type == "pickup"
    }
    delivery_orders = {
        e.offer_id: e.sequence_order for e in entries if e.stop_type == "delivery"
    }
    for oid in (offer_a, offer_b):
        assert pickup_orders[oid] < delivery_orders[oid]


# ---------------------------------------------------------------------------
# VRPSolver.solve / cancel — mocked async unit tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_vrp_solver_solve_mock_applies_route(monkeypatch: pytest.MonkeyPatch) -> None:
    """solve() with USE_SOLVER_MOCK applies selection and returns stop_sequence."""
    from unittest.mock import AsyncMock, MagicMock

    from app.core.config import Settings
    from app.schemas.solver import StopSequenceEntry
    from app.services.vrp_solver import VRPSolver

    session_id = uuid4()
    offer_ids = [uuid4(), uuid4(), uuid4(), uuid4()]

    vehicle = MagicMock()
    vehicle.max_ldm = 20.0
    vehicle.max_weight_kg = 20_000
    vehicle.max_stops = 12
    vehicle.type = "standard"

    session = MagicMock()
    session.id = session_id
    session.status = "draft"
    session.vehicle = vehicle
    session.driver_profile = MagicMock()
    session.origin_lat = 52.0
    session.origin_lon = 21.0
    session.route_stops = []
    session.solver_run_id = None

    offers = [
        _Offer(id=oid, price_eur=100.0 + i, ldm=1.0, weight_kg=100)
        for i, oid in enumerate(offer_ids)
    ]

    stop_sequence = [
        StopSequenceEntry(
            route_stop_id=uuid4(),
            offer_id=offer_ids[i],
            stop_type="pickup" if j == 0 else "delivery",
            sequence_order=k,
        )
        for i in range(3)
        for j, k in [(0, i * 2), (1, i * 2 + 1)]
    ]

    mock_db = AsyncMock()
    mock_db.flush = AsyncMock()
    mock_db.add = MagicMock()

    async def _refresh(obj: object) -> None:
        if not getattr(obj, "id", None):
            obj.id = uuid4()  # type: ignore[attr-defined]

    mock_db.refresh = AsyncMock(side_effect=_refresh)

    solver = VRPSolver(
        mock_db,
        osrm=AsyncMock(),
        settings=Settings(
            DATABASE_URL="postgresql+asyncpg://x:x@localhost/x",
            USE_SOLVER_MOCK=True,
        ),
    )

    solver._load_session = AsyncMock(return_value=session)  # type: ignore[method-assign]
    solver._fetch_offers = AsyncMock(return_value=offers)  # type: ignore[method-assign]
    solver._session_service._session_offer_ids = AsyncMock(return_value=[offer_ids[0]])  # type: ignore[method-assign]

    class _FakeRouteStop:
        def __init__(self, stop_id: UUID, offer_id: UUID, stop_type: str, seq: int) -> None:
            self.id = stop_id
            self.offer_id = offer_id
            self.stop_type = stop_type
            self.sequence_order = seq
            self.location = _loc()
            self.offer = MagicMock(handling_time_minutes=30)

    ordered_stops = [
        _FakeRouteStop(uuid4(), offer_ids[i], "pickup", i * 2)
        for i in range(3)
    ] + [
        _FakeRouteStop(uuid4(), offer_ids[i], "delivery", i * 2 + 1)
        for i in range(3)
    ]

    solver._session_service._apply_offers_and_optimize_route = AsyncMock(  # type: ignore[method-assign]
        return_value=ordered_stops,
    )
    monkeypatch.setattr(
        SessionService,
        "serialize_stop_sequence",
        staticmethod(lambda stops: stop_sequence),
    )
    monkeypatch.setattr(
        SessionService,
        "_build_stops_from_route_stops",
        staticmethod(lambda stops: []),
    )
    monkeypatch.setattr(
        "app.services.vrp_solver.is_precedence_valid",
        lambda _stops: True,
    )

    result = await solver.solve(
        session_id=session_id,
        candidate_offer_ids=offer_ids,
        max_stops_override=None,
        time_limit_seconds=10,
    )

    assert result.solver_status == "OPTIMAL"
    assert result.solve_time_ms == 42
    assert len(result.selected_offer_ids) == 3
    assert result.current_offer_ids == [offer_ids[0]]
    assert len(result.stop_sequence) == 6
    solver._session_service._apply_offers_and_optimize_route.assert_awaited_once()


@pytest.mark.asyncio
async def test_vrp_solver_solve_empty_ranked_infeasible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Empty ranked candidates return INFEASIBLE and persist a solver_results row."""
    from unittest.mock import AsyncMock, MagicMock

    from app.core.config import Settings
    from app.schemas.offer import RankedOffersResponse
    from app.services.vrp_solver import VRPSolver

    session_id = uuid4()
    vehicle = MagicMock()
    vehicle.max_stops = 12

    session = MagicMock()
    session.status = "draft"
    session.vehicle = vehicle
    session.driver_profile = MagicMock()
    session.solver_run_id = None

    mock_db = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.flush = AsyncMock()
    mock_db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", uuid4()))

    solver = VRPSolver(
        mock_db,
        settings=Settings(
            DATABASE_URL="postgresql+asyncpg://x:x@localhost/x",
        ),
    )
    solver._load_session = AsyncMock(return_value=session)  # type: ignore[method-assign]
    solver._session_service._session_offer_ids = AsyncMock(return_value=[])  # type: ignore[method-assign]

    mock_scorer = AsyncMock()
    mock_scorer.rank_offers = AsyncMock(
        return_value=RankedOffersResponse(
            session_id=session_id,
            limit=6,
            scored_count=0,
            offers=[],
        ),
    )
    monkeypatch.setattr(
        "app.services.vrp_solver.OfferScorerService",
        lambda db, osrm=None: mock_scorer,
    )

    result = await solver.solve(
        session_id=session_id,
        candidate_offer_ids=[],
        max_stops_override=None,
        time_limit_seconds=10,
    )
    assert result.solver_status == "INFEASIBLE"
    assert result.selected_offer_ids == []
    mock_db.add.assert_called()


@pytest.mark.asyncio
async def test_vrp_solver_cancel_updates_latest_result() -> None:
    """cancel() marks the latest SolverResult as CANCELLED."""
    from unittest.mock import AsyncMock, MagicMock

    from app.core.config import Settings
    from app.services.vrp_solver import VRPSolver

    session_id = uuid4()
    session = MagicMock()
    session.solver_run_id = None

    existing = MagicMock()
    existing.id = uuid4()
    existing.solver_status = "OPTIMAL"

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = existing

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_db.flush = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.refresh = AsyncMock()

    solver = VRPSolver(
        mock_db,
        settings=Settings(DATABASE_URL="postgresql+asyncpg://x:x@localhost/x"),
    )
    solver._load_session = AsyncMock(return_value=session)  # type: ignore[method-assign]
    solver._session_service._session_offer_ids = AsyncMock(return_value=[])  # type: ignore[method-assign]

    result = await solver.cancel(session_id)
    assert result.solver_status == "CANCELLED"
    assert existing.solver_status == "CANCELLED"
