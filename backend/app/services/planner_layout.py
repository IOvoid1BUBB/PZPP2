"""Load layout service backing the SlotEditor frontend."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError, ValidationAppError
from app.models import ConsolidationSession, Vehicle
from app.schemas.planner import (
    LoadLayoutResponse,
    LoadLayoutUpdate,
    PalletData,
    PalletDims,
    PayloadSlotConfig,
    PlannerVehicle,
    SlotConflict,
)

CLIENT_COLORS = [
    "#93c5fd",  # IKEA blue
    "#fde047",  # Amazon yellow
    "#86efac",
    "#c4b5fd",
    "#fca5a5",
    "#67e8f9",
    "#f9a8d4",
    "#a5b4fc",
    "#bef264",
    "#fdba74",
    "#5eead4",
    "#d8b4fe",
]

DEMO_VEHICLE_TYPE = "master_l2"

_demo_layout_cache: dict[str, PalletData | None] | None = None


def _normalize_payload_slots(raw: dict[str, Any]) -> dict[str, PayloadSlotConfig]:
    slots: dict[str, PayloadSlotConfig] = {}
    if "slots" in raw:
        for entry in raw["slots"]:
            slot_id = entry["id"]
            slots[slot_id] = PayloadSlotConfig(
                row=entry["row"],
                col=entry["col"],
                ldmPerSlot=float(entry["ldm_per_slot"]),
                xOffsetCm=float(entry["x_offset_cm"]),
                yOffsetCm=float(entry["y_offset_cm"]),
                widthCm=float(entry.get("width_cm", entry.get("widthCm", 80))),
                depthCm=float(entry.get("depth_cm", entry.get("depthCm", 120))),
            )
        return slots

    for slot_id, entry in raw.items():
        if not isinstance(entry, dict):
            continue
        slots[slot_id] = PayloadSlotConfig(
            row=int(entry["row"]),
            col=int(entry["col"]),
            ldmPerSlot=float(entry.get("ldm_per_slot", entry.get("ldmPerSlot", 0.8))),
            xOffsetCm=float(entry.get("x_offset_cm", entry.get("xOffsetCm", 0))),
            yOffsetCm=float(entry.get("y_offset_cm", entry.get("yOffsetCm", 0))),
            widthCm=float(entry.get("width_cm", entry.get("widthCm", 80))),
            depthCm=float(entry.get("depth_cm", entry.get("depthCm", 120))),
        )
    return slots


def vehicle_to_planner(vehicle: Vehicle) -> PlannerVehicle:
    return PlannerVehicle(
        id=str(vehicle.id),
        name=vehicle.name,
        type=vehicle.type,  # type: ignore[arg-type]
        maxLdm=float(vehicle.max_ldm),
        maxWeightKg=int(vehicle.max_weight_kg),
        trailerLengthCm=int(vehicle.trailer_length_cm),
        trailerWidthCm=int(vehicle.trailer_width_cm),
        payloadSlots=_normalize_payload_slots(vehicle.payload_slots),
    )


def empty_slots(payload_slots: dict[str, PayloadSlotConfig]) -> dict[str, PalletData | None]:
    return {slot_id: None for slot_id in payload_slots}


def _pallet_dict_to_model(data: dict[str, Any]) -> PalletData:
    dims = data.get("dims", {})
    time_window = data.get("time_window") or data.get("timeWindow")
    tw = None
    if time_window:
        tw = {
            "open": time_window["open"],
            "close": time_window["close"],
        }

    return PalletData.model_validate(
        {
            "id": data["id"],
            "offerId": data.get("offer_id") or data.get("offerId"),
            "clientId": data.get("client_id") or data.get("clientId"),
            "clientName": data.get("client_name") or data.get("clientName"),
            "clientColor": data.get("client_color") or data.get("clientColor"),
            "ldm": float(data["ldm"]),
            "weightKg": int(data.get("weight_kg") or data.get("weightKg")),
            "dims": {
                "wMm": dims.get("w_mm") or dims.get("wMm"),
                "dMm": dims.get("d_mm") or dims.get("dMm"),
                "hMm": dims.get("h_mm") or dims.get("hMm"),
            },
            "stackable": bool(data.get("stackable", True)),
            "timeWindow": tw,
        },
    )


def slots_from_storage(
    stored: dict[str, Any] | None,
    payload_slots: dict[str, PayloadSlotConfig],
) -> dict[str, PalletData | None]:
    slots = empty_slots(payload_slots)
    if not stored:
        return slots

    for slot_id, value in stored.items():
        if slot_id not in slots:
            continue
        if value is None:
            slots[slot_id] = None
        else:
            slots[slot_id] = _pallet_dict_to_model(value)
    return slots


def slots_to_storage(slots: dict[str, PalletData | None]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for slot_id, pallet in slots.items():
        if pallet is None:
            result[slot_id] = None
        else:
            result[slot_id] = pallet.model_dump(by_alias=True, mode="json")
    return result


def build_demo_slots(payload_slots: dict[str, PayloadSlotConfig]) -> dict[str, PalletData | None]:
    slots = empty_slots(payload_slots)
    now = datetime.now(timezone.utc)

    def pallet(
        slot_id: str,
        pallet_id: str,
        offer_id: str,
        client_id: str,
        client_name: str,
        color_index: int,
        ldm: float,
        weight_kg: int,
        stackable: bool,
        time_window: dict[str, datetime] | None = None,
    ) -> None:
        if slot_id not in payload_slots:
            return
        slot_cfg = payload_slots[slot_id]
        slots[slot_id] = PalletData(
            id=pallet_id,
            offerId=offer_id,
            clientId=client_id,
            clientName=client_name,
            clientColor=CLIENT_COLORS[color_index % len(CLIENT_COLORS)],
            ldm=ldm,
            weightKg=weight_kg,
            dims=PalletDims(
                wMm=int(slot_cfg.width_cm * 10),
                dMm=int(slot_cfg.depth_cm * 10),
                hMm=1600,
            ),
            stackable=stackable,
            timeWindow=time_window,
        )

    # Demo fill for master_l2 diagram layout (slot ids s0–s7)
    pallet("s0", "p1", "o1", "c1", "IKEA", 0, 0.8, 420, True)
    pallet("s1", "p2", "o2", "c2", "Amazon", 1, 0.8, 680, False)
    pallet("s3", "p4", "o4", "c3", "Gamma", 2, 0.8, 910, True)
    pallet(
        "s4",
        "p5",
        "o5",
        "c4",
        "Delta",
        3,
        0.8,
        540,
        True,
        time_window={
            "open": now - timedelta(days=1),
            "close": now - timedelta(hours=1),
        },
    )
    return slots


def get_used_ldm(slots: dict[str, PalletData | None]) -> float:
    return sum(pallet.ldm for pallet in slots.values() if pallet is not None)


def get_used_weight(slots: dict[str, PalletData | None]) -> int:
    return sum(pallet.weight_kg for pallet in slots.values() if pallet is not None)


def can_assign(
    slots: dict[str, PalletData | None],
    vehicle: PlannerVehicle,
    pallet: PalletData,
    target_slot_id: str,
    source_slot_id: str | None = None,
) -> bool:
    if target_slot_id not in vehicle.payload_slots:
        return False
    if slots.get(target_slot_id) is not None:
        return False

    used_ldm = get_used_ldm(slots)
    used_weight = get_used_weight(slots)
    if source_slot_id and slots.get(source_slot_id):
        used_ldm -= slots[source_slot_id].ldm  # type: ignore[union-attr]
        used_weight -= slots[source_slot_id].weight_kg  # type: ignore[union-attr]

    return (
        used_ldm + pallet.ldm <= vehicle.max_ldm
        and used_weight + pallet.weight_kg <= vehicle.max_weight_kg
    )


def can_swap(
    slots: dict[str, PalletData | None],
    vehicle: PlannerVehicle,
    slot_a: str,
    slot_b: str,
) -> bool:
    pallet_a = slots.get(slot_a)
    pallet_b = slots.get(slot_b)
    if pallet_a is None or pallet_b is None:
        return False

    used_ldm = get_used_ldm(slots)
    used_weight = get_used_weight(slots)
    return used_ldm <= vehicle.max_ldm and used_weight <= vehicle.max_weight_kg


def detect_conflicts(
    slots: dict[str, PalletData | None],
    vehicle: PlannerVehicle,
) -> list[SlotConflict]:
    conflicts: list[SlotConflict] = []
    slot_entries = list(vehicle.payload_slots.items())
    cols = {config.col for _, config in slot_entries}

    for col in cols:
        column_slots = sorted(
            [(slot_id, config) for slot_id, config in slot_entries if config.col == col],
            key=lambda item: item[1].row,
        )
        for index, (slot_id, config) in enumerate(column_slots):
            pallet = slots.get(slot_id)
            if pallet is None:
                continue

            upper = column_slots[:index]
            has_non_stackable_below = any(
                slots.get(upper_id) is not None and not slots[upper_id].stackable  # type: ignore[union-attr]
                for upper_id, _ in upper
            )
            if has_non_stackable_below:
                conflicts.append(
                    SlotConflict(
                        type="stacking_violation",
                        affectedSlotIds=[slot_id],
                        message=(
                            f"Paleta {pallet.client_name} jest ustawiona nad "
                            f"niestackowalnym ładunkiem (kolumna {col}, wiersz {config.row})."
                        ),
                    ),
                )

    used_weight = get_used_weight(slots)
    if used_weight > vehicle.max_weight_kg:
        conflicts.append(
            SlotConflict(
                type="weight_overload",
                affectedSlotIds=[slot_id for slot_id, p in slots.items() if p is not None],
                message=(
                    f"Przekroczono dopuszczalny tonaż "
                    f"({used_weight} kg / {vehicle.max_weight_kg} kg)."
                ),
            ),
        )

    now = datetime.now(timezone.utc)
    for slot_id, pallet in slots.items():
        if pallet is None or pallet.time_window is None:
            continue
        if now < pallet.time_window.open or now > pallet.time_window.close:
            conflicts.append(
                SlotConflict(
                    type="time_window_breach",
                    affectedSlotIds=[slot_id],
                    message=f"Okno czasowe klienta {pallet.client_name} jest przekroczone.",
                ),
            )

    return conflicts


def build_layout_response(
    vehicle: PlannerVehicle,
    slots: dict[str, PalletData | None],
    session_id: str | None = None,
) -> LoadLayoutResponse:
    return LoadLayoutResponse(
        sessionId=session_id,
        vehicle=vehicle,
        slots=slots,
        conflicts=detect_conflicts(slots, vehicle),
    )


class PlannerLayoutService:
    """Read/write trailer slot assignments for the visual planner."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def _get_vehicle_by_type(self, vehicle_type: str) -> Vehicle:
        result = await self._db.execute(select(Vehicle).where(Vehicle.type == vehicle_type))
        vehicle = result.scalar_one_or_none()
        if vehicle is None:
            raise NotFoundError(
                f"Vehicle type '{vehicle_type}' not found. Run scripts/seed_vehicles.py first.",
            )
        return vehicle

    async def get_demo_layout(self) -> LoadLayoutResponse:
        global _demo_layout_cache
        vehicle = await self._get_vehicle_by_type(DEMO_VEHICLE_TYPE)
        planner_vehicle = vehicle_to_planner(vehicle)
        if _demo_layout_cache is None:
            _demo_layout_cache = build_demo_slots(planner_vehicle.payload_slots)
        return build_layout_response(planner_vehicle, _demo_layout_cache, session_id="demo")

    async def update_demo_layout(self, payload: LoadLayoutUpdate) -> LoadLayoutResponse:
        global _demo_layout_cache
        vehicle = await self._get_vehicle_by_type(DEMO_VEHICLE_TYPE)
        planner_vehicle = vehicle_to_planner(vehicle)
        self._validate_slot_keys(payload.slots, planner_vehicle)
        _demo_layout_cache = dict(payload.slots)
        return build_layout_response(planner_vehicle, _demo_layout_cache, session_id="demo")

    async def get_session_layout(self, session_id: UUID) -> LoadLayoutResponse:
        session = await self._load_session(session_id)
        if session.vehicle is None:
            raise ValidationAppError("Session has no vehicle assigned.")

        planner_vehicle = vehicle_to_planner(session.vehicle)
        stored = session.load_layout if isinstance(session.load_layout, dict) else None
        slots = slots_from_storage(stored, planner_vehicle.payload_slots)

        if stored is None:
            slots = build_demo_slots(planner_vehicle.payload_slots)
            session.load_layout = slots_to_storage(slots)
            await self._db.flush()

        return build_layout_response(planner_vehicle, slots, session_id=str(session.id))

    async def update_session_layout(
        self,
        session_id: UUID,
        payload: LoadLayoutUpdate,
    ) -> LoadLayoutResponse:
        session = await self._load_session(session_id)
        if session.vehicle is None:
            raise ValidationAppError("Session has no vehicle assigned.")

        planner_vehicle = vehicle_to_planner(session.vehicle)
        self._validate_slot_keys(payload.slots, planner_vehicle)
        session.load_layout = slots_to_storage(payload.slots)
        await self._db.flush()
        return build_layout_response(planner_vehicle, payload.slots, session_id=str(session.id))

    async def apply_move(
        self,
        session_id: UUID | None,
        *,
        from_slot: str,
        to_slot: str,
        demo: bool = False,
    ) -> LoadLayoutResponse:
        layout = (
            await self.get_demo_layout()
            if demo
            else await self.get_session_layout(session_id)  # type: ignore[arg-type]
        )
        slots = dict(layout.slots)
        source = slots.get(from_slot)
        if source is None:
            raise ValidationAppError(f"Source slot '{from_slot}' is empty.")

        target = slots.get(to_slot)
        if target is not None:
            if not can_swap(slots, layout.vehicle, from_slot, to_slot):
                raise ValidationAppError("Brak miejsca: przekroczono LDM lub tonaż.")
            slots[from_slot], slots[to_slot] = target, source
        else:
            if not can_assign(slots, layout.vehicle, source, to_slot, from_slot):
                raise ValidationAppError("Brak miejsca: przekroczono LDM lub tonaż.")
            slots[to_slot] = source
            slots[from_slot] = None

        update = LoadLayoutUpdate(slots=slots)
        if demo:
            return await self.update_demo_layout(update)
        return await self.update_session_layout(session_id, update)  # type: ignore[arg-type]

    async def remove_slot(
        self,
        session_id: UUID | None,
        slot_id: str,
        *,
        demo: bool = False,
    ) -> LoadLayoutResponse:
        layout = (
            await self.get_demo_layout()
            if demo
            else await self.get_session_layout(session_id)  # type: ignore[arg-type]
        )
        slots = dict(layout.slots)
        if slot_id not in slots:
            raise ValidationAppError(f"Unknown slot '{slot_id}'.")
        slots[slot_id] = None
        update = LoadLayoutUpdate(slots=slots)
        if demo:
            return await self.update_demo_layout(update)
        return await self.update_session_layout(session_id, update)  # type: ignore[arg-type]

    async def move_to_first_free(
        self,
        session_id: UUID | None,
        slot_id: str,
        *,
        demo: bool = False,
    ) -> LoadLayoutResponse:
        layout = (
            await self.get_demo_layout()
            if demo
            else await self.get_session_layout(session_id)  # type: ignore[arg-type]
        )
        slots = dict(layout.slots)
        pallet = slots.get(slot_id)
        if pallet is None:
            raise ValidationAppError(f"Slot '{slot_id}' is empty.")

        target = next((sid for sid, value in slots.items() if value is None), None)
        if target is None or target == slot_id:
            raise ValidationAppError("Brak wolnego slotu.")

        if not can_assign(slots, layout.vehicle, pallet, target, slot_id):
            raise ValidationAppError("Brak miejsca: przekroczono LDM lub tonaż.")

        slots[target] = pallet
        slots[slot_id] = None
        update = LoadLayoutUpdate(slots=slots)
        if demo:
            return await self.update_demo_layout(update)
        return await self.update_session_layout(session_id, update)  # type: ignore[arg-type]

    @staticmethod
    def _validate_slot_keys(
        slots: dict[str, PalletData | None],
        vehicle: PlannerVehicle,
    ) -> None:
        unknown = set(slots) - set(vehicle.payload_slots)
        if unknown:
            raise ValidationAppError(f"Unknown slot ids: {', '.join(sorted(unknown))}")

    async def _load_session(self, session_id: UUID) -> ConsolidationSession:
        result = await self._db.execute(
            select(ConsolidationSession)
            .where(ConsolidationSession.id == session_id)
            .options(selectinload(ConsolidationSession.vehicle)),
        )
        session = result.scalar_one_or_none()
        if session is None:
            raise NotFoundError(f"Session {session_id} not found.")
        return session

