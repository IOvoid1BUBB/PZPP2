"""Integration tests for GET /api/v1/sessions list filters."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


async def _create_session(client: AsyncClient) -> UUID:
    vehicles = await client.get("/api/v1/vehicles")
    assert vehicles.status_code == 200
    vehicle_list = vehicles.json()
    assert vehicle_list, "seed vehicles required for integration tests"
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


async def _set_session_fields(
    session_id: UUID,
    *,
    created_at: datetime,
    status: str,
) -> None:
    from app.core.database import get_sessionmaker
    from app.models import ConsolidationSession

    async with get_sessionmaker()() as db:
        session = await db.get(ConsolidationSession, session_id)
        assert session is not None
        session.created_at = created_at
        session.status = status
        await db.commit()


@pytest.mark.asyncio
async def test_list_sessions_without_filters_returns_200(client: AsyncClient) -> None:
    response = await client.get("/api/v1/sessions")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_list_sessions_invalid_date_returns_422(client: AsyncClient) -> None:
    response = await client.get("/api/v1/sessions?date=not-a-date")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_sessions_filter_by_status_and_date(client: AsyncClient) -> None:
    session_a = await _create_session(client)
    session_b = await _create_session(client)

    await _set_session_fields(
        session_a,
        created_at=datetime(2026, 6, 2, 10, 0, tzinfo=UTC),
        status="dispatched",
    )
    await _set_session_fields(
        session_b,
        created_at=datetime(2026, 6, 3, 10, 0, tzinfo=UTC),
        status="dispatched",
    )

    response = await client.get("/api/v1/sessions?status=dispatched&date=2026-06-02")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(session_a) in ids
    assert str(session_b) not in ids

    response_b = await client.get("/api/v1/sessions?status=dispatched&date=2026-06-03")
    assert response_b.status_code == 200
    ids_b = {row["id"] for row in response_b.json()}
    assert str(session_b) in ids_b
    assert str(session_a) not in ids_b


@pytest.mark.asyncio
async def test_list_sessions_date_today_literal(client: AsyncClient) -> None:
    session_id = await _create_session(client)
    await _set_session_fields(
        session_id,
        created_at=datetime.now(UTC),
        status="dispatched",
    )

    response = await client.get("/api/v1/sessions?status=dispatched&date=today")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(session_id) in ids
