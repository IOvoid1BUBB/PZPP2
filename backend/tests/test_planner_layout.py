"""Tests for planner layout service helpers."""

from __future__ import annotations

from app.schemas.planner import PalletData, PalletDims, PayloadSlotConfig, PlannerVehicle
from app.services.planner_layout import (
    build_demo_slots,
    can_assign,
    detect_conflicts,
    empty_slots,
)


def _vehicle() -> PlannerVehicle:
    payload_slots = {
        "r0_c0": PayloadSlotConfig(row=0, col=0, ldmPerSlot=0.8, xOffsetCm=0, yOffsetCm=0),
        "r0_c1": PayloadSlotConfig(row=0, col=1, ldmPerSlot=0.8, xOffsetCm=80, yOffsetCm=0),
        "r1_c0": PayloadSlotConfig(row=1, col=0, ldmPerSlot=0.8, xOffsetCm=0, yOffsetCm=120),
        "r1_c1": PayloadSlotConfig(row=1, col=1, ldmPerSlot=0.8, xOffsetCm=80, yOffsetCm=120),
    }
    return PlannerVehicle(
        id="demo",
        name="Bus 8m",
        type="bus_8",
        maxLdm=13.6,
        maxWeightKg=6000,
        trailerLengthCm=820,
        trailerWidthCm=240,
        payloadSlots=payload_slots,
    )


def _pallet(
    pallet_id: str,
    *,
    stackable: bool = True,
    weight_kg: int = 400,
) -> PalletData:
    return PalletData(
        id=pallet_id,
        offerId=f"o-{pallet_id}",
        clientId=f"c-{pallet_id}",
        clientName=f"Client {pallet_id}",
        clientColor="#2563eb",
        ldm=0.8,
        weightKg=weight_kg,
        dims=PalletDims(wMm=800, dMm=1200, hMm=1600),
        stackable=stackable,
    )


def test_detect_conflicts_stacking_violation() -> None:
    vehicle = _vehicle()
    slots = empty_slots(vehicle.payload_slots)
    slots["r0_c0"] = _pallet("bottom", stackable=False)
    slots["r1_c0"] = _pallet("top", stackable=True)

    conflicts = detect_conflicts(slots, vehicle)
    assert any(conflict.type == "stacking_violation" for conflict in conflicts)


def test_can_assign_respects_capacity() -> None:
    vehicle = _vehicle()
    slots = empty_slots(vehicle.payload_slots)
    pallet = _pallet("heavy", weight_kg=7000)

    assert can_assign(slots, vehicle, pallet, "r0_c0") is False


def test_build_demo_slots_populates_known_ids() -> None:
    vehicle = _vehicle()
    slots = build_demo_slots(vehicle.payload_slots)
    assert slots["r0_c0"] is not None
    assert slots["r0_c1"] is not None
