"""Integration tests for GET /api/v1/dashboard."""

from __future__ import annotations

import time
from uuid import UUID

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration

_TARGET_SESSIONS = 20


async def _create_session(client: AsyncClient) -> UUID:
    vehicles = await client.get("/api/v1/vehicles")
    assert vehicles.status_code == 200
    vehicle_list = vehicles.json()
    assert vehicle_list, "seed vehicles required"
    vehicle_id = vehicle_list[0]["id"]

    profiles = await client.get("/api/v1/driver-profiles")
    assert profiles.status_code == 200
    profile_id = profiles.json()[0]["id"]

    response = await client.post(
        "/api/v1/sessions",
        json={
            "vehicle_id": vehicle_id,
            "driver_profile_id": profile_id,
            "origin_lon": 21.0,
            "origin_lat": 52.0,
            "target_region_bbox": [14.0, 49.0, 24.0, 55.0],
        },
    )
    assert response.status_code == 201
    return UUID(response.json()["id"])


async def _ensure_dashboard_seed(client: AsyncClient) -> None:
    """Create sessions until today's dashboard has at least ``_TARGET_SESSIONS`` rows."""
    dashboard = await client.get("/api/v1/dashboard")
    assert dashboard.status_code == 200
    active_count = len(dashboard.json()["active_sessions"])
    if active_count >= _TARGET_SESSIONS:
        return

    to_create = _TARGET_SESSIONS - active_count
    for _ in range(to_create):
        await _create_session(client)


@pytest.fixture
async def seeded_dashboard(client: AsyncClient) -> None:
    await _ensure_dashboard_seed(client)


@pytest.mark.asyncio
async def test_dashboard_returns_new_contract(client: AsyncClient, seeded_dashboard: None) -> None:
    response = await client.get("/api/v1/dashboard")
    assert response.status_code == 200
    body = response.json()

    assert "today_net_profit_eur" in body
    assert "avg_lfill_pct" in body
    assert "empty_runs_pct" in body
    assert "active_sessions" in body
    assert "notifications" in body
    assert "kpis" not in body
    assert "recent_sessions" not in body


@pytest.mark.asyncio
async def test_dashboard_active_sessions_shape(client: AsyncClient, seeded_dashboard: None) -> None:
    response = await client.get("/api/v1/dashboard")
    body = response.json()

    assert len(body["active_sessions"]) >= 1
    session_row = body["active_sessions"][0]
    assert "session_id" in session_row
    assert "vehicle_name" in session_row
    assert "current_location" in session_row
    assert "destination" in session_row
    assert "lfil_pct" in session_row
    assert "status" in session_row
    assert "has_time_window_risk" in session_row


@pytest.mark.asyncio
async def test_dashboard_notifications_include_backlog_type(
    client: AsyncClient,
    seeded_dashboard: None,
) -> None:
    response = await client.get("/api/v1/dashboard")
    notifications = response.json()["notifications"]
    assert len(notifications) >= 1

    backlog_prefixes = ("empty-", "stale-", "time-window-", "market-volume", "empty-state")
    assert any(
        notification["id"].startswith(prefix) or notification["id"] == prefix
        for notification in notifications
        for prefix in backlog_prefixes
    )
    assert any(
        notification["id"].startswith("empty-") and notification["id"] != "empty-state"
        for notification in notifications
    )


@pytest.mark.asyncio
async def test_dashboard_response_under_500ms(client: AsyncClient, seeded_dashboard: None) -> None:
    await client.get("/api/v1/dashboard")

    started = time.perf_counter()
    response = await client.get("/api/v1/dashboard")
    elapsed_ms = (time.perf_counter() - started) * 1000

    assert response.status_code == 200
    assert elapsed_ms < 500, f"dashboard took {elapsed_ms:.1f}ms"


@pytest.mark.asyncio
async def test_dashboard_kpi_values_sane(client: AsyncClient, seeded_dashboard: None) -> None:
    response = await client.get("/api/v1/dashboard")
    body = response.json()

    assert body["today_net_profit_eur"] >= 0
    assert 0 <= body["avg_lfill_pct"] <= 100
    assert 0 <= body["empty_runs_pct"] <= 100
    assert isinstance(body["notifications"], list)
