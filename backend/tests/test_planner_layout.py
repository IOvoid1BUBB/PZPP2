"""Tests for planner layout service helpers."""

from __future__ import annotations

from app.schemas.planner import PalletData, PalletDims, PayloadSlotConfig, PlannerVehicle
from app.services.planner_layout import (
    can_assign,
    detect_conflicts,
    empty_slots,
    find_first_assignable_slot,
)


def _vehicle() -> PlannerVehicle:
    payload_slots = {
        "r0_c0": PayloadSlotConfig(row=0, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=0),
        "r0_c1": PayloadSlotConfig(row=0, col=1, ldmPerSlot=0.4, xOffsetCm=80, yOffsetCm=0),
        "r1_c0": PayloadSlotConfig(row=1, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=120),
        "r1_c1": PayloadSlotConfig(row=1, col=1, ldmPerSlot=0.4, xOffsetCm=80, yOffsetCm=120),
    }
    return PlannerVehicle(
        id="demo",
        name="Renault Master L2",
        type="master_l2",
        maxLdm=1.6,   # 4 sloty × 0.4 LDM = 4 palety
        maxWeightKg=3500,
        trailerLengthCm=420,
        trailerWidthCm=220,
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
        ldm=0.4,  # jeden slot = jedna paleta EUR (PALLET_LDM = 0.4)
        weightKg=weight_kg,
        dims=PalletDims(wMm=800, dMm=1200, hMm=1600),
        stackable=stackable,
    )


def test_detect_conflicts_no_stacking_for_adjacent_lane_slots() -> None:
    """Slots in the same column but sequential along the bed are not a vertical stack."""
    vehicle = _vehicle()
    slots = empty_slots(vehicle.payload_slots)
    slots["r0_c0"] = _pallet("bottom", stackable=False)
    slots["r1_c0"] = _pallet("top", stackable=True)

    conflicts = detect_conflicts(slots, vehicle)
    assert not any(conflict.type == "stacking_violation" for conflict in conflicts)


def test_detect_conflicts_stacking_violation_on_overlapping_footprints() -> None:
    payload_slots = {
        "base": PayloadSlotConfig(
            row=0, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=0, widthCm=80, depthCm=120,
        ),
        "top": PayloadSlotConfig(
            row=0, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=0, widthCm=80, depthCm=120,
        ),
    }
    vehicle = PlannerVehicle(
        id="demo",
        name="Stack test",
        type="master_l2",
        maxLdm=1.6,
        maxWeightKg=3500,
        trailerLengthCm=420,
        trailerWidthCm=220,
        payloadSlots=payload_slots,
    )
    slots = empty_slots(payload_slots)
    slots["base"] = _pallet("bottom", stackable=False)
    slots["top"] = _pallet("upper", stackable=True)

    conflicts = detect_conflicts(slots, vehicle)
    assert any(conflict.type == "stacking_violation" for conflict in conflicts)


def test_can_assign_respects_capacity() -> None:
    vehicle = _vehicle()
    slots = empty_slots(vehicle.payload_slots)
    pallet = _pallet("heavy", weight_kg=7000)

    assert can_assign(slots, vehicle, pallet, "r0_c0") is False




def test_can_assign_rejects_overlapping_target() -> None:
    """Two slots at the same physical position block assignment."""
    payload_slots = {
        "base": PayloadSlotConfig(
            row=0, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=0, widthCm=80, depthCm=120,
        ),
        "stacked": PayloadSlotConfig(
            row=0, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=0, widthCm=80, depthCm=120,
        ),
    }
    vehicle = PlannerVehicle(
        id="overlap",
        name="Overlap test",
        type="master_l2",
        maxLdm=1.6,
        maxWeightKg=3500,
        trailerLengthCm=420,
        trailerWidthCm=220,
        payloadSlots=payload_slots,
    )
    slots = empty_slots(payload_slots)
    slots["base"] = _pallet("bottom")
    assert can_assign(slots, vehicle, _pallet("top"), "stacked") is False


def _master_l4_payload_slots() -> dict[str, PayloadSlotConfig]:
    return {
        "s0": PayloadSlotConfig(
            row=0, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=0, widthCm=80, depthCm=120,
        ),
        "s1": PayloadSlotConfig(
            row=1, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=120, widthCm=80, depthCm=120,
        ),
        "s2": PayloadSlotConfig(
            row=2, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=240, widthCm=120, depthCm=80,
        ),
        "s3": PayloadSlotConfig(
            row=3, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=320, widthCm=120, depthCm=80,
        ),
        "s4": PayloadSlotConfig(
            row=4, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=400, widthCm=120, depthCm=80,
        ),
        "s5": PayloadSlotConfig(
            row=0, col=1, ldmPerSlot=0.4, xOffsetCm=80, yOffsetCm=0, widthCm=120, depthCm=80,
        ),
        "s6": PayloadSlotConfig(
            row=1, col=1, ldmPerSlot=0.4, xOffsetCm=80, yOffsetCm=80, widthCm=120, depthCm=80,
        ),
        "s7": PayloadSlotConfig(
            row=2, col=1, ldmPerSlot=0.4, xOffsetCm=80, yOffsetCm=160, widthCm=120, depthCm=80,
        ),
        "s8": PayloadSlotConfig(
            row=3, col=1, ldmPerSlot=0.4, xOffsetCm=120, yOffsetCm=240, widthCm=80, depthCm=120,
        ),
        "s9": PayloadSlotConfig(
            row=4, col=1, ldmPerSlot=0.4, xOffsetCm=120, yOffsetCm=360, widthCm=80, depthCm=120,
        ),
    }


def test_can_assign_allows_adjacent_non_overlapping_l4_slots() -> None:
    """L4 s3 and s8 no longer overlap after geometry fix — assignment should succeed."""
    payload_slots = _master_l4_payload_slots()
    vehicle = PlannerVehicle(
        id="l4",
        name="Renault Master L4",
        type="master_l4",
        maxLdm=4.0,
        maxWeightKg=3800,
        trailerLengthCm=484,
        trailerWidthCm=220,
        payloadSlots=payload_slots,
    )
    slots = empty_slots(payload_slots)
    slots["s3"] = _pallet("rear-left")
    assert can_assign(slots, vehicle, _pallet("rear-right"), "s8") is True


def test_can_assign_allows_rotation_between_long_and_trans() -> None:
    payload_slots = {
        "long": PayloadSlotConfig(
            row=0, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=0, widthCm=80, depthCm=120,
        ),
        "trans": PayloadSlotConfig(
            row=0, col=1, ldmPerSlot=0.4, xOffsetCm=80, yOffsetCm=0, widthCm=120, depthCm=80,
        ),
    }
    vehicle = PlannerVehicle(
        id="orient",
        name="Orientation test",
        type="master_l2",
        maxLdm=1.6,
        maxWeightKg=3500,
        trailerLengthCm=420,
        trailerWidthCm=220,
        payloadSlots=payload_slots,
    )
    slots = empty_slots(payload_slots)
    long_pallet = _pallet("long")
    trans_pallet = PalletData(
        id="trans",
        offerId="o-trans",
        clientId="c-trans",
        clientName="Trans",
        clientColor="#2563eb",
        ldm=0.8,
        weightKg=400,
        dims=PalletDims(wMm=1200, dMm=800, hMm=1600),
        stackable=True,
    )

    assert can_assign(slots, vehicle, long_pallet, "trans") is True
    assert can_assign(slots, vehicle, trans_pallet, "long") is True


def test_orient_pallet_for_slot_aligns_to_slot() -> None:
    from app.services.planner_layout import _orient_pallet_for_slot

    pallet = PalletData(
        id="trans",
        offerId="o-trans",
        clientId="c-trans",
        clientName="Delta",
        clientColor="#2563eb",
        ldm=0.8,
        weightKg=540,
        dims=PalletDims(wMm=1200, dMm=800, hMm=1600),
        stackable=True,
    )
    long_slot = PayloadSlotConfig(
        row=2, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=240, widthCm=80, depthCm=120,
    )
    oriented = _orient_pallet_for_slot(pallet, long_slot)
    assert oriented.dims.w_mm == 800
    assert oriented.dims.d_mm == 1200


def test_can_assign_rejects_oversized_pallet() -> None:
    payload_slots = {
        "long": PayloadSlotConfig(
            row=0, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=0, widthCm=80, depthCm=120,
        ),
    }
    vehicle = PlannerVehicle(
        id="oversize",
        name="Oversize test",
        type="master_l2",
        maxLdm=1.6,
        maxWeightKg=3500,
        trailerLengthCm=420,
        trailerWidthCm=220,
        payloadSlots=payload_slots,
    )
    slots = empty_slots(payload_slots)
    oversized = PalletData(
        id="big",
        offerId="o-big",
        clientId="c-big",
        clientName="Big",
        clientColor="#2563eb",
        ldm=0.8,
        weightKg=400,
        dims=PalletDims(wMm=1500, dMm=1500, hMm=1600),
        stackable=True,
    )

    assert can_assign(slots, vehicle, oversized, "long") is False


def test_find_first_assignable_slot_skips_footprint_overlap() -> None:
    """With stacked slots at the same position, occupied bottom blocks the top."""
    payload_slots = {
        "s0": PayloadSlotConfig(
            row=0, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=0, widthCm=80, depthCm=120,
        ),
        "s1": PayloadSlotConfig(
            row=1, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=120, widthCm=80, depthCm=120,
        ),
        "overlap_s1": PayloadSlotConfig(
            row=1, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=120, widthCm=80, depthCm=120,
        ),
        "s2": PayloadSlotConfig(
            row=2, col=0, ldmPerSlot=0.4, xOffsetCm=0, yOffsetCm=240, widthCm=120, depthCm=80,
        ),
    }
    vehicle = PlannerVehicle(
        id="l3-like",
        name="Master L3-like",
        type="master_l3",
        maxLdm=3.6,
        maxWeightKg=3600,
        trailerLengthCm=440,
        trailerWidthCm=220,
        payloadSlots=payload_slots,
    )
    slots = empty_slots(payload_slots)
    slots["s0"] = _pallet("ikea")
    slots["s1"] = _pallet("amazon")
    long_pallet = _pallet("amazon")

    target = find_first_assignable_slot(slots, vehicle, long_pallet, "s1")
    assert target == "s2"
