from __future__ import annotations

import json
import os
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx
from shapely import wkt as shapely_wkt

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)
os.environ.setdefault("ORS_API_KEY", "test-key")

from app.core.exceptions import RoutingUnavailableError
from app.lib.ors import ORSRoutingClient
from app.lib.routing import DistanceMatrix, MultiStopRouteResult, RouteLeg

ORS_BASE = "https://api.openrouteservice.org"
PROFILE = "driving-hgv"

ROUTE_RESPONSE: dict[str, Any] = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [21.01, 52.22],
                    [18.67, 50.29],
                    [19.94, 50.06],
                ],
            },
            "properties": {
                "summary": {"distance": 190_000, "duration": 7200},
                "segments": [
                    {"distance": 95_000, "duration": 3600},
                    {"distance": 85_000, "duration": 3000},
                ],
            },
        }
    ],
}

MATRIX_RESPONSE: dict[str, Any] = {
    "distances": [
        [0, 10_000, 20_000, 30_000, 40_000],
        [10_500, 0, 15_000, 25_000, 35_000],
        [21_000, 14_500, 0, 12_000, 22_000],
        [31_000, 24_000, 11_500, 0, 18_000],
        [41_000, 35_000, 23_000, 17_500, 0],
    ],
    "durations": [
        [0, 600, 1200, 1800, 2400],
        [630, 0, 900, 1500, 2100],
        [1260, 870, 0, 720, 1320],
        [1860, 1440, 690, 0, 1080],
        [2460, 2100, 1380, 1050, 0],
    ],
}


@pytest.fixture()
def mock_redis() -> AsyncMock:
    r = AsyncMock(spec=["get", "setex", "aclose"])
    r.get = AsyncMock(return_value=None)
    r.setex = AsyncMock(return_value=True)
    return r


@pytest.fixture()
def client(mock_redis: AsyncMock) -> ORSRoutingClient:
    return ORSRoutingClient(
        api_key="test-key",
        base_url=ORS_BASE,
        profile=PROFILE,
        redis=mock_redis,
    )


@respx.mock
async def test_get_route_multi_returns_correct_legs(client: ORSRoutingClient) -> None:
    respx.post(f"{ORS_BASE}/v2/directions/{PROFILE}/geojson").mock(
        return_value=httpx.Response(200, json=ROUTE_RESPONSE)
    )

    result = await client.get_route_multi([(52.22, 21.01), (50.29, 18.67), (50.06, 19.94)])

    assert isinstance(result, MultiStopRouteResult)
    assert len(result.legs) == 2
    assert 85 <= result.legs[0].distance_km <= 105
    assert 75 <= result.legs[1].distance_km <= 95
    assert result.total_distance_km > 0
    assert result.geometry_geojson["type"] == "LineString"


@respx.mock
async def test_get_route_multi_retry_on_connect_error(client: ORSRoutingClient) -> None:
    route = respx.post(f"{ORS_BASE}/v2/directions/{PROFILE}/geojson")
    route.side_effect = [
        httpx.ConnectError("conn refused"),
        httpx.ConnectError("conn refused"),
        httpx.Response(200, json=ROUTE_RESPONSE),
    ]

    with patch("app.lib.ors.asyncio.sleep", new_callable=AsyncMock):
        result = await client.get_route_multi([(52.22, 21.01), (50.29, 18.67), (50.06, 19.94)])

    assert isinstance(result, MultiStopRouteResult)
    assert route.call_count == 3


@respx.mock
async def test_get_route_multi_raises_after_3_failures(client: ORSRoutingClient) -> None:
    route = respx.post(f"{ORS_BASE}/v2/directions/{PROFILE}/geojson")
    route.side_effect = [
        httpx.ConnectError("fail"),
        httpx.ConnectError("fail"),
        httpx.ConnectError("fail"),
    ]

    with patch("app.lib.ors.asyncio.sleep", new_callable=AsyncMock):
        with pytest.raises(RoutingUnavailableError, match="unreachable after 3 attempts"):
            await client.get_route_multi([(52.22, 21.01), (50.29, 18.67), (50.06, 19.94)])

    assert route.call_count == 3


@respx.mock
async def test_get_distance_matrix_5x5_diagonal_zero(
    client: ORSRoutingClient, mock_redis: AsyncMock
) -> None:
    matrix_route = respx.post(f"{ORS_BASE}/v2/matrix/{PROFILE}").mock(
        return_value=httpx.Response(200, json=MATRIX_RESPONSE)
    )

    result = await client.get_distance_matrix([(i, i) for i in range(5)])

    assert matrix_route.call_count == 1
    sent_body = json.loads(matrix_route.calls.last.request.content.decode())
    assert "radiuses" not in sent_body
    assert result.n == 5
    for i in range(5):
        assert result.distances_km[i][i] == 0.0
        assert result.durations_minutes[i][i] == 0


@respx.mock
async def test_distance_matrix_cache_hit(
    client: ORSRoutingClient, mock_redis: AsyncMock
) -> None:
    locations = [(i * 0.1, i * 0.1) for i in range(5)]
    table_route = respx.post(f"{ORS_BASE}/v2/matrix/{PROFILE}").mock(
        return_value=httpx.Response(200, json=MATRIX_RESPONSE)
    )

    mock_redis.get.return_value = None
    result1 = await client.get_distance_matrix(locations)
    assert table_route.call_count == 1

    mock_redis.get.return_value = result1.model_dump_json()
    result2 = await client.get_distance_matrix(locations)

    assert table_route.call_count == 1
    assert result2.distances_km == result1.distances_km


@respx.mock
async def test_distance_matrix_cache_miss_then_set(
    client: ORSRoutingClient, mock_redis: AsyncMock
) -> None:
    locations = [(i * 0.1, i * 0.1) for i in range(5)]
    respx.post(f"{ORS_BASE}/v2/matrix/{PROFILE}").mock(
        return_value=httpx.Response(200, json=MATRIX_RESPONSE)
    )

    mock_redis.get.return_value = None
    await client.get_distance_matrix(locations)

    mock_redis.setex.assert_called_once()
    call_args = mock_redis.setex.call_args
    assert call_args[0][0].startswith("ors:matrix:")
    assert call_args[0][1] == 7200
    json.loads(call_args[0][2])


@respx.mock
async def test_matrix_not_cached_for_large_input(
    client: ORSRoutingClient, mock_redis: AsyncMock
) -> None:
    n = 16
    locations = [(i * 0.1, i * 0.1) for i in range(n)]
    large_response: dict[str, Any] = {
        "distances": [[float(abs(i - j) * 1000) for j in range(n)] for i in range(n)],
        "durations": [[float(abs(i - j) * 60) for j in range(n)] for i in range(n)],
    }

    table_route = respx.post(f"{ORS_BASE}/v2/matrix/{PROFILE}").mock(
        return_value=httpx.Response(200, json=large_response)
    )

    await client.get_distance_matrix(locations)

    mock_redis.get.assert_not_called()
    mock_redis.setex.assert_not_called()
    assert table_route.call_count == 1


def test_to_wkt_valid_linestring() -> None:
    result = MultiStopRouteResult(
        total_distance_km=190.0,
        total_duration_minutes=120,
        legs=[
            RouteLeg(distance_km=95.0, duration_minutes=60, from_index=0, to_index=1),
            RouteLeg(distance_km=85.0, duration_minutes=50, from_index=1, to_index=2),
        ],
        geometry_geojson={
            "type": "LineString",
            "coordinates": [[21.01, 52.22], [18.67, 50.29], [19.94, 50.06]],
        },
    )

    wkt = result.to_wkt()
    assert wkt.startswith("LINESTRING")
    assert shapely_wkt.loads(wkt).is_valid


def test_hash_preserves_order() -> None:
    locs_a = [(1.0, 2.0), (3.0, 4.0), (5.0, 6.0)]
    locs_b = [(5.0, 6.0), (1.0, 2.0), (3.0, 4.0)]

    assert ORSRoutingClient._hash(locs_a) != ORSRoutingClient._hash(locs_b)


@respx.mock
async def test_non_200_raises_immediately(client: ORSRoutingClient) -> None:
    route = respx.post(f"{ORS_BASE}/v2/directions/{PROFILE}/geojson").mock(
        return_value=httpx.Response(500, json={"error": {"message": "server error"}})
    )

    with pytest.raises(RoutingUnavailableError, match="HTTP 500"):
        await client.get_route_multi([(52.22, 21.01), (50.29, 18.67), (50.06, 19.94)])

    assert route.call_count == 1


@respx.mock
async def test_missing_api_key_raises() -> None:
    client = ORSRoutingClient(
        api_key="",
        base_url=ORS_BASE,
        profile=PROFILE,
        redis=AsyncMock(),
    )

    with pytest.raises(RoutingUnavailableError, match="ORS_API_KEY not configured"):
        await client.get_route_multi([(52.22, 21.01), (50.29, 18.67)])
