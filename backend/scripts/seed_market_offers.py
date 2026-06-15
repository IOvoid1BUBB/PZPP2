#!/usr/bin/env python3
"""Seed initial market offers (idempotent — nie duplikuje gdy oferty już istnieją).

Reguła LDM: każda oferta ma ldm = k × PALLET_LDM (k ∈ ℕ, k ≥ 1).
Huby: Polska + DACH — zgodne z market_simulator.LOGISTICS_HUBS.

Uruchomienie z ``backend/``::

    python scripts/seed_market_offers.py [--count N]

Domyślnie N=200. Skrypt jest idempotentny: sprawdza liczbę istniejących ofert
i uzupełnia tylko brakującą różnicę.
"""

from __future__ import annotations

import asyncio
import argparse
import logging
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_sessionmaker
from app.models.market_offer import MarketOffer
from app.services.market_simulator import generate_batch

logger = logging.getLogger(__name__)

DEFAULT_SEED_COUNT = 200


def _ensure_env() -> None:
    repo_root = BACKEND_ROOT.parent
    for directory in (repo_root, BACKEND_ROOT):
        env_file = directory / ".env"
        if env_file.is_file():
            os.chdir(directory)
            get_settings.cache_clear()
            return


async def _count_existing(session: AsyncSession) -> int:
    result = await session.scalar(select(func.count()).select_from(MarketOffer))
    return int(result or 0)


async def _insert_offers(session: AsyncSession, count: int) -> int:
    """Wygeneruj i wstaw ``count`` ofert. Zwraca faktycznie wstawioną liczbę."""
    if count <= 0:
        return 0

    base_time = datetime.now(UTC)
    batch = generate_batch(count, base_time=base_time)

    inserted = 0
    for item in batch:
        offer_data = item.offer
        offer = MarketOffer(
            pickup_point=text(  # type: ignore[call-arg]
                f"ST_GeomFromText('{offer_data.pickup_point.replace('SRID=4326;', '')}', 4326)"
            ),
            delivery_point=text(  # type: ignore[call-arg]
                f"ST_GeomFromText('{offer_data.delivery_point.replace('SRID=4326;', '')}', 4326)"
            ),
            ldm=offer_data.ldm,
            weight_kg=offer_data.weight_kg,
            price_eur=offer_data.price_eur,
            time_window_open=offer_data.time_window_open,
            time_window_close=offer_data.time_window_close,
            handling_time_minutes=offer_data.handling_time_minutes,
            stackable=offer_data.stackable,
        )
        session.add(offer)
        inserted += 1

    await session.flush()
    return inserted


async def _insert_offers_raw(session: AsyncSession, count: int) -> int:
    """Wstaw oferty przez parametryzowane INSERT (PostGIS ST_GeomFromText)."""
    if count <= 0:
        return 0

    base_time = datetime.now(UTC)
    batch = generate_batch(count, base_time=base_time)

    inserted = 0
    for item in batch:
        o = item.offer
        # Wyciągnij WKT z formatu EWKT "SRID=4326;POINT(lon lat)"
        pickup_wkt = o.pickup_point.split(";", 1)[1]
        delivery_wkt = o.delivery_point.split(";", 1)[1]
        await session.execute(
            text(
                """
                INSERT INTO market_offers
                    (pickup_point, delivery_point, ldm, weight_kg, price_eur,
                     time_window_open, time_window_close, handling_time_minutes, stackable)
                VALUES
                    (ST_GeomFromText(:pickup, 4326),
                     ST_GeomFromText(:delivery, 4326),
                     :ldm, :weight_kg, :price_eur,
                     :tw_open, :tw_close, :handling, :stackable)
                """
            ),
            {
                "pickup": pickup_wkt,
                "delivery": delivery_wkt,
                "ldm": float(o.ldm),
                "weight_kg": o.weight_kg,
                "price_eur": float(o.price_eur),
                "tw_open": o.time_window_open,
                "tw_close": o.time_window_close,
                "handling": o.handling_time_minutes,
                "stackable": o.stackable,
            },
        )
        inserted += 1

    return inserted


async def seed_market_offers(target_count: int = DEFAULT_SEED_COUNT) -> dict[str, int]:
    """Upewnij się, że w tabeli market_offers jest co najmniej ``target_count`` wierszy.

    Returns
    -------
    dict z kluczami: existing, inserted, total
    """
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        existing = await _count_existing(session)
        to_insert = max(0, target_count - existing)

        if to_insert == 0:
            logger.info(
                "market_offers: already %d >= %d, skip", existing, target_count
            )
            return {"existing": existing, "inserted": 0, "total": existing}

        logger.info(
            "market_offers: existing=%d, inserting=%d to reach target=%d",
            existing, to_insert, target_count,
        )
        inserted = await _insert_offers_raw(session, to_insert)
        await session.commit()

        total = await _count_existing(session)
        logger.info("market_offers seeded; total rows: %d", total)
        return {"existing": existing, "inserted": inserted, "total": total}


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Seed market offers with valid LDM (k×1.4).")
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
        f"inserted={result['inserted']}, total={result['total']}"
    )


if __name__ == "__main__":
    asyncio.run(main())
