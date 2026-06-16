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
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings
from app.core.database import get_sessionmaker
from app.models.vehicle import Vehicle

logger = logging.getLogger(__name__)

VehicleType = Literal["master_l2", "master_l3", "master_l4", "man_solo"]

FLEET_TYPES: tuple[VehicleType, ...] = (
    "master_l2",
    "master_l3",
    "master_l4",
    "man_solo",
)

# ---------------------------------------------------------------------------
# ADR: Model LDM dla palet europejskich
# ---------------------------------------------------------------------------
# 1 paleta EUR = 1 slot = 0.4 LDM
# (standard operacyjny projektu: slot na pace ≈ 80×100 cm = 0.4 m bieżącego)
#
# Oferty generowane jako k × 0.4 LDM (k ≥ 1) — zawsze całkowita liczba palet.
# ---------------------------------------------------------------------------
PALLET_LDM = 0.4          # 1 paleta EUR = 1 slot = 0.4 LDM
LDM_PER_SLOT = PALLET_LDM  # 0.4 — jeden slot = jedna paleta
PALLET_DEPTH_CM = 80
SOLO_ROW_PITCH_CM = 80
SOLO_COL_PITCH_CM = 120
SOLO_COLS = 2

# Euro pallet footprints (cm) — cargo bed origin at front-left of load area.
P_W, P_D = 80.0, 120.0  # longitudinal (w × d)
P_W_T, P_D_T = 120.0, 80.0  # transverse (w × d)


class SlotConfig(BaseModel):
    id: str
    row: int
    col: int
    ldm_per_slot: float
    x_offset_cm: float
    y_offset_cm: float
    width_cm: float = P_W
    depth_cm: float = P_D


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


def _slot(
    slot_id: str,
    *,
    x: float,
    y: float,
    row: int,
    col: int,
    width_cm: float,
    depth_cm: float,
) -> SlotConfig:
    return SlotConfig(
        id=slot_id,
        row=row,
        col=col,
        ldm_per_slot=LDM_PER_SLOT,
        x_offset_cm=x,
        y_offset_cm=y,
        width_cm=width_cm,
        depth_cm=depth_cm,
    )


def _long(slot_id: str, x: float, y: float, row: int, col: int) -> SlotConfig:
    return _slot(slot_id, x=x, y=y, row=row, col=col, width_cm=P_W, depth_cm=P_D)


def _trans(slot_id: str, x: float, y: float, row: int, col: int) -> SlotConfig:
    return _slot(slot_id, x=x, y=y, row=row, col=col, width_cm=P_W_T, depth_cm=P_D_T)


def build_master_l2_slots() -> VehicleSlotMap:
    """8 EUR pallets — diagram: 3× longitudinal left, 5× transverse right."""
    slots = [
        _long("s0", 0, 0, 0, 0),
        _long("s1", 0, 120, 1, 0),
        _long("s2", 0, 240, 2, 0),
        _trans("s3", P_W, 0, 0, 1),
        _trans("s4", P_W, 80, 1, 1),
        _trans("s5", P_W, 160, 2, 1),
        _trans("s6", P_W, 240, 3, 1),
        _trans("s7", P_W, 320, 4, 1),
    ]
    return VehicleSlotMap(slots=slots, total_ldm=round(len(slots) * LDM_PER_SLOT, 2))


def build_master_l3_slots() -> VehicleSlotMap:
    """9 EUR pallets — non-overlapping L3 layout (440 cm bed).

    Left column transverse slots (s2, width 120 cm) extend to x=120,
    so right-column longitudinal slot s7 starts at x=120 to avoid overlap.
    """
    slots = [
        _long("s0", 0, 0, 0, 0),
        _long("s1", 0, 120, 1, 0),
        _trans("s2", 0, 240, 2, 0),
        _long("s3", 0, 320, 3, 0),
        _trans("s4", P_W, 0, 0, 1),
        _trans("s5", P_W, 80, 1, 1),
        _trans("s6", P_W, 160, 2, 1),
        _long("s7", P_W_T, 240, 3, 1),
        _trans("s8", P_W, 360, 4, 1),
    ]
    return VehicleSlotMap(slots=slots, total_ldm=round(len(slots) * LDM_PER_SLOT, 2))


def build_master_l4_slots() -> VehicleSlotMap:
    """10 EUR pallets — non-overlapping L4 layout (484 cm bed).

    Left column transverse slots (s2–s4, width 120 cm) extend to x=120,
    so right-column longitudinal slots s8/s9 start at x=120 to avoid overlap.
    """
    slots = [
        _long("s0", 0, 0, 0, 0),
        _long("s1", 0, 120, 1, 0),
        _trans("s2", 0, 240, 2, 0),
        _trans("s3", 0, 320, 3, 0),
        _trans("s4", 0, 400, 4, 0),
        _trans("s5", P_W, 0, 0, 1),
        _trans("s6", P_W, 80, 1, 1),
        _trans("s7", P_W, 160, 2, 1),
        _long("s8", P_W_T, 240, 3, 1),
        _long("s9", P_W_T, 360, 4, 1),
    ]
    return VehicleSlotMap(slots=slots, total_ldm=round(len(slots) * LDM_PER_SLOT, 2))


def build_solo_slots(trailer_length_cm: int) -> VehicleSlotMap:
    """MAN solówka: 2 columns (120 cm), rows every 80 cm; optional last single slot."""
    full_rows = trailer_length_cm // SOLO_ROW_PITCH_CM
    if full_rows < 1:
        msg = f"trailer_length_cm {trailer_length_cm} too short for man_solo slot layout"
        raise ValueError(msg)

    slots: list[SlotConfig] = []
    for row in range(full_rows):
        for col in range(SOLO_COLS):
            slots.append(
                _slot(
                    f"r{row}_c{col}",
                    x=col * SOLO_COL_PITCH_CM,
                    y=row * SOLO_ROW_PITCH_CM,
                    row=row,
                    col=col,
                    width_cm=SOLO_COL_PITCH_CM,
                    depth_cm=SOLO_ROW_PITCH_CM,
                ),
            )

    remainder = trailer_length_cm % SOLO_ROW_PITCH_CM
    if remainder >= PALLET_DEPTH_CM:
        last_row = full_rows
        slots.append(
            _slot(
                f"r{last_row}_c0",
                x=0.0,
                y=last_row * SOLO_ROW_PITCH_CM,
                row=last_row,
                col=0,
                width_cm=SOLO_COL_PITCH_CM,
                depth_cm=SOLO_ROW_PITCH_CM,
            ),
        )

    total_ldm = round(len(slots) * LDM_PER_SLOT, 2)
    return VehicleSlotMap(slots=slots, total_ldm=total_ldm)


def build_vehicle_seeds() -> list[VehicleSeed]:
    master_builders: dict[str, tuple[str, int, int, int, float, int, Any]] = {
        "master_l2": (
            "Renault Master L2",
            420,
            220,
            1500,
            18.5,
            6,
            build_master_l2_slots,
        ),
        "master_l3": (
            "Renault Master L3",
            440,
            220,
            1500,
            18.5,
            6,
            build_master_l3_slots,
        ),
        "master_l4": (
            "Renault Master L4",
            484,
            220,
            1500,
            19.0,
            6,
            build_master_l4_slots,
        ),
    }

    seeds: list[VehicleSeed] = []
    for vtype, (name, length, width, max_weight, fuel, max_stops, builder) in (
        master_builders.items()
    ):
        slot_map = builder()
        seeds.append(
            VehicleSeed(
                type=vtype,  # type: ignore[arg-type]
                name=name,
                trailer_length_cm=length,
                trailer_width_cm=width,
                max_ldm=slot_map.total_ldm,
                max_weight_kg=max_weight,
                fuel_per_100km_base=fuel,
                max_stops=max_stops,
                slot_map=slot_map,
            ),
        )

    solo_map = build_solo_slots(890)
    seeds.append(
        VehicleSeed(
            type="man_solo",
            name="MAN Solówka",
            trailer_length_cm=890,
            trailer_width_cm=245,
            max_ldm=solo_map.total_ldm,
            max_weight_kg=12000,
            fuel_per_100km_base=28.0,
            max_stops=10,
            slot_map=solo_map,
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

    master_l2 = next(s for s in seeds if s.type == "master_l2")
    master_l3 = next(s for s in seeds if s.type == "master_l3")
    master_l4 = next(s for s in seeds if s.type == "master_l4")
    man_solo = next(s for s in seeds if s.type == "man_solo")
    logger.info(
        "master_l2: %d slots, LDM %.2f",
        len(master_l2.slot_map.slots),
        master_l2.slot_map.total_ldm,
    )
    logger.info(
        "master_l3: %d slots, LDM %.2f",
        len(master_l3.slot_map.slots),
        master_l3.slot_map.total_ldm,
    )
    logger.info(
        "master_l4: %d slots, LDM %.2f",
        len(master_l4.slot_map.slots),
        master_l4.slot_map.total_ldm,
    )
    logger.info(
        "man_solo: %d slots, LDM %.2f",
        len(man_solo.slot_map.slots),
        man_solo.slot_map.total_ldm,
    )

    session_factory = get_sessionmaker()
    async with session_factory() as session:
        await session.execute(
            delete(Vehicle).where(Vehicle.type.not_in(FLEET_TYPES)),
        )

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
