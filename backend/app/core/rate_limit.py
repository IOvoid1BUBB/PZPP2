"""Lightweight in-process rate limiting via FastAPI dependencies.

Uses a fixed-window counter keyed by request path + client IP. This avoids
decorator-based limiters (e.g. slowapi) that wrap the endpoint and break
FastAPI's forward-reference resolution under ``from __future__ import annotations``.
"""

from __future__ import annotations

import time
from collections import defaultdict
from collections.abc import Callable

from fastapi import HTTPException, Request, status


class _FixedWindowLimiter:
    """Tracks request timestamps per key within a rolling window."""

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str, *, limit: int, window_seconds: float) -> None:
        now = time.monotonic()
        cutoff = now - window_seconds
        bucket = [ts for ts in self._hits[key] if ts > cutoff]
        if len(bucket) >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Try again later.",
            )
        bucket.append(now)
        self._hits[key] = bucket

    def reset(self) -> None:
        self._hits.clear()


_limiter = _FixedWindowLimiter()


def reset_rate_limits() -> None:
    """Clear all rate-limit state (test helper)."""
    _limiter.reset()


def rate_limit(*, limit: int, window_seconds: float = 60.0) -> Callable[[Request], None]:
    """Build a FastAPI dependency enforcing ``limit`` requests per window."""

    def dependency(request: Request) -> None:
        client = request.client.host if request.client else "anonymous"
        key = f"{request.url.path}:{client}"
        _limiter.check(key, limit=limit, window_seconds=window_seconds)

    return dependency
