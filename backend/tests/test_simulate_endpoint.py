"""Integration tests for POST /api/v1/sessions/{id}/simulate."""

from __future__ import annotations

import random
from datetime import UTC, datetime
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text

from app.core.database import get_sessionmaker
from app.models.offer import MarketOffer

pytestmark = pytest.mark.integration


async def _create_session(client: AsyncClient) -> UUID:
    response = await client.post(
        "/api/v1/sessions",
        json={"status": "draft"},
    )
    assert response.status_code == 201
    return UUID(response.json()["id"])


@pytest.mark.asyncio
async def test_simulate_generates_offers(client: AsyncClient) -> None:
    session_id = await _create_session(client)

    response = await client.post(f"/api/v1/sessions/{session_id}/simulate?count=200")

    assert response.status_code == 200
    body = response.json()
    assert body["requested"] == 200
    assert body["inserted"] + body["skipped"] == 200
    assert body["inserted"] > 0


@pytest.mark.asyncio
async def test_simulate_is_idempotent(client: AsyncClient) -> None:
    session_id = await _create_session(client)

    random.seed(42)
    first = await client.post(f"/api/v1/sessions/{session_id}/simulate?count=200")
    assert first.status_code == 200
    first_body = first.json()
    assert first_body["inserted"] > 0

    random.seed(42)
    second = await client.post(f"/api/v1/sessions/{session_id}/simulate?count=200")
    assert second.status_code == 200
    second_body = second.json()
    assert second_body["inserted"] == 0
    assert second_body["skipped"] == 200


@pytest.mark.asyncio
async def test_simulate_session_not_found(client: AsyncClient) -> None:
    missing = "00000000-0000-0000-0000-000000000099"
    response = await client.post(f"/api/v1/sessions/{missing}/simulate?count=10")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_simulate_acceptance_criteria_in_db(client: AsyncClient) -> None:
    session_id = await _create_session(client)
    before = datetime.now(UTC)

    response = await client.post(f"/api/v1/sessions/{session_id}/simulate?count=200")
    assert response.status_code == 200

    session_factory = get_sessionmaker()
    async with session_factory() as db:
        batch_filter = MarketOffer.time_window_open >= before
        non_stackable = await db.scalar(
            select(func.count())
            .select_from(MarketOffer)
            .where(batch_filter, MarketOffer.stackable.is_(False)),
        )
        min_open = await db.scalar(
            select(func.min(MarketOffer.time_window_open)).where(batch_filter),
        )
        handling_bad = await db.scalar(
            select(func.count())
            .select_from(MarketOffer)
            .where(
                batch_filter,
                MarketOffer.handling_time_minutes.notin_([15, 30, 45, 60]),
            ),
        )
        non_positive_price = await db.scalar(
            select(func.count())
            .select_from(MarketOffer)
            .where(batch_filter, MarketOffer.price_eur <= 0),
        )
        pickup_hubs = (
            await db.execute(
                text(
                    """
                    SELECT COUNT(DISTINCT pickup_point::text)
                    FROM market_offers
                    WHERE time_window_open >= :since
                    """,
                ),
                {"since": before},
            )
        ).scalar_one()
        delivery_hubs = (
            await db.execute(
                text(
                    """
                    SELECT COUNT(DISTINCT delivery_point::text)
                    FROM market_offers
                    WHERE time_window_open >= :since
                    """,
                ),
                {"since": before},
            )
        ).scalar_one()

    assert non_stackable is not None
    assert 50 <= non_stackable <= 90
    assert min_open is not None
    assert min_open > before
    assert handling_bad == 0
    assert non_positive_price == 0
    assert pickup_hubs >= 4
    assert delivery_hubs >= 5
