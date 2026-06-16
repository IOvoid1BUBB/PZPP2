#!/usr/bin/env python3
"""Seed synthetic market offers from logistics hubs (legacy PL+DACH dataset).

Idempotent: uses ``bulk_insert_offers`` with ON CONFLICT DO NOTHING.

Prefer ``seed_european_loads.py`` for production-like European coverage.

Run from ``backend/``::

    python scripts/seed_market_offers.py
    SEED_OFFER_COUNT=200 python scripts/seed_market_offers.py
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import func, select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings
from app.core.database import get_sessionmaker
from app.models.offer import MarketOffer
from app.services.market_offers import bulk_insert_offers
from app.services.market_simulator import generate_batch

logger = logging.getLogger(__name__)

DEFAULT_COUNT = int(os.environ.get("SEED_OFFER_COUNT", "200"))
BATCH_SIZE = 200


def _ensure_env() -> None:
    repo_root = BACKEND_ROOT.parent
    for directory in (repo_root, BACKEND_ROOT):
        env_file = directory / ".env"
        if env_file.is_file():
            os.chdir(directory)
            get_settings.cache_clear()
            return


async def seed_market_offers(count: int = DEFAULT_COUNT) -> tuple[int, int, int]:
    generated = generate_batch(count, base_time=datetime.now(UTC))
    offers = [item.offer for item in generated]

    session_factory = get_sessionmaker()
    inserted_total = 0
    skipped_total = 0

    async with session_factory() as session:
        for start in range(0, len(offers), BATCH_SIZE):
            batch = offers[start : start + BATCH_SIZE]
            inserted, skipped = await bulk_insert_offers(session, batch)
            inserted_total += inserted
            skipped_total += skipped
        await session.commit()

        total_rows = await session.scalar(select(func.count()).select_from(MarketOffer))
        if total_rows is None:
            total_rows = 0

    return inserted_total, skipped_total, int(total_rows)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    _ensure_env()
    get_settings()

    try:
        inserted, skipped, total = await seed_market_offers()
    except Exception:
        logger.exception("Market offers seed failed")
        raise SystemExit(1) from None

    logger.info(
        "Seeded market offers — inserted=%d skipped=%d total_rows=%d",
        inserted,
        skipped,
        total,
    )


if __name__ == "__main__":
    asyncio.run(main())
