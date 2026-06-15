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

from app.core.exceptions import OSRMUnavailableError
from app.lib.osrm import (
    DistanceMatrix,
    MultiStopRouteResult,
    OSRMClient,
    RouteLeg,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

OSRM_BASE = "http://osrm:5000"

# WAW -> KTW -> KRK
ROUTE_RESPONSE: dict[str, Any] = {
    "code": "Ok",
    "routes": [
        {
            "distance": 190_000,
            "duration": 7200,
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [21.01, 52.22],
                    [18.67, 50.29],
                    [19.94, 50.06],
                ],
            },
            "legs": [
                {"distance": 95_000, "duration": 3600, "steps": []},
                {"distance": 85_000, "duration": 3000, "steps": []},
            ],
        }
    ],
    "waypoints": [],
}

TABLE_5X5_RESPONSE: dict[str, Any] = {
    "code": "Ok",
    "sources": [{"location": [i, i]} for i in range(5)],
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
    """A fully-mocked async Redis instance."""
    r = AsyncMock(spec=["get", "setex", "aclose"])
    r.get = AsyncMock(return_value=None)
    r.setex = AsyncMock(return_value=True)
    return r


@pytest.fixture()
def client(mock_redis: AsyncMock) -> OSRMClient:
    """An :class:`OSRMClient` wired to mock Redis."""
    return OSRMClient(base_url=OSRM_BASE, redis=mock_redis)


# ---------------------------------------------------------------------------
# Route tests
# ---------------------------------------------------------------------------


@respx.mock
async def test_get_route_multi_returns_correct_legs(client: OSRMClient) -> None:
    """Mock OSRM /route for WAW→KTW→KRK (3 waypoints)."""
    respx.get(f"{OSRM_BASE}/route/v1/truck/21.01,52.22;18.67,50.29;19.94,50.06").mock(
        return_value=httpx.Response(200, json=ROUTE_RESPONSE)
    )

    result = await client.get_route_multi([(52.22, 21.01), (50.29, 18.67), (50.06, 19.94)])

    assert isinstance(result, MultiStopRouteResult)
    assert len(result.legs) == 2
    assert 85 <= result.legs[0].distance_km <= 105  # ~95 km
    assert 75 <= result.legs[1].distance_km <= 95  # ~85 km
    assert result.total_distance_km > 0
    assert isinstance(result.geometry_geojson, dict)
    assert result.geometry_geojson["type"] == "LineString"


@respx.mock
async def test_get_route_multi_retry_on_connect_error(client: OSRMClient) -> None:
    """httpx.ConnectError on first 2 attempts, success on 3rd."""
    route = respx.get(
        f"{OSRM_BASE}/route/v1/truck/21.01,52.22;18.67,50.29;19.94,50.06"
    )
    route.side_effect = [
        httpx.ConnectError("conn refused"),
        httpx.ConnectError("conn refused"),
        httpx.Response(200, json=ROUTE_RESPONSE),
    ]

    with patch("app.lib.osrm.asyncio.sleep", new_callable=AsyncMock):
        result = await client.get_route_multi([(52.22, 21.01), (50.29, 18.67), (50.06, 19.94)])

    assert isinstance(result, MultiStopRouteResult)
    assert route.call_count == 3


@respx.mock
async def test_get_route_multi_raises_after_3_failures(client: OSRMClient) -> None:
    """All 3 attempts fail → OSRMUnavailableError."""
    route = respx.get(
        f"{OSRM_BASE}/route/v1/truck/21.01,52.22;18.67,50.29;19.94,50.06"
    )
    route.side_effect = [
        httpx.ConnectError("fail"),
        httpx.ConnectError("fail"),
        httpx.ConnectError("fail"),
    ]

    with patch("app.lib.osrm.asyncio.sleep", new_callable=AsyncMock):
        with pytest.raises(OSRMUnavailableError, match="unreachable after 3 attempts"):
            await client.get_route_multi([(52.22, 21.01), (50.29, 18.67), (50.06, 19.94)])

    assert route.call_count == 3


# ---------------------------------------------------------------------------
# Matrix tests
# ---------------------------------------------------------------------------


@respx.mock
async def test_get_distance_matrix_5x5_diagonal_zero(
    client: OSRMClient, mock_redis: AsyncMock
) -> None:
    """5x5 matrix with correct dimensions and zero diagonal."""
    coords = ";".join(f"{lon},{lat}" for lat, lon in [(i, i) for i in range(5)])
    respx.get(f"{OSRM_BASE}/table/v1/truck/{coords}").mock(
        return_value=httpx.Response(200, json=TABLE_5X5_RESPONSE)
    )

    result = await client.get_distance_matrix([(i, i) for i in range(5)])

    assert result.n == 5
    assert len(result.distances_km) == 5
    assert len(result.distances_km[0]) == 5
    for i in range(5):
        assert result.distances_km[i][i] == 0.0
        assert result.durations_minutes[i][i] == 0


@respx.mock
async def test_distance_matrix_cache_hit(
    client: OSRMClient, mock_redis: AsyncMock
) -> None:
    """Second identical call is served from cache (httpx called only once)."""
    locations = [(i * 0.1, i * 0.1) for i in range(5)]
    coords = ";".join(f"{lon},{lat}" for lat, lon in locations)

    table_route = respx.get(f"{OSRM_BASE}/table/v1/truck/{coords}").mock(
        return_value=httpx.Response(200, json=TABLE_5X5_RESPONSE)
    )

    # First call: cache miss → fetch from OSRM
    mock_redis.get.return_value = None
    result1 = await client.get_distance_matrix(locations)
    assert table_route.call_count == 1

    # Second call: cache hit → return from Redis
    mock_redis.get.return_value = result1.model_dump_json()
    result2 = await client.get_distance_matrix(locations)

    # httpx should NOT have been called again
    assert table_route.call_count == 1
    assert result2.n == result1.n
    assert result2.distances_km == result1.distances_km


@respx.mock
async def test_distance_matrix_cache_miss_then_set(
    client: OSRMClient, mock_redis: AsyncMock
) -> None:
    """Cache miss triggers httpx.get and Redis.setex with TTL=7200."""
    locations = [(i * 0.1, i * 0.1) for i in range(5)]
    coords = ";".join(f"{lon},{lat}" for lat, lon in locations)

    respx.get(f"{OSRM_BASE}/table/v1/truck/{coords}").mock(
        return_value=httpx.Response(200, json=TABLE_5X5_RESPONSE)
    )

    mock_redis.get.return_value = None
    await client.get_distance_matrix(locations)

    mock_redis.setex.assert_called_once()
    call_args = mock_redis.setex.call_args
    assert call_args[0][0].startswith("matrix:")
    assert call_args[0][1] == 7200
    # Verify the serialized value is valid JSON
    json.loads(call_args[0][2])


@respx.mock
async def test_matrix_not_cached_for_large_input(
    client: OSRMClient, mock_redis: AsyncMock
) -> None:
    """Matrices with >15 locations bypass Redis entirely."""
    n = 16
    locations = [(i * 0.1, i * 0.1) for i in range(n)]
    coords = ";".join(f"{lon},{lat}" for lat, lon in locations)

    large_response: dict[str, Any] = {
        "code": "Ok",
        "sources": [{"location": [i, i]} for i in range(n)],
        "distances": [[float(abs(i - j) * 1000) for j in range(n)] for i in range(n)],
        "durations": [[float(abs(i - j) * 60) for j in range(n)] for i in range(n)],
    }

    table_route = respx.get(f"{OSRM_BASE}/table/v1/truck/{coords}").mock(
        return_value=httpx.Response(200, json=large_response)
    )

    await client.get_distance_matrix(locations)

    mock_redis.get.assert_not_called()
    mock_redis.setex.assert_not_called()
    assert table_route.call_count == 1


# ---------------------------------------------------------------------------
# Geometry / WKT tests
# ---------------------------------------------------------------------------


def test_to_wkt_valid_linestring() -> None:
    """to_wkt() produces valid WKT parseable by shapely."""
    result = MultiStopRouteResult(
        total_distance_km=190.0,
        total_duration_minutes=120,
        legs=[
            RouteLeg(distance_km=95.0, duration_minutes=60, from_index=0, to_index=1),
            RouteLeg(distance_km=85.0, duration_minutes=50, from_index=1, to_index=2),
        ],
        geometry_geojson={
            "type": "LineString",
            "coordinates": [
                [21.01, 52.22],
                [18.67, 50.29],
                [19.94, 50.06],
            ],
        },
    )

    wkt = result.to_wkt()

    assert wkt.startswith("LINESTRING")
    geom = shapely_wkt.loads(wkt)
    assert geom.is_valid


# ---------------------------------------------------------------------------
# Hash tests
# ---------------------------------------------------------------------------


def test_hash_deterministic_and_order_independent() -> None:
    """_hash returns the same value regardless of input order."""
    locs_a = [(1.0, 2.0), (3.0, 4.0), (5.0, 6.0)]
    locs_b = [(5.0, 6.0), (1.0, 2.0), (3.0, 4.0)]

    assert OSRMClient._hash(locs_a) == OSRMClient._hash(locs_b)


# ---------------------------------------------------------------------------
# Edge-case: non-200 / bad code response
# ---------------------------------------------------------------------------


@respx.mock
async def test_non_200_raises_immediately(client: OSRMClient) -> None:
    """Non-200 HTTP status raises OSRMUnavailableError without retry."""
    route = respx.get(
        f"{OSRM_BASE}/route/v1/truck/21.01,52.22;18.67,50.29;19.94,50.06"
    ).mock(return_value=httpx.Response(500, json={"code": "Error"}))

    with pytest.raises(OSRMUnavailableError, match="HTTP 500"):
        await client.get_route_multi([(52.22, 21.01), (50.29, 18.67), (50.06, 19.94)])

    assert route.call_count == 1


@respx.mock
async def test_osrm_error_code_raises_immediately(client: OSRMClient) -> None:
    """OSRM returns 200 but code != 'Ok' → immediate error."""
    route = respx.get(
        f"{OSRM_BASE}/route/v1/truck/21.01,52.22;18.67,50.29;19.94,50.06"
    ).mock(
        return_value=httpx.Response(
            200,
            json={"code": "InvalidQuery", "message": "bad coords"},
        )
    )

    with pytest.raises(OSRMUnavailableError, match="InvalidQuery"):
        await client.get_route_multi([(52.22, 21.01), (50.29, 18.67), (50.06, 19.94)])

    assert route.call_count == 1
