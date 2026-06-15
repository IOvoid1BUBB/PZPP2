from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from typing import Any

import httpx
from redis.asyncio import Redis

from app.core.exceptions import RoutingUnavailableError
from app.lib.routing import DistanceMatrix, MultiStopRouteResult, RouteLeg, RoutingProvider

_logger = logging.getLogger("ors.client")

_MAX_RETRIES = 3
_CACHE_TTL_SECONDS = 7200
_CACHE_MAX_LOCATIONS = 15
# ORS default snap is 350 m; synthetic offer coords may be slightly off-road.
_SNAP_RADIUS_METERS = 10_000


class ORSRoutingClient:
    """Async OpenRouteService client with retry and Redis cache."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        profile: str,
        redis: Redis,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._profile = profile
        self._redis = redis
        self._logger = _logger
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=30.0,
            headers={"Authorization": api_key} if api_key else {},
        )

    async def get_route_multi(
        self, waypoints: list[tuple[float, float]]
    ) -> MultiStopRouteResult:
        """Compute a multi-stop route through *waypoints* (lat, lon pairs)."""
        if not self._api_key:
            raise RoutingUnavailableError("ORS_API_KEY not configured")

        use_cache = len(waypoints) <= _CACHE_MAX_LOCATIONS

        if use_cache:
            cache_key = f"ors:route:{self._hash(waypoints)}"
            cached = await self._redis.get(cache_key)
            if cached is not None:
                self._logger.info(
                    "route cache hit",
                    extra={"event": "route:cache:hit", "key": cache_key, "n": len(waypoints)},
                )
                return MultiStopRouteResult.model_validate_json(cached)

        coordinates = [[lon, lat] for lat, lon in waypoints]
        url = f"/v2/directions/{self._profile}/geojson"
        data = await self._post_with_snap_fallback(url, coordinates)
        result = self._parse_route(data)

        if use_cache:
            await self._redis.setex(cache_key, _CACHE_TTL_SECONDS, result.model_dump_json())

        return result

    async def get_distance_matrix(
        self, locations: list[tuple[float, float]]
    ) -> DistanceMatrix:
        """Compute an N×N distance / duration matrix (lat, lon pairs)."""
        if not self._api_key:
            raise RoutingUnavailableError("ORS_API_KEY not configured")

        use_cache = len(locations) <= _CACHE_MAX_LOCATIONS

        if use_cache:
            cache_key = f"ors:matrix:{self._hash(locations)}"
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

        ors_locations = [[lon, lat] for lat, lon in locations]
        url = f"/v2/matrix/{self._profile}"
        data = await self._post_matrix_with_snap_fallback(url, ors_locations)
        result = self._parse_matrix(data, n=len(locations))

        if use_cache:
            await self._redis.setex(cache_key, _CACHE_TTL_SECONDS, result.model_dump_json())

        return result

    async def close(self) -> None:
        await self._http.aclose()

    async def _post_with_snap_fallback(
        self, url: str, coordinates: list[list[float]]
    ) -> dict[str, Any]:
        last_exc: RoutingUnavailableError | None = None
        for radius in (_SNAP_RADIUS_METERS, -1):
            body = {
                "coordinates": coordinates,
                "geometry": True,
                "radiuses": [radius] * len(coordinates),
            }
            try:
                return await self._request_with_retry("POST", url, json=body)
            except RoutingUnavailableError as exc:
                last_exc = exc
                if radius == -1 or "2010" not in str(exc):
                    raise
                self._logger.warning(
                    "ORS snap failed at %dm; retrying with unlimited radius",
                    _SNAP_RADIUS_METERS,
                    extra={"event": "ors:snap:retry", "radius": radius},
                )
        raise last_exc or RoutingUnavailableError("ORS directions request failed")

    async def _post_matrix_with_snap_fallback(
        self, url: str, locations: list[list[float]]
    ) -> dict[str, Any]:
        # Hosted ORS matrix API does not accept per-request ``radiuses`` (unlike
        # directions). Snapping uses the service-wide maximum_search_radius (~2 km).
        body = {
            "locations": locations,
            "metrics": ["distance", "duration"],
        }
        return await self._request_with_retry("POST", url, json=body)

    async def _request_with_retry(
        self,
        method: str,
        url: str,
        *,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not self._api_key:
            raise RoutingUnavailableError("ORS_API_KEY not configured")

        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                resp = await self._http.request(method, url, json=json)
            except (httpx.ConnectError, httpx.TimeoutException) as exc:
                last_exc = exc
                self._logger.warning(
                    "ORS request failed (attempt %d/%d): %s",
                    attempt + 1,
                    _MAX_RETRIES,
                    exc,
                )
                await asyncio.sleep(2**attempt)
                continue

            if resp.status_code != 200:
                detail = resp.text[:200] if resp.text else ""
                raise RoutingUnavailableError(
                    f"ORS returned HTTP {resp.status_code} for {url}: {detail}"
                )

            data: dict[str, Any] = resp.json()
            if data.get("error"):
                raise RoutingUnavailableError(
                    f"ORS error: {data.get('error', {}).get('message', data)}"
                )
            return data

        raise RoutingUnavailableError(
            f"ORS unreachable after {_MAX_RETRIES} attempts: {self._base_url}"
        ) from last_exc

    @staticmethod
    def _parse_route(data: dict[str, Any]) -> MultiStopRouteResult:
        features = data.get("features") or []
        if not features:
            raise RoutingUnavailableError("ORS returned no route features")

        feature = features[0]
        geometry_geojson: dict[str, Any] = feature["geometry"]
        props = feature.get("properties") or {}
        summary = props.get("summary") or {}
        total_distance_km = float(summary.get("distance", 0)) / 1000
        total_duration_minutes = int(float(summary.get("duration", 0)) / 60)

        segments = props.get("segments") or []
        if not segments:
            way_points: list[int] = props.get("way_points") or []
            n_legs = max(0, len(way_points) - 1)
            if n_legs > 0 and total_distance_km > 0:
                per_leg_km = total_distance_km / n_legs
                per_leg_min = max(1, total_duration_minutes // n_legs)
                segments = [
                    {"distance": per_leg_km * 1000, "duration": per_leg_min * 60}
                    for _ in range(n_legs)
                ]

        legs = [
            RouteLeg(
                distance_km=float(seg.get("distance", 0)) / 1000,
                duration_minutes=int(float(seg.get("duration", 0)) / 60),
                from_index=i,
                to_index=i + 1,
            )
            for i, seg in enumerate(segments)
        ]

        return MultiStopRouteResult(
            total_distance_km=total_distance_km,
            total_duration_minutes=total_duration_minutes,
            legs=legs,
            geometry_geojson=geometry_geojson,
        )

    @staticmethod
    def _parse_matrix(data: dict[str, Any], *, n: int) -> DistanceMatrix:
        raw_distances: list[list[float | None]] = data.get("distances") or []
        raw_durations: list[list[float | None]] = data.get("durations") or []

        distances_km = [
            [round((raw_distances[i][j] or 0.0) / 1000, 3) for j in range(n)] for i in range(n)
        ]
        durations_minutes = [
            [int((raw_durations[i][j] or 0.0) / 60) for j in range(n)] for i in range(n)
        ]

        for i in range(n):
            distances_km[i][i] = 0.0
            durations_minutes[i][i] = 0

        return DistanceMatrix(distances_km=distances_km, durations_minutes=durations_minutes, n=n)

    @staticmethod
    def _hash(locations: list[tuple[float, float]]) -> str:
        """Deterministic hash preserving location order (matrix depends on indices)."""
        raw = json.dumps(locations)
        return hashlib.sha256(raw.encode()).hexdigest()[:16]
