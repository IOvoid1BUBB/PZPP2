"""Unit tests for offline toll calculator."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator

import pytest
from app.core.logging import JsonFormatter
from app.services.toll_calculator import (
    _GEOJSON_PATH,
    ESTIMATE_RATES_EUR_PER_KM,
    TOLL_RATES,
    calculate_leg_tolls,
    calculate_route_tolls,
    estimate_toll_eur,
    load_country_geometries,
)
from shapely.geometry import LineString, box


def line_km(length_km: float, lon0: float, lat: float) -> LineString:
    """Build a horizontal segment whose degree length * 111 approximates *length_km*."""
    return LineString([(lon0, lat), (lon0 + length_km / 111.0, lat)])


def _patch_countries(
    monkeypatch: pytest.MonkeyPatch,
    countries: dict[str, object],
) -> dict[str, object]:
    monkeypatch.setattr(
        "app.services.toll_calculator.load_country_geometries",
        lambda: countries,
    )
    return countries


@pytest.fixture
def mock_countries(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    """Simplified country boxes for deterministic intersection lengths."""
    return _patch_countries(
        monkeypatch,
        {
            "PL": box(14, 49, 24, 55),
            "DE": box(5, 47, 15, 55),
            "CZ": box(12, 48, 18, 51),
            "XY": box(0, 0, 1, 1),
        },
    )


@pytest.fixture
def mock_countries_disjoint(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    """Non-overlapping boxes so each leg is billed in exactly one country."""
    return _patch_countries(
        monkeypatch,
        {
            "PL": box(20, 51, 26, 55),
            "DE": box(6, 51, 12, 55),
            "CZ": box(14, 48, 18, 50),
        },
    )


@pytest.fixture(autouse=True)
def clear_geometry_cache() -> Iterator[None]:
    if hasattr(load_country_geometries, "cache_clear"):
        load_country_geometries.cache_clear()
    yield
    if hasattr(load_country_geometries, "cache_clear"):
        load_country_geometries.cache_clear()


def test_pl_de_route_solo_within_five_percent(mock_countries: dict[str, object]) -> None:
    leg_pl = line_km(200, lon0=16, lat=52)
    leg_de = line_km(150, lon0=8, lat=52)

    result = calculate_route_tolls([leg_pl, leg_de], "man_solo")

    assert len(result.per_leg) == 2
    assert result.per_country["PL"] == pytest.approx(48.0, rel=0.05)
    assert result.per_country["DE"] == pytest.approx(41.1, rel=0.05)
    assert result.total_eur == pytest.approx(89.1, rel=0.05)
    assert result.per_leg[0].leg_total_eur == pytest.approx(48.0, rel=0.05)
    assert result.per_leg[1].leg_total_eur == pytest.approx(41.1, rel=0.05)


def test_unknown_country_zero_cost_and_json_warning(
    mock_countries: dict[str, object],
    caplog: pytest.LogCaptureFixture,
) -> None:
    leg_xy = line_km(100, lon0=0.1, lat=0.5)

    with caplog.at_level(logging.WARNING, logger="app.services.toll_calculator"):
        leg_toll = calculate_leg_tolls(leg_xy, "solo", leg_index=0)

    assert leg_toll.per_country.get("XY", 0.0) == 0.0
    assert leg_toll.leg_total_eur == 0.0

    warning_records = [r for r in caplog.records if r.levelname == "WARNING"]
    assert len(warning_records) >= 1
    record = next(r for r in warning_records if getattr(r, "country_code", None) == "XY")
    assert record.country_code == "XY"

    payload = json.loads(JsonFormatter().format(record))
    assert payload["level"] == "WARNING"
    assert payload["country_code"] == "XY"
    assert "XY" in payload["message"]


def test_three_country_route(mock_countries_disjoint: dict[str, object]) -> None:
    """Route through PL, DE, and CZ with one leg per country."""
    leg_pl = line_km(80, lon0=21, lat=52)
    leg_de = line_km(60, lon0=7, lat=52)
    leg_cz = line_km(40, lon0=14.5, lat=49)

    result = calculate_route_tolls([leg_pl, leg_de, leg_cz], "solo")

    assert len(result.per_leg) == 3
    assert set(result.per_country.keys()) == {"PL", "DE", "CZ"}
    assert result.per_country["PL"] == pytest.approx(80 * TOLL_RATES["PL"]["solo"], rel=0.05)
    assert result.per_country["DE"] == pytest.approx(60 * TOLL_RATES["DE"]["solo"], rel=0.05)
    assert result.per_country["CZ"] == pytest.approx(40 * TOLL_RATES["CZ"]["solo"], rel=0.05)


def test_load_country_geometries_singleton() -> None:
    if not _GEOJSON_PATH.is_file():
        pytest.skip("country_boundaries.geojson not present")

    first = load_country_geometries()
    second = load_country_geometries()
    assert first is second


@pytest.mark.skipif(not _GEOJSON_PATH.is_file(), reason="GeoJSON not downloaded")
def test_load_real_geojson_has_pl_and_de() -> None:
    countries = load_country_geometries()
    assert "PL" in countries
    assert "DE" in countries


# ---------------------------------------------------------------------------
# estimate_toll_eur (phase-1 API)
# ---------------------------------------------------------------------------


def test_estimate_toll_empty_geometry_returns_zero(mock_countries: dict[str, object]) -> None:
    for bad_geom in (
        {},
        {"type": "LineString", "coordinates": []},
        {"type": "Point", "coordinates": [0, 0]},
    ):
        toll, is_estimated = estimate_toll_eur(bad_geom, "solo", total_distance_km=500.0)
        assert toll == 0.0
        assert is_estimated is True


def test_estimate_toll_warsaw_to_berlin_positive(
    mock_countries_disjoint: dict[str, object],
) -> None:
    """WAW -> Berlin crosses PL and DE; toll must be positive."""
    route_geometry = {
        "type": "LineString",
        "coordinates": [
            [21.0122, 52.2297],
            [13.4050, 52.5200],
        ],
    }
    toll, is_estimated = estimate_toll_eur(route_geometry, "solo", total_distance_km=570.0)
    assert toll > 0.0
    assert is_estimated is True


@pytest.mark.parametrize(
    ("country", "lon0", "lat", "length_km"),
    [
        ("PL", 21.0, 52.0, 100.0),
        ("DE", 8.0, 52.0, 100.0),
        ("CZ", 15.0, 49.5, 80.0),
    ],
)
def test_estimate_toll_per_country_rates(
    mock_countries_disjoint: dict[str, object],
    country: str,
    lon0: float,
    lat: float,
    length_km: float,
) -> None:
    route_geometry = {
        "type": "LineString",
        "coordinates": [
            [lon0, lat],
            [lon0 + length_km / 111.0, lat],
        ],
    }
    toll, is_estimated = estimate_toll_eur(
        route_geometry,
        "bus",
        total_distance_km=length_km,
    )
    expected = length_km * ESTIMATE_RATES_EUR_PER_KM[country]
    assert toll == pytest.approx(expected, rel=0.05)
    assert is_estimated is True


@pytest.mark.skipif(not _GEOJSON_PATH.is_file(), reason="GeoJSON not downloaded")
def test_estimate_toll_warsaw_to_berlin_real_boundaries() -> None:
    route_geometry = {
        "type": "LineString",
        "coordinates": [
            [21.0122, 52.2297],
            [13.4050, 52.5200],
        ],
    }
    toll, is_estimated = estimate_toll_eur(route_geometry, "solo", total_distance_km=570.0)
    assert toll > 0.0
    assert is_estimated is True
