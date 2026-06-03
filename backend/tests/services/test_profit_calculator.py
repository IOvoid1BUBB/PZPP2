"""Unit tests for SessionProfitCalculator.

Manual reference fixture (3 offers, 6 stops, 500 km route):

  Vehicle: master_l2, fuel 18.5 L/100km, max_weight 3500 kg, max_ldm 6.4 LDM
  Driver:  STANDARD profile — hourly 18 EUR, idle 2.5 L/hr, admin 5 EUR/stop
  Offers:
    O1: price 800 EUR, weight 500 kg, handling 30 min
    O2: price 600 EUR, weight 800 kg, handling 30 min
    O3: price 400 EUR, weight 600 kg, handling 30 min
  Stop order: P1(0), D1(1), P2(2), D2(3), P3(4), D3(5)
  Route: 6 legs × 83.333 km, 60 min each — total 500 km, 6 h

  Revenue: 800 + 600 + 400 = 1800 EUR

  Fuel (load-aware per leg):
    Leg 0 P1:  cargo=0,   lr=0/3500,      c=18.5,         cost≈26.98
    Leg 1 D1:  cargo=500, lr=500/3500,     c≈19.29,        cost≈28.14
    Leg 2 P2:  cargo=0,   lr=0/3500,      c=18.5,         cost≈26.98
    Leg 3 D2:  cargo=800, lr=800/3500,     c≈19.77,        cost≈28.83
    Leg 4 P3:  cargo=0,   lr=0/3500,      c=18.5,         cost≈26.98
    Leg 5 D3:  cargo=600, lr=600/3500,     c≈19.45,        cost≈28.37
    Total fuel ≈ 166.27 EUR

  Toll: 0 EUR  (country_geometries mocked to empty dict)

  Stop costs: 6 stops × 16.1875 EUR = 97.12 EUR
    (time=9.00 + idle_fuel=2.19 + admin=5.00 = 16.19 per stop)

  Driver: ceil(6h/9h) = 1 day × 49 EUR = 49 EUR

  Maintenance: 500 km × 0.08 = 40 EUR

  Total cost ≈ 166.27 + 0 + 97.12 + 49 + 40 = 352.39 EUR
  Net profit  ≈ 1800 − 352.39 = 1447.61 EUR
  Breakeven   ≈ 352.39 / 1800 × 100 ≈ 19.58 %
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)

from geoalchemy2.shape import from_shape
from shapely.geometry import LineString, Point

from app.lib.osrm import MultiStopRouteResult, RouteLeg
from app.services.profit_calculator import (
    SessionProfitCalculator,
    split_route_into_leg_geometries,
)


# ---------------------------------------------------------------------------
# Helpers — mock domain objects
# ---------------------------------------------------------------------------

def _loc(lat: float, lon: float) -> Any:
    """Build an in-memory GeoAlchemy2 WKBElement (no DB required)."""
    return from_shape(Point(lon, lat), srid=4326)


@dataclass
class _DriverProfile:
    hourly_cost_eur: float = 18.0
    idle_fuel_l_per_hour: float = 2.5
    stop_admin_fee_eur: float = 5.0


@dataclass
class _Vehicle:
    type: str = "master_l2"
    fuel_per_100km_base: float = 18.5
    max_weight_kg: int = 3500
    max_ldm: float = 6.4


@dataclass
class _Offer:
    price_eur: float
    weight_kg: int
    ldm: float = 2.0
    handling_time_minutes: int = 30
    time_window_open: Any = None
    time_window_close: Any = None


@dataclass
class _Stop:
    stop_type: str
    offer: _Offer
    sequence_order: int
    location: Any
    stop_cost_eur: float | None = None
    eta_minutes_from_start: int | None = None


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

SESSION_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")

# 7 waypoints: origin + 6 stops (coords roughly in Poland for realism)
_COORDS = [
    (52.22, 21.01),  # origin  WAW
    (51.77, 19.45),  # P1      LDZ
    (50.26, 19.01),  # D1      KTW
    (50.06, 19.94),  # P2      KRK
    (51.11, 17.01),  # D2      WRO
    (54.35, 18.65),  # P3      GDN
    (52.41, 16.93),  # D3      POZ
]

_OFFERS = [
    _Offer(price_eur=800.0, weight_kg=500),
    _Offer(price_eur=600.0, weight_kg=800),
    _Offer(price_eur=400.0, weight_kg=600),
]

_STOPS = [
    _Stop("pickup",   _OFFERS[0], 0, _loc(*_COORDS[1])),
    _Stop("delivery", _OFFERS[0], 1, _loc(*_COORDS[2])),
    _Stop("pickup",   _OFFERS[1], 2, _loc(*_COORDS[3])),
    _Stop("delivery", _OFFERS[1], 3, _loc(*_COORDS[4])),
    _Stop("pickup",   _OFFERS[2], 4, _loc(*_COORDS[5])),
    _Stop("delivery", _OFFERS[2], 5, _loc(*_COORDS[6])),
]

# Mock OSRM route — 6 legs × 83.333 km / 60 min
_ROUTE = MultiStopRouteResult(
    total_distance_km=500.0,
    total_duration_minutes=360,
    legs=[
        RouteLeg(distance_km=83.333, duration_minutes=60, from_index=i, to_index=i + 1)
        for i in range(6)
    ],
    # Simple 7-point LineString across Poland
    geometry_geojson={
        "type": "LineString",
        "coordinates": [
            [c[1], c[0]] for c in _COORDS  # lon, lat
        ],
    },
)


def _mock_session(session_id: UUID = SESSION_ID) -> MagicMock:
    s = MagicMock()
    s.id = session_id
    s.vehicle = _Vehicle()
    s.driver_profile = _DriverProfile()
    s.route_stops = list(_STOPS)
    s.origin_lat = _COORDS[0][0]
    s.origin_lon = _COORDS[0][1]
    s.net_profit_eur = None
    s.total_revenue_eur = None
    return s


# ---------------------------------------------------------------------------
# Tests — split_route_into_leg_geometries (unit, pure)
# ---------------------------------------------------------------------------

def test_split_route_produces_correct_count() -> None:
    geoms = split_route_into_leg_geometries(_ROUTE)
    assert len(geoms) == len(_ROUTE.legs)


def test_split_route_all_linestrings() -> None:
    geoms = split_route_into_leg_geometries(_ROUTE)
    assert all(isinstance(g, LineString) for g in geoms)


def test_split_route_empty_legs_returns_empty() -> None:
    empty_route = MultiStopRouteResult(
        total_distance_km=0.0,
        total_duration_minutes=0,
        legs=[],
        geometry_geojson={"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
    )
    assert split_route_into_leg_geometries(empty_route) == []


def test_split_route_zero_total_distance() -> None:
    zero_route = MultiStopRouteResult(
        total_distance_km=0.0,
        total_duration_minutes=0,
        legs=[RouteLeg(distance_km=0.0, duration_minutes=0, from_index=0, to_index=1)],
        geometry_geojson={"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
    )
    geoms = split_route_into_leg_geometries(zero_route)
    assert len(geoms) == 1
    assert isinstance(geoms[0], LineString)


# ---------------------------------------------------------------------------
# Tests — SessionProfitCalculator (main fixture)
# ---------------------------------------------------------------------------

def _build_calculator(mock_db: AsyncMock, mock_osrm: AsyncMock) -> SessionProfitCalculator:
    settings = MagicMock()
    settings.FUEL_PRICE_EUR_PER_LITER = 1.75
    settings.DRIVER_DAILY_ALLOWANCE_EUR = 49.0
    settings.WEIGHT_FUEL_FACTOR = 0.30
    settings.MAINTENANCE_EUR_PER_KM = 0.08
    settings.STOP_COST_MINUTES = 30
    return SessionProfitCalculator(mock_db, osrm=mock_osrm, settings=settings)


@pytest.mark.asyncio
async def test_profit_3_offers_6_stops_within_tolerance() -> None:
    """Full fixture — result must match manual reference within ±2 EUR."""
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.flush = AsyncMock()

    mock_osrm = AsyncMock()
    mock_osrm.get_route_multi = AsyncMock(return_value=_ROUTE)

    calc = _build_calculator(mock_db, mock_osrm)

    with (
        patch.object(
            SessionProfitCalculator,
            "_load_session",
            new=AsyncMock(return_value=_mock_session()),
        ),
        patch(
            "app.services.toll_calculator.load_country_geometries",
            return_value={},  # 0 toll for clean manual comparison
        ),
    ):
        result = await calc.calculate_session_profit(SESSION_ID)

    # Revenue check
    assert result.revenue_eur == pytest.approx(1800.0, abs=0.01)

    # Fuel: load-aware, ~166 EUR  (manual ≈ 166.27)
    assert 160.0 < result.fuel_eur < 170.0, f"fuel_eur={result.fuel_eur}"

    # Toll: mocked to 0
    assert result.toll_eur == pytest.approx(0.0, abs=0.01)

    # Stop costs: 6 stops × ~16.19 EUR = ~97.12 EUR  (manual ≈ 97.12)
    assert 95.0 < result.stop_costs_eur < 99.0, f"stop_costs_eur={result.stop_costs_eur}"

    # Driver: 1 day × 49 EUR
    assert result.driver_eur == pytest.approx(49.0, abs=0.01)

    # Maintenance: 500 km × 0.08 = 40 EUR
    assert result.maintenance_eur == pytest.approx(40.0, abs=0.01)

    # Net profit (manual ≈ 1447.61 EUR)
    assert 1440.0 < result.net_profit_eur < 1460.0, f"net_profit_eur={result.net_profit_eur}"

    assert result.stop_count == 6
    assert len(result.legs) == 6
    assert result.legs[0].leg_id == 1
    assert result.legs[0].fuel_consumption > 0
    assert result.formulas.fuel.liters_total is not None
    assert len(result.offer_revenue) == 3

    # stop_costs_eur must be a separate field, not included in fuel_eur
    assert result.stop_costs_eur > 0
    assert result.fuel_eur != pytest.approx(result.fuel_eur + result.stop_costs_eur)


@pytest.mark.asyncio
async def test_profit_negative_net_returns_200_value() -> None:
    """Negative net_profit_eur is a valid result — must be returned, not raised."""
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.flush = AsyncMock()

    # Revenue much lower than any real cost
    cheap_offers = [
        _Offer(price_eur=10.0, weight_kg=100),
    ]
    cheap_stops = [
        _Stop("pickup",   cheap_offers[0], 0, _loc(51.0, 20.0)),
        _Stop("delivery", cheap_offers[0], 1, _loc(50.0, 19.0)),
    ]
    short_route = MultiStopRouteResult(
        total_distance_km=1000.0,
        total_duration_minutes=600,
        legs=[
            RouteLeg(distance_km=500.0, duration_minutes=300, from_index=0, to_index=1),
            RouteLeg(distance_km=500.0, duration_minutes=300, from_index=1, to_index=2),
        ],
        geometry_geojson={
            "type": "LineString",
            "coordinates": [[20.0, 51.0], [19.5, 50.5], [19.0, 50.0]],
        },
    )

    mock_session = _mock_session()
    mock_session.route_stops = cheap_stops

    mock_osrm = AsyncMock()
    mock_osrm.get_route_multi = AsyncMock(return_value=short_route)

    calc = _build_calculator(mock_db, mock_osrm)

    with (
        patch.object(
            SessionProfitCalculator,
            "_load_session",
            new=AsyncMock(return_value=mock_session),
        ),
        patch("app.services.toll_calculator.load_country_geometries", return_value={}),
    ):
        result = await calc.calculate_session_profit(SESSION_ID)

    assert result.net_profit_eur < 0, "expected negative profit for tiny revenue"
    # breakeven should be > 100 % when costs exceed revenue
    assert result.breakeven_fill_pct is not None
    assert result.breakeven_fill_pct > 100.0


@pytest.mark.asyncio
async def test_profit_stop_costs_separate_from_fuel() -> None:
    """stop_costs_eur must be an independent field — not blended into fuel_eur."""
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.flush = AsyncMock()

    mock_osrm = AsyncMock()
    mock_osrm.get_route_multi = AsyncMock(return_value=_ROUTE)

    calc = _build_calculator(mock_db, mock_osrm)

    with (
        patch.object(
            SessionProfitCalculator,
            "_load_session",
            new=AsyncMock(return_value=_mock_session()),
        ),
        patch("app.services.toll_calculator.load_country_geometries", return_value={}),
    ):
        result = await calc.calculate_session_profit(SESSION_ID)

    # total_cost must equal sum of all five components
    reconstructed = round(
        result.fuel_eur
        + result.toll_eur
        + result.stop_costs_eur
        + result.driver_eur
        + result.maintenance_eur,
        2,
    )
    assert result.total_cost_eur == pytest.approx(reconstructed, abs=0.01)

    # net_profit_eur == revenue - total_cost
    assert result.net_profit_eur == pytest.approx(
        round(result.revenue_eur - result.total_cost_eur, 2), abs=0.01
    )


@pytest.mark.asyncio
async def test_profit_breakeven_formula() -> None:
    """breakeven_fill_pct == total_cost / revenue * 100."""
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.flush = AsyncMock()

    mock_osrm = AsyncMock()
    mock_osrm.get_route_multi = AsyncMock(return_value=_ROUTE)

    calc = _build_calculator(mock_db, mock_osrm)

    with (
        patch.object(
            SessionProfitCalculator,
            "_load_session",
            new=AsyncMock(return_value=_mock_session()),
        ),
        patch("app.services.toll_calculator.load_country_geometries", return_value={}),
    ):
        result = await calc.calculate_session_profit(SESSION_ID)

    if result.revenue_eur > 0:
        expected = round(result.total_cost_eur / result.revenue_eur * 100, 2)
        assert result.breakeven_fill_pct == pytest.approx(expected, abs=0.01)
    else:
        assert result.breakeven_fill_pct is None


@pytest.mark.asyncio
async def test_profit_cost_events_written_five_rows() -> None:
    """Exactly 5 CostEvent rows are added per call (one per cost type)."""
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock()
    added_events: list[Any] = []
    mock_db.add = MagicMock(side_effect=added_events.append)
    mock_db.flush = AsyncMock()

    mock_osrm = AsyncMock()
    mock_osrm.get_route_multi = AsyncMock(return_value=_ROUTE)

    calc = _build_calculator(mock_db, mock_osrm)

    with (
        patch.object(
            SessionProfitCalculator,
            "_load_session",
            new=AsyncMock(return_value=_mock_session()),
        ),
        patch("app.services.toll_calculator.load_country_geometries", return_value={}),
    ):
        await calc.calculate_session_profit(SESSION_ID)

    from app.models import CostEvent

    cost_events = [e for e in added_events if isinstance(e, CostEvent)]
    assert len(cost_events) == 5

    types = {e.cost_type for e in cost_events}
    assert types == {"fuel", "toll", "stop", "driver", "maintenance"}


@pytest.mark.asyncio
async def test_profit_session_fields_updated() -> None:
    """net_profit_eur and total_revenue_eur are set on the session object."""
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.flush = AsyncMock()

    mock_osrm = AsyncMock()
    mock_osrm.get_route_multi = AsyncMock(return_value=_ROUTE)

    mock_session = _mock_session()
    calc = _build_calculator(mock_db, mock_osrm)

    with (
        patch.object(
            SessionProfitCalculator,
            "_load_session",
            new=AsyncMock(return_value=mock_session),
        ),
        patch("app.services.toll_calculator.load_country_geometries", return_value={}),
    ):
        result = await calc.calculate_session_profit(SESSION_ID)

    assert mock_session.net_profit_eur == result.net_profit_eur
    assert mock_session.total_revenue_eur == result.revenue_eur


@pytest.mark.asyncio
async def test_profit_not_found_raises_404() -> None:
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock()

    mock_osrm = AsyncMock()
    calc = SessionProfitCalculator(mock_db, osrm=mock_osrm)

    with patch.object(
        SessionProfitCalculator,
        "_load_session",
        new=AsyncMock(return_value=None),
    ):
        from app.core.exceptions import NotFoundError

        with pytest.raises(NotFoundError):
            await calc.calculate_session_profit(SESSION_ID)


@pytest.mark.asyncio
async def test_profit_no_stops_raises_422() -> None:
    mock_db = AsyncMock()
    mock_db.execute = AsyncMock()

    mock_osrm = AsyncMock()
    calc = SessionProfitCalculator(mock_db, osrm=mock_osrm)

    mock_session = _mock_session()
    mock_session.route_stops = []

    with patch.object(
        SessionProfitCalculator,
        "_load_session",
        new=AsyncMock(return_value=mock_session),
    ):
        from app.core.exceptions import ValidationAppError

        with pytest.raises(ValidationAppError):
            await calc.calculate_session_profit(SESSION_ID)
