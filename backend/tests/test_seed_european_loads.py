"""Tests for European loads seed catalog requirements."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.european_offer_generator import LogisticsSite, validate_catalog

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_CATALOG_PATH = _BACKEND_ROOT / "data" / "european_logistics_sites.json"


def test_catalog_unique_destinations_and_countries() -> None:
    if not _CATALOG_PATH.is_file():
        pytest.skip("Catalog not built — run scripts/build_european_logistics_catalog.mjs")

    with _CATALOG_PATH.open(encoding="utf-8") as handle:
        entries = json.load(handle)

    sites = [LogisticsSite.from_dict(entry) for entry in entries]
    stats = validate_catalog(sites)

    assert stats["total_sites"] >= 1090
    assert stats["unique_coordinates"] >= 1000
    assert stats["country_count"] >= 25

    ids = {site.id for site in sites}
    assert len(ids) == len(sites)
