#!/usr/bin/env python3
"""Seed market_offers with European logistics catalog offers.

Idempotent: uses ``bulk_insert_offers`` with ON CONFLICT DO NOTHING.

Run from ``backend/``::

    python scripts/seed_european_loads.py --count 1200
    python scripts/seed_european_loads.py --count 1200 --catalog data/european_logistics_sites.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
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
from app.services.european_offer_generator import (
    LogisticsSite,
    generate_european_batch,
    validate_catalog,
)
from app.services.market_offers import bulk_insert_offers

logger = logging.getLogger(__name__)

DEFAULT_CATALOG = BACKEND_ROOT / "data" / "european_logistics_sites.json"
DEFAULT_COUNT = int(os.environ.get("SEED_OFFER_COUNT", "1200"))
BATCH_SIZE = 200


def _ensure_env() -> None:
    repo_root = BACKEND_ROOT.parent
    for directory in (repo_root, BACKEND_ROOT):
        env_file = directory / ".env"
        if env_file.is_file():
            os.chdir(directory)
            get_settings.cache_clear()
            return


def load_catalog(path: Path) -> list[LogisticsSite]:
    with path.open(encoding="utf-8") as handle:
        raw = json.load(handle)
    if not isinstance(raw, list):
        msg = f"Catalog must be a JSON array: {path}"
        raise ValueError(msg)
    return [LogisticsSite.from_dict(entry) for entry in raw]


async def seed_european_loads(
    *,
    count: int,
    catalog_path: Path,
    seed: int | None = 42,
) -> dict[str, int]:
    sites = load_catalog(catalog_path)
    stats = validate_catalog(sites)
    logger.info(
        "Catalog: %d sites, %d unique coordinates, %d countries",
        stats["total_sites"],
        stats["unique_coordinates"],
        stats["country_count"],
    )

    generated = generate_european_batch(
        sites,
        count,
        base_time=datetime.now(UTC),
        seed=seed,
    )
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

    return {
        "requested": count,
        "inserted": inserted_total,
        "skipped": skipped_total,
        "total_rows": int(total_rows),
        "catalog_sites": int(stats["total_sites"]),
        "catalog_countries": int(stats["country_count"]),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed European market offers.")
    parser.add_argument(
        "--count",
        type=int,
        default=DEFAULT_COUNT,
        help=f"Number of offers to generate (default: {DEFAULT_COUNT})",
    )
    parser.add_argument(
        "--catalog",
        type=Path,
        default=DEFAULT_CATALOG,
        help="Path to european_logistics_sites.json",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="RNG seed for reproducible offer generation",
    )
    return parser.parse_args()


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    _ensure_env()
    get_settings()

    args = parse_args()
    if args.count < 1:
        raise SystemExit("--count must be at least 1")

    if not args.catalog.is_file():
        logger.error("Catalog not found: %s", args.catalog)
        logger.error("Run: python scripts/build_european_logistics_catalog.py")
        raise SystemExit(1)

    try:
        result = await seed_european_loads(
            count=args.count,
            catalog_path=args.catalog,
            seed=args.seed,
        )
    except Exception:
        logger.exception("European loads seed failed")
        raise SystemExit(1) from None

    logger.info(
        "Seed complete — requested=%d inserted=%d skipped=%d total_rows=%d "
        "(catalog %d sites / %d countries)",
        result["requested"],
        result["inserted"],
        result["skipped"],
        result["total_rows"],
        result["catalog_sites"],
        result["catalog_countries"],
    )


if __name__ == "__main__":
    asyncio.run(main())
