"""Regional P90 price-per-LDM cache backed by Redis."""

from __future__ import annotations

import hashlib
import logging
import math
from typing import TYPE_CHECKING

from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.offer import MarketOffer

if TYPE_CHECKING:
    pass

_logger = logging.getLogger("regional.p90")

P90_CACHE_TTL_SECONDS = 3600
DEFAULT_P90_PRICE_PER_LDM = 80.0


def region_hash_from_coords(lat: float, lon: float) -> str:
    """Hash pickup coordinates on a 1° grid (deterministic)."""
    grid_lat = round(lat)
    grid_lon = round(lon)
    raw = f"{grid_lat}:{grid_lon}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def p90_cache_key(region_hash: str) -> str:
    """Redis key for a regional P90 lookup."""
    return f"p90:{region_hash}"


def percentile_90(values: list[float]) -> float:
    """Compute the 90th percentile of *values* (deterministic)."""
    if not values:
        return DEFAULT_P90_PRICE_PER_LDM
    ordered = sorted(values)
    index = max(0, min(math.ceil(0.9 * len(ordered)) - 1, len(ordered) - 1))
    return ordered[index]


async def compute_regional_p90_from_db(
    db: AsyncSession,
    lat: float,
    lon: float,
) -> float:
    """Derive P90 €/LDM for offers whose pickup lies in the same 1° grid cell."""
    grid_lat = round(lat)
    grid_lon = round(lon)
    stmt = (
        select(MarketOffer.price_eur, MarketOffer.ldm)
        .where(
            func.round(func.ST_Y(MarketOffer.pickup_point)) == grid_lat,
            func.round(func.ST_X(MarketOffer.pickup_point)) == grid_lon,
            MarketOffer.ldm > 0,
        )
        .limit(5000)
    )
    result = await db.execute(stmt)
    ratios: list[float] = []
    for price, ldm in result.all():
        ldm_f = float(ldm)
        if ldm_f > 0:
            ratios.append(float(price) / ldm_f)
    return percentile_90(ratios)


async def get_regional_p90(
    pickup_lat: float,
    pickup_lon: float,
    *,
    redis: Redis | None,
    db: AsyncSession | None,
    memory_cache: dict[str, float] | None = None,
) -> float:
    """Return regional P90 €/LDM with Redis + in-request caching.

    On Redis failure the lookup falls back to the database (or default).
    """
    region_hash = region_hash_from_coords(pickup_lat, pickup_lon)
    if memory_cache is not None and region_hash in memory_cache:
        return memory_cache[region_hash]

    key = p90_cache_key(region_hash)
    if redis is not None:
        try:
            cached = await redis.get(key)
            if cached is not None:
                value = float(cached)
                if memory_cache is not None:
                    memory_cache[region_hash] = value
                return value
        except Exception as exc:
            _logger.warning(
                "Redis P90 cache read failed; falling back to DB",
                extra={"event": "p90:cache:read_error", "error": str(exc)},
            )

    if db is None:
        value = DEFAULT_P90_PRICE_PER_LDM
    else:
        try:
            value = await compute_regional_p90_from_db(db, pickup_lat, pickup_lon)
        except Exception as exc:
            _logger.warning(
                "Regional P90 DB lookup failed; using default",
                extra={"event": "p90:db:error", "error": str(exc)},
            )
            value = DEFAULT_P90_PRICE_PER_LDM

    if memory_cache is not None:
        memory_cache[region_hash] = value

    if redis is not None:
        try:
            await redis.setex(key, P90_CACHE_TTL_SECONDS, str(value))
        except Exception as exc:
            _logger.warning(
                "Redis P90 cache write failed",
                extra={"event": "p90:cache:write_error", "error": str(exc)},
            )

    return value
