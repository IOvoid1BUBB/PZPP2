"""Tiny async Redis wrapper.

Used for routing matrix / route response caching and lightweight queues.
The connection pool is shared across the process.
"""

from __future__ import annotations

from redis.asyncio import Redis, from_url

from app.core.config import get_settings

_redis: Redis | None = None


def get_redis() -> Redis:
    """FastAPI dependency: process-wide Redis connection."""
    global _redis
    if _redis is None:
        _redis = from_url(  # type: ignore[no-untyped-call]
            get_settings().REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis


async def shutdown_redis() -> None:
    """Release Redis connections (call from app shutdown lifespan)."""
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None
