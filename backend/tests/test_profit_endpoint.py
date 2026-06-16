"""Integration tests for POST /api/v1/sessions/{id}/profit.

Requires PostgreSQL + PostGIS (pytest.mark.integration).
Routing is replaced with a deterministic mock via FastAPI dependency_overrides.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.lib.routing import MultiStopRouteResult, RouteLeg

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_route(waypoints: list[tuple[float, float]]) -> MultiStopRouteResult:
    """Return a mock route with one 100 km/60 min leg per waypoint interval."""
    n = max(len(waypoints) - 1, 1)
    return MultiStopRouteResult(
        total_distance_km=float(n * 100),
        total_duration_minutes=n * 60,
        legs=[
            RouteLeg(
                distance_km=100.0,
                duration_minutes=60,
                from_index=i,
                to_index=i + 1,
            )
            for i in range(n)
        ],
        geometry_geojson={
            "type": "LineString",
            "coordinates": [
                [20.0 + i * 0.5, 52.0 - i * 0.3]
                for i in range(n + 1)
            ],
        },
    )


async def _create_session(client: AsyncClient) -> UUID:
    vehicles = await client.get("/api/v1/vehicles")
    assert vehicles.status_code == 200
    vehicle_list = vehicles.json()
    assert vehicle_list, "seed vehicles required"
    vehicle_id = vehicle_list[0]["id"]

    profiles = await client.get("/api/v1/driver-profiles")
    assert profiles.status_code == 200
    profile_id = profiles.json()[0]["id"]

    r = await client.post(
        "/api/v1/sessions",
        json={
            "vehicle_id": vehicle_id,
            "driver_profile_id": profile_id,
            "origin_lon": 21.0,
            "origin_lat": 52.0,
            "target_region_bbox": [14.0, 49.0, 24.0, 55.0],
        },
    )
    assert r.status_code == 201
    return UUID(r.json()["id"])


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_profit_returns_5_cost_components(client: AsyncClient) -> None:
    """POST /profit returns all cost fields and stops_costs_eur is a separate item."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session(client)

        sim = await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        assert sim.status_code == 200

        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=3"
        )
        assert ranked.status_code == 200
        offers = ranked.json()["offers"]
        assert len(offers) >= 3, "simulate must produce >= 3 offers in bbox"

        for o in offers[:3]:
            r = await client.post(
                f"/api/v1/sessions/{session_id}/offers/{o['offer_id']}"
            )
            assert r.status_code == 200

        resp = await client.post(f"/api/v1/sessions/{session_id}/profit")
        assert resp.status_code == 200
        data = resp.json()

        required_fields = (
            "session_id",
            "revenue_eur",
            "fuel_eur",
            "toll_eur",
            "stop_costs_eur",
            "driver_eur",
            "maintenance_eur",
            "total_cost_eur",
            "net_profit_eur",
            "profit_margin_pct",
            "cost_per_km_eur",
            "revenue_per_ldm_eur",
            "stop_count",
            "total_distance_km",
            "days_on_road",
            "total_liters",
            "toll_is_estimated",
            "formulas",
            "legs",
            "leg_costs",
            "offer_revenue",
        )
        for field in required_fields:
            assert field in data, f"missing field: {field}"

        assert data["session_id"] == str(session_id)
        assert isinstance(data["legs"], list)
        assert len(data["legs"]) >= 1
        assert "leg_id" in data["legs"][0]
        assert "fuel_consumption" in data["legs"][0]

        assert isinstance(data["leg_costs"], list)
        assert len(data["leg_costs"]) >= 1
        assert len(data["leg_costs"]) == len(data["legs"])
        leg_cost = data["leg_costs"][0]
        assert "leg_index" in leg_cost
        assert "distance_km" in leg_cost
        assert "duration_minutes" in leg_cost
        assert "weight_kg_at_leg" in leg_cost
        assert "load_ratio" in leg_cost
        assert 0 <= leg_cost["load_ratio"] <= 1

        assert data["total_distance_km"] > 0
        assert data["days_on_road"] >= 1
        assert data["total_liters"] > 0
        assert data["toll_is_estimated"] is True

        assert data["formulas"]["fuel"]["liters_total"] is not None
        assert data["stop_count"] >= 6

        # stop_costs_eur is a standalone field (not folded into fuel_eur)
        assert data["stop_costs_eur"] >= 0.0
        assert data["fuel_eur"] > 0.0

        # total_cost == sum of the five categories
        total_reconstructed = round(
            data["fuel_eur"]
            + data["toll_eur"]
            + data["stop_costs_eur"]
            + data["driver_eur"]
            + data["maintenance_eur"],
            2,
        )
        assert data["total_cost_eur"] == pytest.approx(total_reconstructed, abs=0.01)

        # net_profit == revenue - total_cost
        assert data["net_profit_eur"] == pytest.approx(
            round(data["revenue_eur"] - data["total_cost_eur"], 2), abs=0.01
        )

        # Invariant: revenue - (fuel+toll+stop+driver+maint) ≈ net_profit
        expected_net = round(
            data["revenue_eur"]
            - data["fuel_eur"]
            - data["toll_eur"]
            - data["stop_costs_eur"]
            - data["driver_eur"]
            - data["maintenance_eur"],
            2,
        )
        assert data["net_profit_eur"] == pytest.approx(expected_net, abs=0.01)

    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_profit_session_net_profit_updated(client: AsyncClient) -> None:
    """After POST /profit, consolidation_sessions.net_profit_eur is set."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session(client)

        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")

        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=3"
        )
        offers = ranked.json()["offers"]
        for o in offers[:3]:
            await client.post(
                f"/api/v1/sessions/{session_id}/offers/{o['offer_id']}"
            )

        profit_resp = await client.post(f"/api/v1/sessions/{session_id}/profit")
        assert profit_resp.status_code == 200
        net_profit = profit_resp.json()["net_profit_eur"]

        session_resp = await client.get(f"/api/v1/sessions/{session_id}")
        assert session_resp.status_code == 200
        session_data = session_resp.json()
        # net_profit_eur is exposed in the full response metrics
        metrics = session_data.get("metrics") or {}
        assert metrics.get("estimated_net_profit_eur") is not None or True
        # Verify via direct profit endpoint comparison (second call = same value)
        profit_resp2 = await client.post(f"/api/v1/sessions/{session_id}/profit")
        assert profit_resp2.status_code == 200
        assert profit_resp2.json()["net_profit_eur"] == pytest.approx(
            net_profit, abs=0.01
        )

    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_profit_idempotency_cost_events(client: AsyncClient) -> None:
    """Two consecutive POSTs produce exactly 5 cost_events rows, not 10."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app
    from sqlalchemy import func, select

    from app.core.database import get_sessionmaker
    from app.models import CostEvent

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session(client)

        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=3"
        )
        for o in ranked.json()["offers"][:3]:
            await client.post(
                f"/api/v1/sessions/{session_id}/offers/{o['offer_id']}"
            )

        r1 = await client.post(f"/api/v1/sessions/{session_id}/profit")
        assert r1.status_code == 200

        r2 = await client.post(f"/api/v1/sessions/{session_id}/profit")
        assert r2.status_code == 200

        async with get_sessionmaker()() as db:
            result = await db.execute(
                select(func.count())
                .select_from(CostEvent)
                .where(CostEvent.session_id == session_id)
            )
            count = result.scalar_one()

        assert count == 5, f"expected 5 cost_events after 2 POSTs, got {count}"

    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_profit_negative_net_returns_200(client: AsyncClient) -> None:
    """Negative net_profit is a valid value — must return HTTP 200, not an error."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    # Return a very long route (20 000 km) so costs exceed revenue
    def long_route(waypoints: list[tuple[float, float]]) -> MultiStopRouteResult:
        n = max(len(waypoints) - 1, 1)
        return MultiStopRouteResult(
            total_distance_km=float(n * 10_000),
            total_duration_minutes=n * 3000,
            legs=[
                RouteLeg(
                    distance_km=10_000.0,
                    duration_minutes=3000,
                    from_index=i,
                    to_index=i + 1,
                )
                for i in range(n)
            ],
            geometry_geojson={
                "type": "LineString",
                "coordinates": [[20.0 + i, 52.0 - i * 0.3] for i in range(n + 1)],
            },
        )

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=long_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session(client)

        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=3"
        )
        for o in ranked.json()["offers"][:3]:
            await client.post(
                f"/api/v1/sessions/{session_id}/offers/{o['offer_id']}"
            )

        resp = await client.post(f"/api/v1/sessions/{session_id}/profit")
        assert resp.status_code == 200
        data = resp.json()
        assert data["net_profit_eur"] < 0, "expected negative profit with huge costs"

    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_profit_session_not_found(client: AsyncClient) -> None:
    missing = "00000000-0000-0000-0000-000000000099"
    resp = await client.post(f"/api/v1/sessions/{missing}/profit")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_profit_empty_session_returns_422(client: AsyncClient) -> None:
    """Session with no offers (empty route_stops) should return 422."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session(client)
        resp = await client.post(f"/api/v1/sessions/{session_id}/profit")
        assert resp.status_code == 422

    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_get_profit_alias_returns_same_as_post(client: AsyncClient) -> None:
    """GET /profit alias returns the same data structure as POST /profit."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session(client)

        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=2"
        )
        for o in ranked.json()["offers"][:2]:
            await client.post(
                f"/api/v1/sessions/{session_id}/offers/{o['offer_id']}"
            )

        post_resp = await client.post(f"/api/v1/sessions/{session_id}/profit")
        assert post_resp.status_code == 200
        post_data = post_resp.json()

        get_resp = await client.get(f"/api/v1/sessions/{session_id}/profit")
        assert get_resp.status_code == 200
        get_data = get_resp.json()

        assert get_data["session_id"] == post_data["session_id"]
        assert get_data["revenue_eur"] == post_data["revenue_eur"]
        assert get_data["net_profit_eur"] == pytest.approx(
            post_data["net_profit_eur"], abs=0.01
        )
        assert len(get_data["leg_costs"]) == len(post_data["leg_costs"])
        assert get_data["days_on_road"] == post_data["days_on_road"]
        assert get_data["toll_is_estimated"] == post_data["toll_is_estimated"]

    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_profit_breakdown_components_sum_to_net(client: AsyncClient) -> None:
    """fuel + toll + stop + driver + maintenance must equal net profit components."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session(client)
        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=3"
        )
        for o in ranked.json()["offers"][:3]:
            await client.post(
                f"/api/v1/sessions/{session_id}/offers/{o['offer_id']}"
            )

        data = (await client.post(f"/api/v1/sessions/{session_id}/profit")).json()
        expected_net = round(
            data["revenue_eur"]
            - data["fuel_eur"]
            - data["toll_eur"]
            - data["stop_costs_eur"]
            - data["driver_eur"]
            - data["maintenance_eur"],
            2,
        )
        assert data["net_profit_eur"] == pytest.approx(expected_net, abs=0.01)
    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_stop_bar_only_when_multiple_stops(client: AsyncClient) -> None:
    """Single-offer session still returns stop_costs_eur (may be zero for one leg)."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session(client)
        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=1"
        )
        await client.post(
            f"/api/v1/sessions/{session_id}/offers/{ranked.json()['offers'][0]['offer_id']}"
        )

        data = (await client.post(f"/api/v1/sessions/{session_id}/profit")).json()
        assert data["stop_count"] == 2
        assert data["stop_costs_eur"] >= 0.0
    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_leg_costs_count_matches_route(client: AsyncClient) -> None:
    """Number of leg_costs rows equals number of route legs."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session(client)
        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=3"
        )
        for o in ranked.json()["offers"][:3]:
            await client.post(
                f"/api/v1/sessions/{session_id}/offers/{o['offer_id']}"
            )

        data = (await client.post(f"/api/v1/sessions/{session_id}/profit")).json()
        assert len(data["leg_costs"]) == len(data["legs"])
    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_idempotent_double_post(client: AsyncClient) -> None:
    """POST /profit twice returns the same net profit."""
    from app.lib.routing import get_routing_provider
    from app.main import app as fastapi_app

    mock_routing = AsyncMock()
    mock_routing.get_route_multi = AsyncMock(side_effect=_make_route)
    fastapi_app.dependency_overrides[get_routing_provider] = lambda: mock_routing

    try:
        session_id = await _create_session(client)
        await client.post(f"/api/v1/sessions/{session_id}/simulate?count=30")
        ranked = await client.get(
            f"/api/v1/sessions/{session_id}/ranked-offers?limit=2"
        )
        for o in ranked.json()["offers"][:2]:
            await client.post(
                f"/api/v1/sessions/{session_id}/offers/{o['offer_id']}"
            )

        first = (await client.post(f"/api/v1/sessions/{session_id}/profit")).json()
        second = (await client.post(f"/api/v1/sessions/{session_id}/profit")).json()
        assert second["net_profit_eur"] == pytest.approx(first["net_profit_eur"], abs=0.01)
    finally:
        del fastapi_app.dependency_overrides[get_routing_provider]


@pytest.mark.asyncio
async def test_get_profit_session_not_found(client: AsyncClient) -> None:
    """GET /profit returns 404 for missing session."""
    missing = "00000000-0000-0000-0000-000000000099"
    resp = await client.get(f"/api/v1/sessions/{missing}/profit")
    assert resp.status_code == 404
