"""Minimal async OSRM HTTP client.

Wraps the OSRM HTTP API (``/table/v1`` and ``/route/v1``) into a single
class that can be supplied as a FastAPI dependency. Concrete routing /
matrix logic is implemented in :mod:`app.services.routing` (future work).
"""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings
from app.core.exceptions import ExternalServiceError


class OSRMClient:
    """Tiny async OSRM client. One instance per process is sufficient."""

    def __init__(self, base_url: str, *, timeout_seconds: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(base_url=self._base_url, timeout=timeout_seconds)

    async def close(self) -> None:
        """Close the underlying HTTP connection pool."""
        await self._client.aclose()

    async def table(
        self,
        coordinates: list[tuple[float, float]],
        *,
        profile: str = "driving",
        annotations: str = "duration,distance",
    ) -> dict[str, Any]:
        """Call OSRM Table service (durations / distances matrix)."""
        coord_str = ";".join(f"{lon},{lat}" for lon, lat in coordinates)
        url = f"/table/v1/{profile}/{coord_str}"
        try:
            response = await self._client.get(url, params={"annotations": annotations})
            response.raise_for_status()
        except httpx.HTTPError as exc:  # pragma: no cover — exercised by routing tests
            raise ExternalServiceError(f"OSRM table call failed: {exc}") from exc
        data: dict[str, Any] = response.json()
        return data

    async def route(
        self,
        coordinates: list[tuple[float, float]],
        *,
        profile: str = "driving",
        overview: str = "simplified",
    ) -> dict[str, Any]:
        """Call OSRM Route service (geometry + summary)."""
        coord_str = ";".join(f"{lon},{lat}" for lon, lat in coordinates)
        url = f"/route/v1/{profile}/{coord_str}"
        try:
            response = await self._client.get(url, params={"overview": overview})
            response.raise_for_status()
        except httpx.HTTPError as exc:  # pragma: no cover — exercised by routing tests
            raise ExternalServiceError(f"OSRM route call failed: {exc}") from exc
        data: dict[str, Any] = response.json()
        return data


_osrm_client: OSRMClient | None = None


def get_osrm_client() -> OSRMClient:
    """FastAPI dependency: process-wide OSRM client."""
    global _osrm_client
    if _osrm_client is None:
        _osrm_client = OSRMClient(get_settings().OSRM_HOST)
    return _osrm_client


async def shutdown_osrm_client() -> None:
    """Release the OSRM client (call from app shutdown lifespan)."""
    global _osrm_client
    if _osrm_client is not None:
        await _osrm_client.close()
        _osrm_client = None
