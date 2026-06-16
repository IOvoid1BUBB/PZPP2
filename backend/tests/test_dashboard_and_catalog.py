"""Tests for dashboard, offers list, and stops list endpoints."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.integration
@pytest.mark.asyncio
async def test_dashboard_returns_kpis() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/dashboard")

    assert response.status_code == 200
    body = response.json()
    assert "kpis" in body
    assert "recent_sessions" in body
    assert "total_sessions" in body["kpis"]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_offers_list_returns_array() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/offers?limit=5")

    assert response.status_code == 200
    assert isinstance(response.json(), list)
    assert "X-Total-Count" in response.headers


@pytest.mark.integration
@pytest.mark.asyncio
async def test_stops_list_unknown_session_404() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/v1/sessions/00000000-0000-4000-8000-000000000099/stops",
        )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_readiness_endpoint() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health/ready")

    assert response.status_code == 200
    body = response.json()
    assert "checks" in body
    assert body["status"] in {"ok", "degraded"}
