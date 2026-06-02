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

from app.services.vrp_solver import _solve_cp_sat, _time_windows_overlap


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
