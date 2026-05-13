"""Smoke tests for the ``/health`` liveness endpoint."""

from __future__ import annotations

import time
import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_returns_ok(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"], "version must be a non-empty string"
    assert body["request_id"], "request_id must be present in body"


@pytest.mark.asyncio
async def test_health_sets_x_request_id_header(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert "x-request-id" in {k.lower() for k in response.headers}
    header_id = response.headers["X-Request-ID"]
    body_id = response.json()["request_id"]
    assert header_id == body_id
    uuid.UUID(header_id)  # raises ValueError if not a valid UUID


@pytest.mark.asyncio
async def test_health_propagates_inbound_request_id(client: AsyncClient) -> None:
    provided = "11111111-1111-1111-1111-111111111111"
    response = await client.get("/health", headers={"X-Request-ID": provided})

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == provided
    assert response.json()["request_id"] == provided


@pytest.mark.asyncio
async def test_health_responds_quickly(client: AsyncClient) -> None:
    # Warm-up call (app factory, route resolution, etc.).
    await client.get("/health")

    start = time.perf_counter()
    response = await client.get("/health")
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert response.status_code == 200
    assert elapsed_ms < 100, f"/health took {elapsed_ms:.1f}ms (>100ms budget)"
