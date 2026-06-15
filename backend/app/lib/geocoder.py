"""Reverse geocoding via Nominatim with Redis cache."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx
from redis.asyncio import Redis

from app.core.config import get_settings

_logger = logging.getLogger("geocoder")

NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
_CACHE_TTL_SECONDS = 86400
_RATE_LIMIT_INTERVAL_SECONDS = 1.0

_rate_lock = asyncio.Lock()
_last_request_monotonic: float = 0.0


def geocode_cache_key(lat: float, lon: float) -> str:
    """Redis key for a rounded coordinate pair."""
    return f"geocode:{round(lat, 4)}:{round(lon, 4)}"


def coordinate_fallback(lat: float, lon: float) -> str:
    """Human-readable fallback when geocoding is unavailable."""
    return f"{lat:.4f}, {lon:.4f}"


def parse_nominatim_address(address: dict[str, Any]) -> str | None:
    """Build a city + street label from a Nominatim ``address`` object."""
    city = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("municipality")
        or address.get("county")
    )
    road = (
        address.get("road")
        or address.get("pedestrian")
        or address.get("footway")
        or address.get("residential")
    )
    if city and road:
        return f"{city}, {road}"
    if city:
        return str(city)
    if road:
        return str(road)
    return None


async def _await_rate_limit() -> None:
    """Enforce at most one Nominatim request per second (process-wide)."""
    global _last_request_monotonic
    async with _rate_lock:
        now = time.monotonic()
        elapsed = now - _last_request_monotonic
        if elapsed < _RATE_LIMIT_INTERVAL_SECONDS:
            await asyncio.sleep(_RATE_LIMIT_INTERVAL_SECONDS - elapsed)
        _last_request_monotonic = time.monotonic()


def reset_rate_limit_state() -> None:
    """Reset rate-limit timing (for tests)."""
    global _last_request_monotonic
    _last_request_monotonic = 0.0


async def _fetch_nominatim(lat: float, lon: float) -> str | None:
    settings = get_settings()
    await _await_rate_limit()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                NOMINATIM_REVERSE_URL,
                params={
                    "format": "json",
                    "lat": lat,
                    "lon": lon,
                    "zoom": 18,
                    "addressdetails": 1,
                },
                headers={"User-Agent": settings.NOMINATIM_USER_AGENT},
            )
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        _logger.warning(
            "Nominatim request failed",
            extra={"event": "geocode:http_error", "error": str(exc)},
        )
        return None

    if response.status_code != 200:
        _logger.warning(
            "Nominatim returned non-200 status",
            extra={"event": "geocode:http_status", "status": response.status_code},
        )
        return None

    try:
        data: dict[str, Any] = response.json()
    except ValueError as exc:
        _logger.warning(
            "Nominatim response was not valid JSON",
            extra={"event": "geocode:json_error", "error": str(exc)},
        )
        return None

    address = data.get("address")
    if not isinstance(address, dict):
        return None
    return parse_nominatim_address(address)


async def reverse_geocode(lat: float, lon: float, *, redis: Redis) -> str:
    """Resolve coordinates to a short address label with Redis caching.

    On cache miss calls Nominatim (max 1 req/s). Redis failures are non-fatal.
    Returns coordinate fallback when the provider is unavailable.
    """
    cache_key = geocode_cache_key(lat, lon)

    try:
        cached = await redis.get(cache_key)
        if cached is not None:
            return str(cached)
    except Exception as exc:
        _logger.warning(
            "Redis geocode cache read failed; continuing without cache",
            extra={"event": "geocode:cache:read_error", "error": str(exc)},
        )

    label = await _fetch_nominatim(lat, lon)
    if label is None:
        return coordinate_fallback(lat, lon)

    try:
        await redis.setex(cache_key, _CACHE_TTL_SECONDS, label)
    except Exception as exc:
        _logger.warning(
            "Redis geocode cache write failed",
            extra={"event": "geocode:cache:write_error", "error": str(exc)},
        )

    return label
