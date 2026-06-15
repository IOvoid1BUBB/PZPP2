"""Unit tests for the synthetic market-offer generator."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import pytest

from app.services.market_simulator import (
    LOGISTICS_HUBS,
    PALLET_LDM,
    generate_batch,
    generate_single_offer,
)

_HANDLING_ALLOWED = {15, 30, 45, 60}
# Dozwolone LDM: wielokrotności PALLET_LDM (0.4) dla k=1..10
_LDM_ALLOWED = {round(k * PALLET_LDM, 1) for k in range(1, 11)}


def test_generate_single_offer_fields() -> None:
    base = datetime(2026, 5, 18, 12, 0, 0, tzinfo=UTC)
    item = generate_single_offer(base)

    offer = item.offer
    assert offer.pickup_point.startswith("SRID=4326;POINT(")
    assert offer.delivery_point.startswith("SRID=4326;POINT(")
    assert offer.handling_time_minutes in _HANDLING_ALLOWED
    assert float(offer.ldm) in _LDM_ALLOWED, (
        f"ldm={offer.ldm} nie jest wielokrotnością {PALLET_LDM}"
    )
    assert offer.weight_kg > 0
    assert offer.price_eur > 0
    assert offer.time_window_open >= base
    assert offer.time_window_close > offer.time_window_open
    assert item.pickup_hub_key in LOGISTICS_HUBS
    assert item.delivery_hub_key in LOGISTICS_HUBS
    assert item.pickup_hub_key != item.delivery_hub_key


def test_ldm_is_pallet_multiple() -> None:
    """Każda wygenerowana oferta ma LDM = k × PALLET_LDM (k ∈ ℕ, k ≥ 1)."""
    base = datetime(2026, 5, 18, 0, 0, 0, tzinfo=UTC)
    for item in generate_batch(200, base_time=base):
        ldm = float(item.offer.ldm)
        quotient = ldm / PALLET_LDM
        assert abs(quotient - round(quotient)) < 1e-9, (
            f"ldm={ldm} nie jest wielokrotnością {PALLET_LDM} (quotient={quotient})"
        )
        assert quotient >= 1.0 - 1e-9, f"ldm={ldm} poniżej minimalnej 1 palety"


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


def test_generate_batch_requires_positive_count() -> None:
    with pytest.raises(ValueError, match="count must be at least 1"):
        generate_batch(0)
