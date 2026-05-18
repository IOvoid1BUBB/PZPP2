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
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    skip_integration = pytest.mark.skip(reason="PostgreSQL not available for integration tests")
    for item in items:
        if "integration" not in item.keywords:
            continue
        try:
            from app.core.database import get_engine

            engine = get_engine()

            async def _ping() -> None:
                async with engine.connect() as conn:
                    await conn.execute(text("SELECT 1"))

            import asyncio

            asyncio.run(_ping())
        except (SQLAlchemyError, OSError, ConnectionError):
            item.add_marker(skip_integration)


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Async HTTP client wired to the FastAPI app via ASGI transport."""
    from app.main import app  # imported lazily so env vars are set first

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
