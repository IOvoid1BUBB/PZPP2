"""Unit tests for European offer generation from logistics site catalog."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from app.services.european_offer_generator import (
    ALLOWED_LDM,
    LogisticsSite,
    format_site_label,
    generate_european_batch,
    generate_european_offer,
    validate_catalog,
)
from app.services.market_simulator import PALLET_LDM

_EWKT_RE = re.compile(r"^SRID=4326;POINT\((?P<lon>[-\d.]+)\s+(?P<lat>[-\d.]+)\)$")
_HANDLING_ALLOWED = {15, 30, 45, 60}
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_CATALOG_PATH = _BACKEND_ROOT / "data" / "european_logistics_sites.json"


def _site(
    site_id: str,
    *,
    company: str = "DHL",
    city: str = "Berlin",
    country: str = "DE",
    lat: float = 52.52,
    lon: float = 13.40,
) -> LogisticsSite:
    return LogisticsSite(
        id=site_id,
        company=company,
        facility_name=f"{company} DC {city}",
        facility_type="distribution_center",
        city=city,
        country_code=country,
        lat=lat,
        lon=lon,
        facility_code="DC",
    )


def _distant_sites() -> list[LogisticsSite]:
    return [
        _site("pickup-de", city="Hamburg", lat=53.55, lon=9.99),
        _site("delivery-pl", city="Warszawa", country="PL", lat=52.22, lon=21.01),
        _site("delivery-fr", city="Paris", country="FR", lat=48.85, lon=2.35),
    ]


def test_allowed_ldm_is_pallet_multiple() -> None:
    assert ALLOWED_LDM == tuple(round(k * PALLET_LDM, 1) for k in range(1, 11))
    for ldm in ALLOWED_LDM:
        assert abs((ldm / PALLET_LDM) - round(ldm / PALLET_LDM)) < 1e-9


def test_format_site_label() -> None:
    site = LogisticsSite(
        id="amazon-ber8",
        company="Amazon",
        facility_name="FC BER8",
        facility_code="BER8",
        facility_type="fulfillment_center",
        city="Schönefeld",
        country_code="DE",
        lat=52.38,
        lon=13.52,
    )
    assert format_site_label(site) == "Amazon BER8 · Schönefeld"


def test_generate_european_offer_ewkt_and_business_rules() -> None:
    base = datetime(2026, 6, 15, 8, 0, 0, tzinfo=UTC)
    item = generate_european_offer(_distant_sites(), base, index=1)

    offer = item.offer
    pickup_match = _EWKT_RE.match(offer.pickup_point)
    delivery_match = _EWKT_RE.match(offer.delivery_point)
    assert pickup_match is not None
    assert delivery_match is not None
    assert -180 <= float(pickup_match.group("lon")) <= 180
    assert -90 <= float(pickup_match.group("lat")) <= 90

    assert float(offer.ldm) in ALLOWED_LDM
    assert offer.weight_kg > 0
    assert offer.price_eur > 0
    assert offer.handling_time_minutes in _HANDLING_ALLOWED
    assert offer.time_window_close > offer.time_window_open
    assert offer.time_window_close - offer.time_window_open >= timedelta(hours=2)
    assert offer.pickup_label
    assert offer.delivery_label
    assert "·" in offer.pickup_label
    assert item.pickup_site_id != item.delivery_site_id


def test_generate_european_offer_respects_min_distance() -> None:
    base = datetime(2026, 6, 15, 0, 0, 0, tzinfo=UTC)
    close_sites = [
        _site("a", lat=52.22, lon=21.01),
        _site("b", lat=52.25, lon=21.05),
    ]
    with pytest.raises(ValueError, match="Unable to find valid pickup/delivery pair"):
        generate_european_offer(close_sites, base)


def test_generate_batch_count_and_labels() -> None:
    base = datetime(2026, 6, 15, 0, 0, 0, tzinfo=UTC)
    batch = generate_european_batch(_distant_sites(), 25, base_time=base, seed=99)
    assert len(batch) == 25
    for item in batch:
        assert item.offer.shipper_company
        assert Decimal(str(item.offer.ldm)) > 0


def test_catalog_file_meets_minimum_requirements() -> None:
    if not _CATALOG_PATH.is_file():
        pytest.skip("Catalog not built — run scripts/build_european_logistics_catalog.mjs")

    with _CATALOG_PATH.open(encoding="utf-8") as handle:
        raw = json.load(handle)

    sites = [LogisticsSite.from_dict(entry) for entry in raw]
    stats = validate_catalog(sites)
    assert stats["total_sites"] >= 1200
    assert stats["country_count"] >= 25
    assert stats["unique_coordinates"] >= 1000
