"""Unit tests for dashboard API and service (mocked database)."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)


def _session_row(
    *,
    status: str = "draft",
    with_offers: bool = False,
    net_profit: float | None = None,
) -> SimpleNamespace:
    session_id = uuid4()
    offer_id = uuid4()
    offer = SimpleNamespace(
        offer_id=offer_id,
        ldm=2.0,
        price_eur=500.0,
        time_window_open=None,
        time_window_close=None,
        handling_time_minutes=30,
    )
    stops: list[SimpleNamespace] = []
    if with_offers:
        stops = [
            SimpleNamespace(
                offer_id=offer_id,
                offer=offer,
                stop_type="pickup",
                sequence_order=0,
                address_label="Pickup City",
                location=None,
                eta_minutes_from_start=30,
                stop_cost_eur=10.0,
            ),
            SimpleNamespace(
                offer_id=offer_id,
                offer=offer,
                stop_type="delivery",
                sequence_order=1,
                address_label="Delivery City",
                location=None,
                eta_minutes_from_start=90,
                stop_cost_eur=10.0,
            ),
        ]
    return SimpleNamespace(
        id=session_id,
        status=status,
        created_at=datetime.now(UTC),
        net_profit_eur=net_profit,
        origin_lat=52.0,
        origin_lon=21.0,
        vehicle=SimpleNamespace(name="Master L3", max_ldm=10.0),
        route_stops=stops,
    )


@pytest.mark.asyncio
async def test_dashboard_endpoint_delegates_to_service(monkeypatch: pytest.MonkeyPatch) -> None:
    from httpx import ASGITransport, AsyncClient

    from app.core.database import get_db
    from app.main import app
    from app.schemas.dashboard import DashboardResponse

    expected = DashboardResponse(
        today_net_profit_eur=100.0,
        avg_lfill_pct=50.0,
        empty_runs_pct=25.0,
        active_sessions=[],
        notifications=[],
    )

    mock_service = MagicMock()
    mock_service.get_dashboard = AsyncMock(return_value=expected)

    def _service_factory(db: object, settings: object = None) -> MagicMock:
        return mock_service

    monkeypatch.setattr("app.api.dashboard.DashboardService", _service_factory)
    app.dependency_overrides[get_db] = lambda: AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/dashboard")

    assert response.status_code == 200
    assert response.json()["today_net_profit_eur"] == 100.0
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_dashboard_service_builds_kpis_and_notifications() -> None:
    from app.core.config import Settings
    from app.services.dashboard import DashboardService

    empty = _session_row(status="draft", with_offers=False)
    loaded = _session_row(status="confirmed", with_offers=True, net_profit=120.0)

    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [empty, loaded]

    mock_db = AsyncMock()
    mock_db.scalar = AsyncMock(return_value=5)
    mock_db.execute = AsyncMock(return_value=mock_result)

    settings = Settings(
        DATABASE_URL="postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
        APP_TIMEZONE="UTC",
    )
    response = await DashboardService(mock_db, settings=settings).get_dashboard()

    assert response.today_net_profit_eur == 120.0
    assert response.avg_lfill_pct == 20.0
    assert response.empty_runs_pct == 50.0
    assert len(response.active_sessions) == 2
    assert response.active_sessions[0].vehicle_name == "Master L3"
    assert any(notification.id.startswith("empty-") for notification in response.notifications)
    assert any(notification.id == "market-volume" for notification in response.notifications)


@pytest.mark.asyncio
async def test_dashboard_service_empty_today() -> None:
    from app.core.config import Settings
    from app.services.dashboard import DashboardService

    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []

    mock_db = AsyncMock()
    mock_db.scalar = AsyncMock(return_value=0)
    mock_db.execute = AsyncMock(return_value=mock_result)

    settings = Settings(
        DATABASE_URL="postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
        APP_TIMEZONE="UTC",
    )
    response = await DashboardService(mock_db, settings=settings).get_dashboard()

    assert response.today_net_profit_eur == 0.0
    assert response.empty_runs_pct == 0.0
    assert response.notifications[0].id == "empty-state"
