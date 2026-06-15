from __future__ import annotations

from typing import Any, Optional, Protocol, runtime_checkable

from pydantic import BaseModel, Field
from redis.asyncio import Redis


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
        ..., description="GeoJSON LineString from routing provider"
    )

    def to_wkt(self) -> str:
        """Convert the GeoJSON geometry to WKT (valid for PostGIS ``ST_GeomFromText``)."""
        from shapely.geometry import LineString

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


@runtime_checkable
class RoutingProvider(Protocol):
    """Async routing client interface (directions + distance matrix)."""

    async def get_route_multi(
        self, waypoints: list[tuple[float, float]]
    ) -> MultiStopRouteResult: ...

    async def get_distance_matrix(
        self, locations: list[tuple[float, float]]
    ) -> DistanceMatrix: ...

    async def close(self) -> None: ...


_provider: Optional[RoutingProvider] = None


def get_routing_provider() -> RoutingProvider:
    """FastAPI dependency: process-wide routing client."""
    global _provider
    if _provider is None:
        from app.core.config import get_settings
        from app.lib.ors import ORSRoutingClient
        from app.lib.redis_client import get_redis

        settings = get_settings()
        _provider = ORSRoutingClient(
            api_key=settings.ORS_API_KEY,
            base_url=settings.ORS_BASE_URL,
            profile=settings.ORS_PROFILE,
            redis=get_redis(),
        )
    return _provider


def init_routing_provider(
    api_key: str,
    base_url: str,
    profile: str,
    redis: Redis,
) -> RoutingProvider:
    """Explicitly create and register the singleton routing client."""
    from app.lib.ors import ORSRoutingClient

    global _provider
    _provider = ORSRoutingClient(
        api_key=api_key,
        base_url=base_url,
        profile=profile,
        redis=redis,
    )
    return _provider


async def shutdown_routing_provider() -> None:
    """Release the routing client (call from app shutdown lifespan)."""
    global _provider
    if _provider is not None:
        await _provider.close()
        _provider = None
