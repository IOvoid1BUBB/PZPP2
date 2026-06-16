"""Unit tests for mock routing provider."""

from __future__ import annotations

import pytest

from app.lib.mock_routing import MockRoutingProvider


@pytest.mark.asyncio
async def test_mock_routing_returns_geojson_linestring() -> None:
    provider = MockRoutingProvider()
    result = await provider.get_route_multi([(52.0, 21.0), (51.0, 20.0), (50.0, 19.0)])
    assert result.total_distance_km > 0
    assert result.geometry_geojson["type"] == "LineString"
    assert len(result.geometry_geojson["coordinates"]) == 3
    assert len(result.legs) == 2
