"""Unit tests for offer detour helpers."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.exceptions import RoutingUnavailableError
from app.services.offer_detour import calculate_added_detour, haversine_added_detour_km


@pytest.mark.asyncio
async def test_calculate_added_detour_short_waypoints() -> None:
    routing = AsyncMock()
    added = await calculate_added_detour(
        routing,
        baseline_km=0.0,
        waypoints=[],
        pickup=(52.0, 21.0),
        delivery=(52.0, 21.0),
    )
    assert added == 0.0
    routing.get_route_multi.assert_not_awaited()


@pytest.mark.asyncio
async def test_calculate_added_detour_unexpected_error_fallback() -> None:
    routing = AsyncMock()
    routing.get_route_multi = AsyncMock(side_effect=RuntimeError("boom"))
    added = await calculate_added_detour(
        routing,
        baseline_km=0.0,
        waypoints=[(52.0, 21.0)],
        pickup=(52.1, 21.1),
        delivery=(50.0, 19.0),
    )
    assert added >= 0.0


def test_haversine_same_pickup_delivery() -> None:
    assert haversine_added_detour_km([], (52.0, 21.0), (52.0, 21.0)) == 0.0


def test_haversine_with_waypoints() -> None:
    km = haversine_added_detour_km(
        [(52.0, 21.0)],
        (52.1, 21.1),
        (50.0, 19.0),
    )
    assert km > 0.0
