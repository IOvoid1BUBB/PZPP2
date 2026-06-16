#!/usr/bin/env python3
"""Seed default fleet vehicles — one per vehicle_type (idempotent).

Uruchomienie z backend/::

    python scripts/seed_fleet_vehicles.py

Dodaje jeden FleetVehicle na każdy VehicleType jeśli tabela jest pusta.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.database import get_sessionmaker
from app.models.fleet_vehicle import FleetVehicle
from app.models.vehicle import Vehicle

logger = logging.getLogger(__name__)

# Home: Warsaw
HOME_LAT = 52.2297
HOME_LON = 21.0122

# Default registrations per vehicle type
TYPE_TO_REG: dict[str, str] = {
    "man_solo": "PL-MAN-01",
    "master_l2": "PL-RL2-01",
    "master_l3": "PL-RL3-01",
    "master_l4": "PL-RL4-01",
}


def _ensure_env() -> None:
    repo_root = BACKEND_ROOT.parent
    for directory in (repo_root, BACKEND_ROOT):
        env_file = directory / ".env"
        if env_file.is_file():
            os.chdir(directory)
            get_settings.cache_clear()
            return


async def seed_fleet_vehicles() -> dict[str, int]:
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        existing_count = int(
            await session.scalar(select(func.count()).select_from(FleetVehicle)) or 0
        )
        if existing_count > 0:
            logger.info("fleet_vehicles: already %d rows, skip", existing_count)
            return {"existing": existing_count, "inserted": 0}

        # Load vehicle types
        result = await session.execute(select(Vehicle))
        vehicle_types = list(result.scalars().all())

        inserted = 0
        for vt in vehicle_types:
            reg = TYPE_TO_REG.get(vt.type, f"PL-{vt.type[:6].upper()}-01")
            fv = FleetVehicle(
                type_id=vt.id,
                registration=reg,
                display_name=vt.name,
                status="idle",
                home_lat=HOME_LAT,
                home_lon=HOME_LON,
            )
            session.add(fv)
            inserted += 1

        await session.commit()
        logger.info("fleet_vehicles: inserted %d default vehicles", inserted)
        return {"existing": 0, "inserted": inserted}


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    _ensure_env()
    get_settings()

    try:
        result = await seed_fleet_vehicles()
    except Exception:
        logger.exception("Fleet vehicles seed failed")
        raise SystemExit(1) from None

    print(
        f"Seed fleet_vehicles: existing={result['existing']}, inserted={result['inserted']}"
    )


if __name__ == "__main__":
    asyncio.run(main())
