#!/usr/bin/env python3
"""Backfill ``address_label`` for historical :class:`RouteStop` rows.

Uruchomienie z ``backend/``::

    python scripts/backfill_address_labels.py

Pobiera tylko przystanki z pustym ``address_label`` (NULL lub ``""``),
geokoduje je przez Nominatim (max 1 zapytanie/s) i zapisuje etykietę
w formacie zgodnym z UI (np. ``Warszawa, Marszałkowska`` lub fallback
``52.2297, 21.0122``). Skrypt jest idempotentny — ponowne uruchomienie
pomija już uzupełnione rekordy.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from redis.asyncio import Redis
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings
from app.core.database import get_sessionmaker
from app.lib.redis_client import get_redis
from app.models import RouteStop
from app.services.stop_labels import ensure_stop_label

logger = logging.getLogger(__name__)

DEFAULT_BATCH_SIZE = 50


@dataclass(frozen=True)
class BackfillStats:
    """Summary returned after a backfill run."""

    batches: int
    processed: int
    updated: int
    remaining: int


def missing_label_condition() -> object:
    """SQLAlchemy filter for stops without a persisted address label."""
    return or_(RouteStop.address_label.is_(None), RouteStop.address_label == "")


async def fetch_stops_missing_label(
    db: AsyncSession,
    *,
    batch_size: int,
) -> list[RouteStop]:
    """Return up to ``batch_size`` stops that still need ``address_label``."""
    result = await db.execute(
        select(RouteStop)
        .where(missing_label_condition())
        .order_by(RouteStop.id)
        .limit(batch_size),
    )
    return list(result.scalars().all())


async def count_stops_missing_label(db: AsyncSession) -> int:
    """Count stops that still lack ``address_label``."""
    count = await db.scalar(
        select(func.count()).select_from(RouteStop).where(missing_label_condition()),
    )
    return int(count or 0)


async def process_batch(
    db: AsyncSession,
    stops: list[RouteStop],
    *,
    redis: Redis,
) -> int:
    """Geocode and persist labels for one batch; return number of rows updated."""
    updated = 0
    for stop in stops:
        had_label = bool(stop.address_label)
        label = await ensure_stop_label(db, stop, redis=redis)
        if not had_label and label:
            updated += 1
    return updated


async def backfill_address_labels(
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    redis: Redis | None = None,
) -> BackfillStats:
    """Run the backfill loop until no stops remain without ``address_label``."""
    factory = session_factory or get_sessionmaker()
    redis_client = redis or get_redis()

    batches = 0
    processed = 0
    updated = 0

    while True:
        async with factory() as db:
            stops = await fetch_stops_missing_label(db, batch_size=batch_size)
            if not stops:
                break

            batches += 1
            batch_updated = await process_batch(db, stops, redis=redis_client)
            await db.commit()

            processed += len(stops)
            updated += batch_updated

            logger.info(
                "Batch %d complete: %d stops processed, %d labels written",
                batches,
                len(stops),
                batch_updated,
            )

    async with factory() as db:
        remaining = await count_stops_missing_label(db)

    logger.info(
        "Backfill finished: batches=%d processed=%d updated=%d remaining=%d",
        batches,
        processed,
        updated,
        remaining,
    )
    return BackfillStats(
        batches=batches,
        processed=processed,
        updated=updated,
        remaining=remaining,
    )


def _ensure_env() -> None:
    """Load ``.env`` from repo or backend root when present."""
    repo_root = BACKEND_ROOT.parent
    for directory in (repo_root, BACKEND_ROOT):
        env_file = directory / ".env"
        if env_file.is_file():
            os.chdir(directory)
            get_settings.cache_clear()
            return


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    _ensure_env()
    get_settings()

    try:
        stats = await backfill_address_labels()
    except Exception:
        logger.exception("address_label backfill failed")
        raise SystemExit(1) from None

    print(
        "Backfill address_label: "
        f"batches={stats.batches} processed={stats.processed} "
        f"updated={stats.updated} remaining={stats.remaining}"
    )


if __name__ == "__main__":
    asyncio.run(main())
