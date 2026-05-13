from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from typing import Any, Optional

import httpx
from pydantic import BaseModel, Field
from redis.asyncio import Redis


from app.core.config import get_settings
from app.core.exceptions import OSRMUnavailableError

_logger = logging.getLogger("osrm.client")

_MAX_RETRIES = 3
_CACHE_TTL_SECONDS = 7200
_CACHE_MAX_LOCATIONS = 15


# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------


class RouteLeg(BaseModel):
    """A single leg between two consecutive waypoints."""

    distance_km: float
    duration_minutes: int
    from_index: int
    to_index: int


class MultiStopRouteResult(BaseModel):
    """Full route result across multiple waypoints."""

    total_distance_km: float
    total_duration_minutes: int
    legs: list[RouteLeg]
    geometry_geojson: dict[str, Any] = Field(
        ..., description="GeoJSON LineString as returned by OSRM"
    )

    def to_wkt(self) -> str:
        """Convert the GeoJSON geometry to WKT (valid for PostGIS ``ST_GeomFromText``).

        Returns
        -------
        str
            WKT ``LINESTRING (lon1 lat1, lon2 lat2, …)``
        """
        from shapely.geometry import LineString  # lazy import — avoids type-checker stub warnings

        coords = self.geometry_geojson["coordinates"]
        line = LineString(coords)
        return line.wkt


class DistanceMatrix(BaseModel):
    """N×N distance / duration matrix."""

    distances_km: list[list[float]] = Field(
        ..., description="n×n matrix; distances_km[i][i] == 0.0"
    )
    durations_minutes: list[list[int]] = Field(
        ..., description="n×n matrix; durations_minutes[i][i] == 0"
    )
    n: int = Field(..., description="matrix dimension")


# ---------------------------------------------------------------------------
# Client implementation
# ---------------------------------------------------------------------------


class OSRMClient:
    """Async OSRM client with retry and Redis cache.

    One instance per process is sufficient — obtain it via
    :func:`get_osrm_client`.
    """

    def __init__(self, base_url: str, redis: Redis) -> None:
        self._base_url = base_url.rstrip("/")
        self._http = httpx.AsyncClient(base_url=self._base_url, timeout=30.0)
        self._redis = redis
        self._logger = _logger

    # -- public API --------------------------------------------------------

    async def get_route_multi(
        self, waypoints: list[tuple[float, float]]
    ) -> MultiStopRouteResult:
        """Compute a multi-stop route through *waypoints*.

        Parameters
        ----------
        waypoints:
            ``(lat, lon)`` pairs.  **Swapped** to ``lon,lat`` for the OSRM
            URL automatically.
        """
        # OSRM expects lon,lat — the caller sends lat,lon
        coords = ";".join(f"{lon},{lat}" for lat, lon in waypoints)
        url = f"/route/v1/driving/{coords}?geometries=geojson&overview=full&steps=false"
        data = await self._request_with_retry(url)
        return self._parse_route(data)

    async def get_distance_matrix(
        self, locations: list[tuple[float, float]]
    ) -> DistanceMatrix:
        """Compute an N×N distance / duration matrix.

        Parameters
        ----------
        locations:
            ``(lat, lon)`` pairs.
        """
        use_cache = len(locations) <= _CACHE_MAX_LOCATIONS

        if use_cache:
            cache_key = f"matrix:{self._hash(locations)}"
            cached = await self._redis.get(cache_key)
            if cached is not None:
                self._logger.info(
                    "matrix cache hit",
                    extra={"event": "matrix:cache:hit", "key": cache_key, "n": len(locations)},
                )
                return DistanceMatrix.model_validate_json(cached)
            self._logger.info(
                "matrix cache miss",
                extra={"event": "matrix:cache:miss", "key": cache_key, "n": len(locations)},
            )

        coords = ";".join(f"{lon},{lat}" for lat, lon in locations)
        url = f"/table/v1/driving/{coords}?annotations=distance,duration"
        data = await self._request_with_retry(url)
        result = self._parse_matrix(data)

        if use_cache:
            await self._redis.setex(cache_key, _CACHE_TTL_SECONDS, result.model_dump_json())

        return result

    async def close(self) -> None:
        """Close the underlying HTTP connection pool."""
        await self._http.aclose()

    # -- internal helpers --------------------------------------------------

    async def _request_with_retry(self, url: str) -> dict[str, Any]:
        """GET *url* with up to ``_MAX_RETRIES`` attempts (exponential back-off).

        Retries on :class:`httpx.ConnectError` and :class:`httpx.TimeoutException`
        only.  Non-200 responses or OSRM error codes raise
        :class:`OSRMUnavailableError` immediately.
        """
        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                resp = await self._http.get(url)
            except (httpx.ConnectError, httpx.TimeoutException) as exc:
                last_exc = exc
                self._logger.warning(
                    "OSRM request failed (attempt %d/%d): %s",
                    attempt + 1,
                    _MAX_RETRIES,
                    exc,
                )
                await asyncio.sleep(2**attempt)
                continue

            if resp.status_code != 200:
                raise OSRMUnavailableError(
                    f"OSRM returned HTTP {resp.status_code} for {url}"
                )

            data: dict[str, Any] = resp.json()
            if data.get("code") != "Ok":
                raise OSRMUnavailableError(
                    f"OSRM error code '{data.get('code')}': {data.get('message', '')}"
                )
            return data

        raise OSRMUnavailableError(
            f"OSRM unreachable after {_MAX_RETRIES} attempts: {self._base_url}"
        )

    # -- parsing -----------------------------------------------------------

    @staticmethod
    def _parse_route(data: dict[str, Any]) -> MultiStopRouteResult:
        route = data["routes"][0]
        total_distance_km = route["distance"] / 1000
        total_duration_minutes = int(route["duration"] / 60)
        legs = [
            RouteLeg(
                distance_km=leg["distance"] / 1000,
                duration_minutes=int(leg["duration"] / 60),
                from_index=i,
                to_index=i + 1,
            )
            for i, leg in enumerate(route["legs"])
        ]
        geometry_geojson: dict[str, Any] = route["geometry"]
        return MultiStopRouteResult(
            total_distance_km=total_distance_km,
            total_duration_minutes=total_duration_minutes,
            legs=legs,
            geometry_geojson=geometry_geojson,
        )

    @staticmethod
    def _parse_matrix(data: dict[str, Any]) -> DistanceMatrix:
        n = len(data["sources"])
        raw_distances: list[list[float | None]] = data["distances"]
        raw_durations: list[list[float | None]] = data["durations"]

        distances_km = [
            [round((raw_distances[i][j] or 0.0) / 1000, 3) for j in range(n)] for i in range(n)
        ]
        durations_minutes = [
            [int((raw_durations[i][j] or 0.0) / 60) for j in range(n)] for i in range(n)
        ]

        # Force diagonal to exactly zero (OSRM may return null or tiny values)
        for i in range(n):
            distances_km[i][i] = 0.0
            durations_minutes[i][i] = 0

        return DistanceMatrix(distances_km=distances_km, durations_minutes=durations_minutes, n=n)

    @staticmethod
    def _hash(locations: list[tuple[float, float]]) -> str:
        """Deterministic, order-independent hash of a location set."""
        sorted_locs = sorted(locations)
        raw = json.dumps(sorted_locs, sort_keys=True)
        return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Module-level singleton management
# ---------------------------------------------------------------------------

_client: Optional[OSRMClient] = None


def get_osrm_client() -> OSRMClient:
    """FastAPI dependency: process-wide OSRM client.

    Raises
    ------
    RuntimeError
        If :func:`init_osrm_client` has not been called yet.
    """
    global _client
    if _client is None:
        # Backwards-compatible: auto-initialise using settings + Redis when
        # called without explicit init (mirrors the original lazy pattern).
        from app.lib.redis_client import get_redis  # noqa: F811

        settings = get_settings()
        _client = OSRMClient(base_url=settings.OSRM_HOST, redis=get_redis())
    return _client


def init_osrm_client(base_url: str, redis: Redis) -> OSRMClient:
    """Explicitly create and register the singleton :class:`OSRMClient`."""
    global _client
    _client = OSRMClient(base_url=base_url, redis=redis)
    return _client


async def shutdown_osrm_client() -> None:
    """Release the OSRM client (call from app shutdown lifespan)."""
    global _client
    if _client is not None:
        await _client.close()
        _client = None
