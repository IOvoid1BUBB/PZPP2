#!/usr/bin/env python3
"""Seed initial market offers (idempotent — nie duplikuje gdy oferty już istnieją).

Reguła LDM: każda oferta ma ldm = k × PALLET_LDM (k ∈ ℕ, k ≥ 1).
Huby: Polska + DACH — zgodne z market_simulator.LOGISTICS_HUBS.

Prefer ``seed_european_loads.py`` for production-like European coverage.

Uruchomienie z ``backend/``::

    python scripts/seed_market_offers.py [--count N]

Domyślnie N=200. Skrypt jest idempotentny: sprawdza liczbę istniejących ofert
i uzupełnia tylko brakującą różnicę.
"""

from __future__ import annotations

import argparse
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

DEFAULT_SEED_COUNT = 200
BATCH_SIZE = 200


def _ensure_env() -> None:
    repo_root = BACKEND_ROOT.parent
    for directory in (repo_root, BACKEND_ROOT):
        env_file = directory / ".env"
        if env_file.is_file():
            os.chdir(directory)
            get_settings.cache_clear()
            return


async def seed_market_offers(target_count: int = DEFAULT_SEED_COUNT) -> dict[str, int]:
    """Upewnij się, że w tabeli market_offers jest co najmniej ``target_count`` wierszy."""
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        existing = await session.scalar(select(func.count()).select_from(MarketOffer))
        existing = int(existing or 0)
        to_insert = max(0, target_count - existing)

        if to_insert == 0:
            logger.info("market_offers: already %d >= %d, skip", existing, target_count)
            return {"existing": existing, "inserted": 0, "skipped": 0, "total": existing}

        logger.info(
            "market_offers: existing=%d, inserting=%d to reach target=%d",
            existing,
            to_insert,
            target_count,
        )
        generated = generate_batch(to_insert, base_time=datetime.now(UTC))
        offers = [item.offer for item in generated]

        inserted_total = 0
        skipped_total = 0
        for start in range(0, len(offers), BATCH_SIZE):
            batch = offers[start : start + BATCH_SIZE]
            inserted, skipped = await bulk_insert_offers(session, batch)
            inserted_total += inserted
            skipped_total += skipped

        await session.commit()
        total = await session.scalar(select(func.count()).select_from(MarketOffer))
        total = int(total or 0)
        logger.info("market_offers seeded; total rows: %d", total)
        return {
            "existing": existing,
            "inserted": inserted_total,
            "skipped": skipped_total,
            "total": total,
        }


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Seed market offers with valid LDM (k×PALLET_LDM).")
    parser.add_argument(
        "--count",
        type=int,
        default=DEFAULT_SEED_COUNT,
        help=f"Docelowa liczba ofert w tabeli (domyślnie {DEFAULT_SEED_COUNT}).",
    )
    args = parser.parse_args()

    _ensure_env()
    get_settings()

    try:
        result = await seed_market_offers(args.count)
    except Exception:
        logger.exception("Market offers seed failed")
        raise SystemExit(1) from None

    print(
        f"Seed market_offers: existing={result['existing']}, "
        f"inserted={result['inserted']}, skipped={result['skipped']}, total={result['total']}"
    )


if __name__ == "__main__":
    asyncio.run(main())
