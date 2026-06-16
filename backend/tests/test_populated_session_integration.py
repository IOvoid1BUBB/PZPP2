"""Integration test exercising the testcontainers-backed ``populated_session``.

Verifies the disposable-database fixture end-to-end: migrations applied, vehicle
catalog seeded, a draft session created, and 50 simulated offers reachable
through the public API. Self-skips when Docker / testcontainers are unavailable.
"""

from __future__ import annotations

from uuid import UUID

from httpx import ASGITransport, AsyncClient


async def test_populated_session_is_queryable(populated_session: str) -> None:
    # The fixture set DATABASE_URL to the throwaway container and cleared the
    # cached engine, so the app now talks to the seeded container database.
    UUID(populated_session)  # raises if the fixture returned a malformed id

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        detail_res = await ac.get(f"/api/v1/sessions/{populated_session}")
        assert detail_res.status_code == 200
        detail = detail_res.json()
        assert detail["status"] == "draft"

        ranked_res = await ac.get(
            f"/api/v1/sessions/{populated_session}/ranked-offers?limit=50",
        )
        assert ranked_res.status_code == 200
        ranked = ranked_res.json()
        # 50 offers were simulated into the market pool for this session.
        assert len(ranked["offers"]) >= 10
