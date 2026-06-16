"""Unit tests for deterministic offer scoring."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.lib.regional_p90 import (
    DEFAULT_P90_PRICE_PER_LDM,
    percentile_90,
    p90_cache_key,
    region_hash_from_coords,
)
from app.services.offer_detour import (
    MAX_DETOUR_KM,
    calculate_added_detour,
    haversine_added_detour_km,
)
from app.services.offer_scorer import (
    SessionScoringContext,
    calculate_time_window_score,
    calculate_time_window_score_from_strings,
    compute_detour_penalty_score,
    compute_fill_contribution_score,
    compute_revenue_density_score,
    compute_total_score,
    estimate_pickup_eta,
    score_offer,
)


# ---------------------------------------------------------------------------
# Pure component tests
# ---------------------------------------------------------------------------


def test_fill_contribution_score_mandatory_range() -> None:
    score = compute_fill_contribution_score(offer_ldm=5.0, free_ldm=5.5)
    assert 0.88 <= score <= 0.94


def test_fill_contribution_score_zero_free_ldm() -> None:
    assert compute_fill_contribution_score(5.0, 0.0) == 0.0


def test_fill_contribution_score_caps_at_one() -> None:
    assert compute_fill_contribution_score(10.0, 5.0) == 1.0


def test_detour_penalty_clamp_mandatory() -> None:
    score = compute_detour_penalty_score(added_km=300)
    assert score == -0.5
    total = compute_total_score(
        revenue_density_score=1.0,
        detour_penalty_score=score,
        fill_contribution_score=0.0,
        time_window_score=0.0,
    )
    assert total <= 0.25


def test_detour_penalty_no_detour() -> None:
    assert compute_detour_penalty_score(0.0) == 1.0


def test_detour_penalty_at_max() -> None:
    assert compute_detour_penalty_score(MAX_DETOUR_KM) == 0.0


def test_revenue_density_score() -> None:
    assert compute_revenue_density_score(100.0, 2.0, 50.0) == 1.0
    assert compute_revenue_density_score(50.0, 2.0, 50.0) == 0.5
    assert compute_revenue_density_score(10.0, 2.0, 0.0) == 0.0


def test_time_window_hard_conflict_mandatory() -> None:
    score = calculate_time_window_score_from_strings(
        offer_window="08:00-09:00",
        session_eta="14:00",
    )
    assert score == 0.0


def test_time_window_no_conflict() -> None:
    open_dt = datetime(2025, 5, 1, 8, 0, tzinfo=UTC)
    close_dt = datetime(2025, 5, 1, 10, 0, tzinfo=UTC)
    eta = datetime(2025, 5, 1, 9, 0, tzinfo=UTC)
    assert calculate_time_window_score(open_dt, close_dt, eta) == 1.0


def test_time_window_reorder_early_arrival() -> None:
    open_dt = datetime(2025, 5, 1, 10, 0, tzinfo=UTC)
    close_dt = datetime(2025, 5, 1, 12, 0, tzinfo=UTC)
    eta = datetime(2025, 5, 1, 9, 30, tzinfo=UTC)
    assert calculate_time_window_score(open_dt, close_dt, eta) == 0.5


def test_time_window_missing_window_returns_one() -> None:
    assert calculate_time_window_score(None, None, datetime.now(UTC)) == 1.0


def test_compute_total_score_weights() -> None:
    total = compute_total_score(1.0, 1.0, 1.0, 1.0)
    assert total == 1.0


def test_region_hash_deterministic() -> None:
    a = region_hash_from_coords(52.23, 21.01)
    b = region_hash_from_coords(52.23, 21.01)
    assert a == b
    assert p90_cache_key(a) == f"p90:{a}"


def test_percentile_90_empty_uses_default() -> None:
    assert percentile_90([]) == DEFAULT_P90_PRICE_PER_LDM


def test_percentile_90_values() -> None:
    values = [float(i) for i in range(1, 11)]
    assert percentile_90(values) == 9.0


# ---------------------------------------------------------------------------
# Detour helpers
# ---------------------------------------------------------------------------


def test_haversine_added_detour_from_origin() -> None:
    added = haversine_added_detour_km(
        [],
        (52.0, 21.0),
        (50.0, 19.0),
    )
    assert added > 0.0


@pytest.mark.asyncio
async def test_calculate_added_detour_routing() -> None:
    routing = AsyncMock()
    routing.get_route_multi = AsyncMock(
        return_value=MagicMock(total_distance_km=120.0),
    )
    added = await calculate_added_detour(
        routing,
        baseline_km=100.0,
        waypoints=[(52.0, 21.0)],
        pickup=(52.1, 21.1),
        delivery=(50.0, 19.0),
    )
    assert added == 20.0


@pytest.mark.asyncio
async def test_calculate_added_detour_routing_fallback() -> None:
    from app.core.exceptions import RoutingUnavailableError

    routing = AsyncMock()
    routing.get_route_multi = AsyncMock(side_effect=RoutingUnavailableError("down"))
    added = await calculate_added_detour(
        routing,
        baseline_km=0.0,
        waypoints=[(52.0, 21.0)],
        pickup=(52.1, 21.1),
        delivery=(50.0, 19.0),
    )
    assert added >= 0.0


# ---------------------------------------------------------------------------
# score_offer + ranking determinism
# ---------------------------------------------------------------------------


def _mock_offer(
    *,
    price: float = 500.0,
    ldm: float = 5.0,
    lat: float = 52.0,
    lon: float = 21.0,
) -> MagicMock:
    from geoalchemy2.shape import from_shape
    from shapely.geometry import Point

    offer = MagicMock()
    offer.id = uuid.uuid4()
    offer.price_eur = Decimal(str(price))
    offer.ldm = Decimal(str(ldm))
    offer.pickup_point = from_shape(Point(lon, lat), srid=4326)
    offer.delivery_point = from_shape(Point(lon + 1, lat - 1), srid=4326)
    offer.time_window_open = datetime(2025, 5, 1, 8, 0, tzinfo=UTC)
    offer.time_window_close = datetime(2025, 5, 1, 18, 0, tzinfo=UTC)
    offer.handling_time_minutes = 30
    return offer


@pytest.mark.asyncio
async def test_score_offer_deterministic() -> None:
    offer = _mock_offer()
    session = MagicMock()
    vehicle = MagicMock()
    vehicle.max_ldm = Decimal("13.6")
    routing = AsyncMock()
    context = SessionScoringContext(
        used_ldm=2.0,
        baseline_km=100.0,
        waypoints=[(52.0, 21.0)],
        reference_eta=datetime(2025, 5, 1, 9, 0, tzinfo=UTC),
        pickup_eta_minutes=60,
    )
    redis = AsyncMock()
    redis.get = AsyncMock(return_value="50.0")
    db = AsyncMock()

    first = await score_offer(
        offer,
        session,
        vehicle,
        routing,
        context=context,
        redis=redis,
        db=db,
        detour_km_override=25.0,
    )
    second = await score_offer(
        offer,
        session,
        vehicle,
        routing,
        context=context,
        redis=redis,
        db=db,
        detour_km_override=25.0,
    )
    assert first == second
    assert first.offer_id == offer.id
    assert first.added_km == 25.0
    assert first.estimated_added_cost_eur == round(25.0 * 0.45, 4)


@pytest.mark.asyncio
async def test_score_offer_redis_failure_still_scores() -> None:
    offer = _mock_offer()
    session = MagicMock()
    vehicle = MagicMock()
    vehicle.max_ldm = Decimal("13.6")
    routing = AsyncMock()
    context = SessionScoringContext(
        used_ldm=0.0,
        baseline_km=0.0,
        waypoints=[],
        reference_eta=None,
        pickup_eta_minutes=None,
    )
    redis = AsyncMock()
    redis.get = AsyncMock(side_effect=ConnectionError("redis down"))
    redis.setex = AsyncMock(side_effect=ConnectionError("redis down"))
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(all=lambda: [(Decimal("100"), Decimal("2"))]))

    result = await score_offer(
        offer,
        session,
        vehicle,
        routing,
        context=context,
        redis=redis,
        db=db,
        detour_km_override=10.0,
    )
    assert result.total_score >= 0.0


def test_estimate_pickup_eta_from_reference() -> None:
    ref = datetime(2025, 5, 1, 8, 0, tzinfo=UTC)
    eta = estimate_pickup_eta(ref, [(52.0, 21.0)], (52.5, 21.5))
    assert eta is not None
    assert eta > ref


def test_estimate_pickup_eta_no_reference() -> None:
    assert estimate_pickup_eta(None, [(52.0, 21.0)], (52.5, 21.5)) is None


def test_time_window_soft_late_reorder() -> None:
    open_dt = datetime(2025, 5, 1, 8, 0, tzinfo=UTC)
    close_dt = datetime(2025, 5, 1, 9, 0, tzinfo=UTC)
    eta = datetime(2025, 5, 1, 9, 30, tzinfo=UTC)
    assert calculate_time_window_score(open_dt, close_dt, eta) == 0.5


def test_time_window_too_early_hard_conflict() -> None:
    open_dt = datetime(2025, 5, 1, 14, 0, tzinfo=UTC)
    close_dt = datetime(2025, 5, 1, 16, 0, tzinfo=UTC)
    eta = datetime(2025, 5, 1, 6, 0, tzinfo=UTC)
    assert calculate_time_window_score(open_dt, close_dt, eta) == 0.0


@pytest.mark.asyncio
async def test_score_offer_exception_returns_zeros() -> None:
    from unittest.mock import patch

    offer = _mock_offer()
    session = MagicMock()
    vehicle = MagicMock()
    vehicle.max_ldm = Decimal("13.6")
    context = SessionScoringContext(
        used_ldm=0.0,
        baseline_km=0.0,
        waypoints=[],
        reference_eta=None,
        pickup_eta_minutes=None,
    )
    with patch(
        "app.services.offer_scorer.lat_lon_from_geometry",
        side_effect=RuntimeError("bad geometry"),
    ):
        result = await score_offer(
            offer,
            session,
            vehicle,
            AsyncMock(),
            context=context,
            redis=None,
            db=None,
        )
    assert result.total_score == 0.0


@pytest.mark.asyncio
async def test_deterministic_ranking_stable_sort() -> None:
    from app.schemas.offer import OfferScore

    scores = [
        OfferScore(
            offer_id=uuid.UUID("00000000-0000-0000-0000-000000000002"),
            total_score=0.5,
            revenue_density_score=0.5,
            detour_penalty_score=0.5,
            fill_contribution_score=0.5,
            time_window_score=0.5,
            added_km=1.0,
            estimated_added_cost_eur=0.45,
        ),
        OfferScore(
            offer_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
            total_score=0.5,
            revenue_density_score=0.5,
            detour_penalty_score=0.5,
            fill_contribution_score=0.5,
            time_window_score=0.5,
            added_km=1.0,
            estimated_added_cost_eur=0.45,
        ),
    ]
    ranked = sorted(scores, key=lambda s: (-s.total_score, str(s.offer_id)))
    assert str(ranked[0].offer_id) < str(ranked[1].offer_id)
