"""Tests for dashboard, offers list, and stops list endpoints."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.integration
@pytest.mark.asyncio
async def test_dashboard_returns_kpis(client: AsyncClient) -> None:
    response = await client.get("/api/v1/dashboard")
    assert response.status_code == 200
    body = response.json()
    assert "today_net_profit_eur" in body
    assert "today_net_profit_pln" in body
    assert "avg_lfill_pct" in body
    assert "empty_runs_pct" in body
    assert "active_sessions" in body
    assert "notifications" in body


@pytest.mark.integration
@pytest.mark.asyncio
async def test_offers_list_returns_array(client: AsyncClient) -> None:
    response = await client.get("/api/v1/offers?limit=5")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_stops_list_unknown_session_404(client: AsyncClient) -> None:
    response = await client.get(
        "/api/v1/sessions/00000000-0000-4000-8000-000000000099/stops",
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_readiness_endpoint(client: AsyncClient) -> None:
    response = await client.get("/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert "checks" in body
    assert body["status"] in {"ok", "degraded"}
