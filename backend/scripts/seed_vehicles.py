#!/usr/bin/env python3
"""Seed the vehicle catalog with geometry, transport limits, and pallet slot maps.

Idempotent: upserts by ``type`` so repeated runs keep exactly four rows.

Run from ``backend/``::

    python scripts/seed_vehicles.py
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings
from app.core.database import get_sessionmaker
from app.models.vehicle import Vehicle

logger = logging.getLogger(__name__)

VehicleType = Literal["bus_8", "bus_9", "bus_10", "solo"]

LDM_PER_SLOT = 0.8
PALLET_DEPTH_CM = 80
BUS_ROW_PITCH_CM = 120
BUS_COL_PITCH_CM = 80
BUS_COLS = 4
BUS_CAB_OFFSET_CM = 580
SOLO_ROW_PITCH_CM = 80
SOLO_COL_PITCH_CM = 120
SOLO_COLS = 2
SOLO_FULL_ROWS = 16


class SlotConfig(BaseModel):
    id: str
    row: int
    col: int
    ldm_per_slot: float
    x_offset_cm: float
    y_offset_cm: float


class VehicleSlotMap(BaseModel):
    slots: list[SlotConfig]
    total_ldm: float

    @model_validator(mode="after")
    def validate_ldm(self) -> VehicleSlotMap:
        slot_sum = sum(slot.ldm_per_slot for slot in self.slots)
        if abs(slot_sum - self.total_ldm) >= 0.01:
            msg = f"total_ldm {self.total_ldm} != sum(ldm_per_slot) {slot_sum}"
            raise ValueError(msg)
        return self


@dataclass(frozen=True, slots=True)
class VehicleSeed:
    type: VehicleType
    name: str
    trailer_length_cm: int
    trailer_width_cm: int
    max_ldm: float
    max_weight_kg: int
    fuel_per_100km_base: float
    max_stops: int
    slot_map: VehicleSlotMap

    @property
    def payload_slots(self) -> dict[str, Any]:
        return self.slot_map.model_dump()


def _bus_row_count(trailer_length_cm: int) -> int:
    usable = trailer_length_cm - BUS_CAB_OFFSET_CM
    return max(1, usable // BUS_ROW_PITCH_CM)


def build_bus_slots(trailer_length_cm: int) -> VehicleSlotMap:
    """Bus layout: 4 columns (80 cm pitch), rows from usable trailer length."""
    rows = _bus_row_count(trailer_length_cm)
    slots: list[SlotConfig] = []
    for row in range(rows):
        for col in range(BUS_COLS):
            slots.append(
                SlotConfig(
                    id=f"r{row}_c{col}",
                    row=row,
                    col=col,
                    ldm_per_slot=LDM_PER_SLOT,
                    x_offset_cm=col * BUS_COL_PITCH_CM,
                    y_offset_cm=row * BUS_ROW_PITCH_CM,
                ),
            )
    total_ldm = round(len(slots) * LDM_PER_SLOT, 2)
    return VehicleSlotMap(slots=slots, total_ldm=total_ldm)


def build_solo_slots(trailer_length_cm: int) -> VehicleSlotMap:
    """Solo: 2 columns (120 cm), 16 full rows + 1 single slot (33 LDM slots total)."""
    if trailer_length_cm < SOLO_FULL_ROWS * SOLO_ROW_PITCH_CM + PALLET_DEPTH_CM:
        msg = f"trailer_length_cm {trailer_length_cm} too short for solo slot layout"
        raise ValueError(msg)

    slots: list[SlotConfig] = []
    for row in range(SOLO_FULL_ROWS):
        for col in range(SOLO_COLS):
            slots.append(
                SlotConfig(
                    id=f"r{row}_c{col}",
                    row=row,
                    col=col,
                    ldm_per_slot=LDM_PER_SLOT,
                    x_offset_cm=col * SOLO_COL_PITCH_CM,
                    y_offset_cm=row * SOLO_ROW_PITCH_CM,
                ),
            )

    last_row = SOLO_FULL_ROWS
    slots.append(
        SlotConfig(
            id=f"r{last_row}_c0",
            row=last_row,
            col=0,
            ldm_per_slot=LDM_PER_SLOT,
            x_offset_cm=0.0,
            y_offset_cm=last_row * SOLO_ROW_PITCH_CM,
        ),
    )

    total_ldm = round(len(slots) * LDM_PER_SLOT, 2)
    return VehicleSlotMap(slots=slots, total_ldm=total_ldm)


def build_vehicle_seeds() -> list[VehicleSeed]:
    specs: list[tuple[VehicleType, str, int, int, float, int, float, int]] = [
        ("bus_8", "Bus 8m", 820, 240, 13.6, 6000, 18.5, 6),
        ("bus_9", "Bus 9m", 920, 240, 13.6, 7000, 19.0, 6),
        ("bus_10", "Bus 10m", 1020, 240, 13.6, 8000, 19.5, 6),
        ("solo", "Solo zestaw", 1360, 240, 33.0, 24000, 28.0, 10),
    ]

    seeds: list[VehicleSeed] = []
    for vtype, name, length, width, max_ldm, max_weight, fuel, max_stops in specs:
        if vtype == "solo":
            slot_map = build_solo_slots(length)
        else:
            slot_map = build_bus_slots(length)

        seeds.append(
            VehicleSeed(
                type=vtype,
                name=name,
                trailer_length_cm=length,
                trailer_width_cm=width,
                max_ldm=max_ldm,
                max_weight_kg=max_weight,
                fuel_per_100km_base=fuel,
                max_stops=max_stops,
                slot_map=slot_map,
            ),
        )
    return seeds


def _ensure_env() -> None:
    repo_root = BACKEND_ROOT.parent
    for directory in (repo_root, BACKEND_ROOT):
        env_file = directory / ".env"
        if env_file.is_file():
            os.chdir(directory)
            get_settings.cache_clear()
            return


async def upsert_vehicle(session: AsyncSession, seed: VehicleSeed) -> None:
    result = await session.execute(select(Vehicle).where(Vehicle.type == seed.type))
    vehicle = result.scalar_one_or_none()

    if vehicle is None:
        vehicle = Vehicle(
            name=seed.name,
            type=seed.type,
            max_ldm=seed.max_ldm,
            max_weight_kg=seed.max_weight_kg,
            trailer_length_cm=seed.trailer_length_cm,
            trailer_width_cm=seed.trailer_width_cm,
            fuel_per_100km_base=seed.fuel_per_100km_base,
            max_stops=seed.max_stops,
            payload_slots=seed.payload_slots,
        )
        session.add(vehicle)
        return

    vehicle.name = seed.name
    vehicle.max_ldm = seed.max_ldm
    vehicle.max_weight_kg = seed.max_weight_kg
    vehicle.trailer_length_cm = seed.trailer_length_cm
    vehicle.trailer_width_cm = seed.trailer_width_cm
    vehicle.fuel_per_100km_base = seed.fuel_per_100km_base
    vehicle.max_stops = seed.max_stops
    vehicle.payload_slots = seed.payload_slots


async def seed_vehicles() -> int:
    seeds = build_vehicle_seeds()

    bus_8 = next(s for s in seeds if s.type == "bus_8")
    solo = next(s for s in seeds if s.type == "solo")
    logger.info(
        "bus_8 slot LDM sum: %.2f (expected 6.4)",
        bus_8.slot_map.total_ldm,
    )
    logger.info(
        "solo slot LDM sum: %.2f (expected 26.4)",
        solo.slot_map.total_ldm,
    )

    session_factory = get_sessionmaker()
    async with session_factory() as session:
        for seed in seeds:
            VehicleSlotMap.model_validate(seed.payload_slots)
            await upsert_vehicle(session, seed)

        await session.commit()

        count = await session.scalar(select(func.count()).select_from(Vehicle))
        if count is None:
            count = 0

    return int(count)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    _ensure_env()
    get_settings()

    try:
        total = await seed_vehicles()
    except Exception:
        logger.exception("Vehicle seed failed")
        raise SystemExit(1) from None

    logger.info("Seeded vehicles; row count in vehicles table: %d", total)
    if total != 4:
        logger.error("Expected 4 vehicles, found %d", total)
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
