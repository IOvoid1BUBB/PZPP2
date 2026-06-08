"""Unit tests for reverse geocoding client."""

from __future__ import annotations

import os
import time
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
import respx

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)

from app.lib.geocoder import (
    _CACHE_TTL_SECONDS,
    NOMINATIM_REVERSE_URL,
    coordinate_fallback,
    geocode_cache_key,
    parse_nominatim_address,
    reset_rate_limit_state,
    reverse_geocode,
)

NOMINATIM_RESPONSE: dict[str, Any] = {
    "address": {
        "city": "Warszawa",
        "road": "Marszałkowska",
        "country": "Polska",
    },
    "display_name": "Marszałkowska, Warszawa, Polska",
}


@pytest.fixture(autouse=True)
def _reset_rate_limit() -> None:
    reset_rate_limit_state()


@pytest.fixture()
def mock_redis() -> AsyncMock:
    redis = AsyncMock(spec=["get", "setex"])
    redis.get = AsyncMock(return_value=None)
    redis.setex = AsyncMock()
    return redis


def test_geocode_cache_key_rounds_coordinates() -> None:
    assert geocode_cache_key(52.22971234, 21.01221234) == "geocode:52.2297:21.0122"


def test_coordinate_fallback_format() -> None:
    assert coordinate_fallback(52.2297, 21.0122) == "52.2297, 21.0122"


def test_parse_nominatim_address_city_and_road() -> None:
    label = parse_nominatim_address({"city": "Warszawa", "road": "Marszałkowska"})
    assert label == "Warszawa, Marszałkowska"


def test_parse_nominatim_address_town_only() -> None:
    label = parse_nominatim_address({"town": "Kraków"})
    assert label == "Kraków"


def test_parse_nominatim_address_empty() -> None:
    assert parse_nominatim_address({}) is None


@pytest.mark.asyncio
@respx.mock
async def test_cache_hit_skips_http(mock_redis: AsyncMock) -> None:
    mock_redis.get = AsyncMock(return_value="Warszawa, Marszałkowska")
    route = respx.get(NOMINATIM_REVERSE_URL).mock(return_value=httpx.Response(200, json={}))

    label = await reverse_geocode(52.2297, 21.0122, redis=mock_redis)

    assert label == "Warszawa, Marszałkowska"
    mock_redis.get.assert_awaited_once_with("geocode:52.2297:21.0122")
    mock_redis.setex.assert_not_awaited()
    assert route.call_count == 0


@pytest.mark.asyncio
@respx.mock
async def test_cache_miss_fetches_and_stores(mock_redis: AsyncMock) -> None:
    respx.get(NOMINATIM_REVERSE_URL).mock(
        return_value=httpx.Response(200, json=NOMINATIM_RESPONSE),
    )

    label = await reverse_geocode(52.2297, 21.0122, redis=mock_redis)

    assert label == "Warszawa, Marszałkowska"
    mock_redis.setex.assert_awaited_once_with(
        "geocode:52.2297:21.0122",
        _CACHE_TTL_SECONDS,
        "Warszawa, Marszałkowska",
    )


@pytest.mark.asyncio
@respx.mock
async def test_http_timeout_returns_coordinate_fallback(mock_redis: AsyncMock) -> None:
    respx.get(NOMINATIM_REVERSE_URL).mock(side_effect=httpx.TimeoutException("timeout"))

    label = await reverse_geocode(52.2297, 21.0122, redis=mock_redis)

    assert label == "52.2297, 21.0122"
    mock_redis.setex.assert_not_awaited()


@pytest.mark.asyncio
@respx.mock
async def test_http_5xx_returns_coordinate_fallback(mock_redis: AsyncMock) -> None:
    respx.get(NOMINATIM_REVERSE_URL).mock(return_value=httpx.Response(503, json={}))

    label = await reverse_geocode(52.2297, 21.0122, redis=mock_redis)

    assert label == "52.2297, 21.0122"


@pytest.mark.asyncio
@respx.mock
async def test_empty_address_returns_coordinate_fallback(mock_redis: AsyncMock) -> None:
    respx.get(NOMINATIM_REVERSE_URL).mock(return_value=httpx.Response(200, json={}))

    label = await reverse_geocode(52.2297, 21.0122, redis=mock_redis)

    assert label == "52.2297, 21.0122"


@pytest.mark.asyncio
@respx.mock
async def test_redis_read_failure_still_geocodes(mock_redis: AsyncMock) -> None:
    mock_redis.get = AsyncMock(side_effect=OSError("redis down"))
    respx.get(NOMINATIM_REVERSE_URL).mock(
        return_value=httpx.Response(200, json=NOMINATIM_RESPONSE),
    )

    label = await reverse_geocode(52.2297, 21.0122, redis=mock_redis)

    assert label == "Warszawa, Marszałkowska"
    mock_redis.setex.assert_awaited_once()


@pytest.mark.asyncio
@respx.mock
async def test_redis_write_failure_still_returns_label(mock_redis: AsyncMock) -> None:
    mock_redis.setex = AsyncMock(side_effect=OSError("redis down"))
    respx.get(NOMINATIM_REVERSE_URL).mock(
        return_value=httpx.Response(200, json=NOMINATIM_RESPONSE),
    )

    label = await reverse_geocode(52.2297, 21.0122, redis=mock_redis)

    assert label == "Warszawa, Marszałkowska"


@pytest.mark.asyncio
@respx.mock
async def test_rate_limiting_enforces_one_request_per_second(mock_redis: AsyncMock) -> None:
    respx.get(NOMINATIM_REVERSE_URL).mock(
        return_value=httpx.Response(200, json=NOMINATIM_RESPONSE),
    )

    start = time.monotonic()
    await reverse_geocode(52.0, 21.0, redis=mock_redis)
    await reverse_geocode(53.0, 22.0, redis=mock_redis)
    elapsed = time.monotonic() - start

    assert elapsed >= 0.95
    assert respx.calls.call_count == 2
