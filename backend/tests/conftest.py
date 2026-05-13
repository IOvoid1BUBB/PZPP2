"""Shared pytest fixtures.

The health endpoint does not touch the database, so we only need to ensure
``DATABASE_URL`` is set to *something* so ``Settings`` validation passes
during import of :mod:`app.main`.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Async HTTP client wired to the FastAPI app via ASGI transport."""
    from app.main import app  # imported lazily so env vars are set first

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
