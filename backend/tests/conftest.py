"""Shared pytest fixtures.

The health endpoint does not touch the database, so we only need to ensure
``DATABASE_URL`` is set to *something* so ``Settings`` validation passes
during import of :mod:`app.main`.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

BACKEND_ROOT = Path(__file__).resolve().parents[1]

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


# ---------------------------------------------------------------------------
# Integration fixture: a fully populated session backed by a throwaway DB.
# ---------------------------------------------------------------------------


async def _create_populated_session(async_url: str, *, offer_count: int) -> str:
    """Create a draft man_solo session with ``offer_count`` simulated offers.

    The FastAPI ``get_db`` dependency is overridden to point at the throwaway
    container database so the call path is identical to production without
    touching the process-wide engine.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.core.database import get_db
    from app.main import app

    engine = create_async_engine(async_url)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def _override_get_db() -> AsyncIterator[object]:
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            vehicles_res = await ac.get("/api/v1/vehicles")
            vehicles_res.raise_for_status()
            vehicles = vehicles_res.json()
            vehicle = next(
                (v for v in vehicles if v.get("type") == "man_solo"),
                vehicles[0] if vehicles else None,
            )
            if vehicle is None:
                raise RuntimeError("No vehicles available after seeding.")

            payload: dict[str, object] = {
                "vehicle_id": vehicle["id"],
                "origin_lon": 21.01,
                "origin_lat": 52.22,
                "target_region_bbox": [18.0, 49.0, 24.0, 55.0],
            }
            profiles_res = await ac.get("/api/v1/driver-profiles")
            if profiles_res.status_code == 200:
                profiles = profiles_res.json()
                if profiles:
                    payload["driver_profile_id"] = profiles[0]["id"]

            session_res = await ac.post("/api/v1/sessions", json=payload)
            session_res.raise_for_status()
            session_id = session_res.json()["id"]

            simulate_res = await ac.post(
                f"/api/v1/sessions/{session_id}/simulate?count={offer_count}",
            )
            simulate_res.raise_for_status()
            return str(session_id)
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()


@pytest.fixture(scope="session")
def populated_session() -> Iterator[str]:
    """Session-scoped, idempotent fixture returning a seeded ``session_id``.

    Spins up a disposable PostGIS database via *testcontainers*, applies Alembic
    migrations, seeds the vehicle catalog, and creates a draft session with 50
    simulated offers through the public API. The container is torn down at the
    end of the test session, so every run starts from a clean database.

    Skips cleanly when Docker / testcontainers are unavailable so the regular
    unit-test suite is never blocked by this heavyweight fixture.
    """
    postgres = pytest.importorskip(
        "testcontainers.postgres",
        reason="testcontainers is required for the populated_session fixture",
    )

    try:
        container = postgres.PostgresContainer("postgis/postgis:16-3.4-alpine")
        container.start()
    except Exception as exc:  # pragma: no cover - depends on a live Docker daemon
        pytest.skip(f"Docker unavailable for testcontainers: {exc}")

    saved_db_url = os.environ.get("DATABASE_URL")
    try:
        host = container.get_container_host_ip()
        port = container.get_exposed_port(5432)
        async_url = (
            f"postgresql+asyncpg://{container.username}:{container.password}"
            f"@{host}:{port}/{container.dbname}"
        )

        # Point migrations, seed, and the app at the throwaway database.
        child_env = {
            **os.environ,
            "DATABASE_URL": async_url,
            "USE_SOLVER_MOCK": "true",
            "USE_ROUTING_MOCK": "true",
        }
        os.environ.update(
            {
                "DATABASE_URL": async_url,
                "USE_SOLVER_MOCK": "true",
                "USE_ROUTING_MOCK": "true",
            }
        )

        from app.core.config import get_settings
        from app.core.database import get_engine, get_sessionmaker

        get_settings.cache_clear()
        get_engine.cache_clear()
        get_sessionmaker.cache_clear()

        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND_ROOT,
            env=child_env,
            check=True,
        )
        subprocess.run(
            [sys.executable, "scripts/seed_vehicles.py"],
            cwd=BACKEND_ROOT,
            env=child_env,
            check=True,
        )

        session_id = asyncio.run(
            _create_populated_session(async_url, offer_count=50)
        )
        yield session_id
    finally:
        if saved_db_url is not None:
            os.environ["DATABASE_URL"] = saved_db_url
        from app.core.config import get_settings
        from app.core.database import get_engine, get_sessionmaker

        get_settings.cache_clear()
        get_engine.cache_clear()
        get_sessionmaker.cache_clear()
        container.stop()
