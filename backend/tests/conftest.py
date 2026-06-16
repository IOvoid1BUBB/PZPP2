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

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)
os.environ.setdefault("ORS_API_KEY", "test-key")


_integration_db_available: bool | None = None


def _postgres_available() -> bool:
    """Synchronous one-shot DB ping for collection-time integration gating."""
    global _integration_db_available
    if _integration_db_available is not None:
        return _integration_db_available

    try:
        from sqlalchemy import create_engine

        raw_url = os.environ.get(
            "DATABASE_URL",
            "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
        )
        sync_url = raw_url.replace("postgresql+asyncpg", "postgresql")
        engine = create_engine(sync_url)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        _integration_db_available = True
    except Exception:
        _integration_db_available = False
    return _integration_db_available


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if _postgres_available():
        return

    skip_integration = pytest.mark.skip(reason="PostgreSQL not available for integration tests")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip_integration)


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Async HTTP client wired to the FastAPI app via ASGI transport."""
    from app.main import app  # imported lazily so env vars are set first

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
