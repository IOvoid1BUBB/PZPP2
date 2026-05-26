"""Unit tests for regional P90 cache."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.lib.regional_p90 import (
    DEFAULT_P90_PRICE_PER_LDM,
    compute_regional_p90_from_db,
    get_regional_p90,
    region_hash_from_coords,
)


@pytest.mark.asyncio
async def test_get_regional_p90_redis_hit() -> None:
    region = region_hash_from_coords(52.2, 21.0)
    redis = AsyncMock()
    redis.get = AsyncMock(return_value="75.5")
    redis.setex = AsyncMock()
    value = await get_regional_p90(52.2, 21.0, redis=redis, db=None)
    assert value == 75.5
    redis.get.assert_awaited_once()
    redis.setex.assert_not_awaited()
    assert region  # used for key stability


@pytest.mark.asyncio
async def test_get_regional_p90_redis_miss_db() -> None:
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.setex = AsyncMock()
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=MagicMock(
            all=lambda: [(Decimal("200"), Decimal("4")), (Decimal("100"), Decimal("2"))],
        ),
    )
    memory: dict[str, float] = {}
    value = await get_regional_p90(
        52.2,
        21.0,
        redis=redis,
        db=db,
        memory_cache=memory,
    )
    assert value > 0
    redis.setex.assert_awaited_once()
    assert len(memory) == 1


@pytest.mark.asyncio
async def test_get_regional_p90_redis_failure_uses_db() -> None:
    redis = AsyncMock()
    redis.get = AsyncMock(side_effect=OSError("redis"))
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(all=lambda: []))
    value = await get_regional_p90(52.0, 21.0, redis=redis, db=db)
    assert value == DEFAULT_P90_PRICE_PER_LDM


@pytest.mark.asyncio
async def test_compute_regional_p90_from_db_empty() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(all=lambda: []))
    value = await compute_regional_p90_from_db(db, 52.0, 21.0)
    assert value == DEFAULT_P90_PRICE_PER_LDM


@pytest.mark.asyncio
async def test_get_regional_p90_no_redis_no_db() -> None:
    value = await get_regional_p90(52.0, 21.0, redis=None, db=None)
    assert value == DEFAULT_P90_PRICE_PER_LDM


@pytest.mark.asyncio
async def test_get_regional_p90_db_exception_uses_default() -> None:
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=RuntimeError("db"))
    value = await get_regional_p90(52.0, 21.0, redis=redis, db=db)
    assert value == DEFAULT_P90_PRICE_PER_LDM
