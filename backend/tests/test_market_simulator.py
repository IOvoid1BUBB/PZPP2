"""Unit tests for the synthetic market-offer generator."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import pytest

from app.services.market_simulator import (
    LOGISTICS_HUBS,
    generate_batch,
    generate_single_offer,
)

_HANDLING_ALLOWED = {15, 30, 45, 60}
_LDM_ALLOWED = {0.5, 1.0, 1.5, 2.0, 2.4, 3.0, 4.0, 6.0, 8.0, 13.6}


def test_generate_single_offer_fields() -> None:
    base = datetime(2026, 5, 18, 12, 0, 0, tzinfo=UTC)
    item = generate_single_offer(base)

    offer = item.offer
    assert offer.pickup_point.startswith("SRID=4326;POINT(")
    assert offer.delivery_point.startswith("SRID=4326;POINT(")
    assert offer.handling_time_minutes in _HANDLING_ALLOWED
    assert float(offer.ldm) in _LDM_ALLOWED
    assert offer.weight_kg > 0
    assert offer.price_eur > 0
    assert offer.time_window_open >= base
    assert offer.time_window_close > offer.time_window_open
    assert item.pickup_hub_key in LOGISTICS_HUBS
    assert item.delivery_hub_key in LOGISTICS_HUBS
    assert item.pickup_hub_key != item.delivery_hub_key


def test_time_window_width_at_least_two_hours() -> None:
    base = datetime(2026, 5, 18, 0, 0, 0, tzinfo=UTC)
    for _ in range(100):
        offer = generate_single_offer(base).offer
        width = offer.time_window_close - offer.time_window_open
        assert width >= timedelta(hours=2)


def test_batch_hub_diversity() -> None:
    base = datetime(2026, 5, 18, 0, 0, 0, tzinfo=UTC)
    batch = generate_batch(200, base_time=base)
    pickup_keys = {item.pickup_hub_key for item in batch}
    delivery_keys = {item.delivery_hub_key for item in batch}
    assert len(pickup_keys) >= 4
    assert len(delivery_keys) >= 5


def test_stackable_false_share_in_expected_band() -> None:
    base = datetime(2026, 5, 18, 0, 0, 0, tzinfo=UTC)
    batch = generate_batch(500, base_time=base)
    non_stackable = sum(1 for item in batch if not item.offer.stackable)
    share = non_stackable / len(batch)
    assert 0.25 <= share <= 0.45


def test_ldm_is_half_multiple() -> None:
    base = datetime(2026, 5, 18, 0, 0, 0, tzinfo=UTC)
    for item in generate_batch(50, base_time=base):
        ldm = float(item.offer.ldm)
        assert abs((ldm * 2) - round(ldm * 2)) < 1e-9


def test_generate_batch_requires_positive_count() -> None:
    with pytest.raises(ValueError, match="count must be at least 1"):
        generate_batch(0)
