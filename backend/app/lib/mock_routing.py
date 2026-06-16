"""Haversine-based routing mock for dev/CI without an ORS API key."""

from __future__ import annotations

from typing import Any

from app.lib.geo import haversine_km
from app.lib.routing import DistanceMatrix, MultiStopRouteResult, RouteLeg


class MockRoutingProvider:
    """Approximate routing using great-circle distances and straight-line geometry."""

    async def get_route_multi(
        self,
        waypoints: list[tuple[float, float]],
    ) -> MultiStopRouteResult:
        if len(waypoints) < 2:
            coords = (
                [[waypoints[0][1], waypoints[0][0]]]
                if waypoints
                else [[0.0, 0.0]]
            )
            return MultiStopRouteResult(
                total_distance_km=0.0,
                total_duration_minutes=0,
                legs=[],
                geometry_geojson={"type": "LineString", "coordinates": coords},
            )

        legs: list[RouteLeg] = []
        total_km = 0.0
        total_minutes = 0
        coordinates: list[list[float]] = []

        for index, (lat, lon) in enumerate(waypoints):
            coordinates.append([lon, lat])
            if index == 0:
                continue
            prev_lat, prev_lon = waypoints[index - 1]
            distance_km = haversine_km(prev_lon, prev_lat, lon, lat)
            duration_minutes = max(1, int(distance_km / 60.0 * 60))
            legs.append(
                RouteLeg(
                    distance_km=round(distance_km, 3),
                    duration_minutes=duration_minutes,
                    from_index=index - 1,
                    to_index=index,
                ),
            )
            total_km += distance_km
            total_minutes += duration_minutes

        return MultiStopRouteResult(
            total_distance_km=round(total_km, 3),
            total_duration_minutes=total_minutes,
            legs=legs,
            geometry_geojson={"type": "LineString", "coordinates": coordinates},
        )

    async def get_distance_matrix(
        self,
        locations: list[tuple[float, float]],
    ) -> DistanceMatrix:
        n = len(locations)
        distances_km: list[list[float]] = [[0.0] * n for _ in range(n)]
        durations_minutes: list[list[int]] = [[0] * n for _ in range(n)]
        for i in range(n):
            lat_i, lon_i = locations[i]
            for j in range(n):
                if i == j:
                    continue
                lat_j, lon_j = locations[j]
                km = haversine_km(lon_i, lat_i, lon_j, lat_j)
                distances_km[i][j] = round(km, 3)
                durations_minutes[i][j] = max(1, int(km / 60.0 * 60))
        return DistanceMatrix(distances_km=distances_km, durations_minutes=durations_minutes, n=n)

    async def close(self) -> None:
        return None
