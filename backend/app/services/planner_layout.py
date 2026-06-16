"""Load layout service backing the SlotEditor frontend."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError, ValidationAppError
from app.models import ConsolidationSession, MarketOffer, Vehicle
from app.models.stop import RouteStop
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


_VALID_VEHICLE_TYPES: frozenset[str] = frozenset(
    {"master_l2", "master_l3", "master_l4", "man_solo"},
)


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
        return _repair_overlapping_slots(slots)

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
    return _repair_overlapping_slots(slots)


def _repair_overlapping_slots(
    slots: dict[str, PayloadSlotConfig],
) -> dict[str, PayloadSlotConfig]:
    """Shift right-column longitudinal slots whose x-range overlaps a wider left-column slot.

    E.g. a left slot at x=0, w=120 extends to x=120; a right slot at x=80, w=80
    overlaps in [80,120).  Move it to x=120 so the footprints merely touch.
    """
    fixed = dict(slots)
    patched = False

    for slot_id, cfg in slots.items():
        w = cfg.width_cm
        d = cfg.depth_cm
        if cfg.x_offset_cm == 0 or w >= 100:
            continue

        y_start = cfg.y_offset_cm
        y_end = y_start + d

        for other in slots.values():
            if other.x_offset_cm != 0:
                continue
            ow = other.width_cm
            if ow <= cfg.x_offset_cm:
                continue
            oy_start = other.y_offset_cm
            oy_end = oy_start + other.depth_cm

            if y_start < oy_end and y_end > oy_start and cfg.x_offset_cm < ow:
                fixed[slot_id] = cfg.model_copy(update={"x_offset_cm": ow})
                patched = True
                break

    return fixed if patched else slots


def client_name_from_offer(offer: MarketOffer) -> str:
    """Prefer shipper company or pickup label for planner pallet coloring."""
    if offer.shipper_company:
        return offer.shipper_company
    if offer.pickup_label:
        return offer.pickup_label.split(" · ", 1)[0].strip()
    return f"Oferta {str(offer.id)[:8]}"


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



def build_layout_from_offers(
    payload_slots: dict[str, PayloadSlotConfig],
    offers: list[Any],
    color_map: dict[str, str] | None = None,
) -> dict[str, PalletData | None]:
    """Rozmieść oferty sesji na slotach pacy — jedna oferta = kolejne wolne sloty.

    Każda oferta zajmuje ceil(ldm / ldm_per_slot) slotów. Sloty wybierane są
    w kolejności iteracji (tj. od frontu pacy). Nadmiar ofert które nie zmieszczą
    się na pace jest ignorowany (solver nie powinien takich dobierać).
    """
    import math

    slots = empty_slots(payload_slots)
    slot_ids = list(payload_slots)
    slot_idx = 0
    color_idx = 0

    for offer in offers:
        offer_id = str(offer.get("id") or offer.get("offer_id", ""))
        ldm = float(offer.get("ldm", 0))
        weight_kg = int(offer.get("weight_kg", 0))
        stackable = bool(offer.get("stackable", True))
        pickup_label = offer.get("pickup_label") or offer.get("address_label") or ""
        client_color = (
            (color_map or {}).get(offer_id)
            or CLIENT_COLORS[color_idx % len(CLIENT_COLORS)]
        )

        # Liczba slotów = ceil(ldm / ldm_per_slot); minimum 1
        first_slot_id = slot_ids[slot_idx] if slot_idx < len(slot_ids) else None
        if first_slot_id is None:
            break
        ldm_per_slot = payload_slots[first_slot_id].ldm_per_slot or 0.4
        n_slots = max(1, math.ceil(ldm / ldm_per_slot)) if ldm_per_slot > 0 else 1

        for i in range(n_slots):
            if slot_idx >= len(slot_ids):
                break
            sid = slot_ids[slot_idx]
            cfg = payload_slots[sid]
            slot_idx += 1

            pallet = PalletData(
                id=f"p-{offer_id[:8]}-{i}",
                offerId=offer_id,
                clientId=offer_id,
                clientName=pickup_label or f"Oferta {offer_id[:8]}",
                clientColor=client_color,
                ldm=round(ldm_per_slot, 2),
                weightKg=max(1, weight_kg // n_slots),
                dims=PalletDims(
                    wMm=int(cfg.width_cm * 10),
                    dMm=int(cfg.depth_cm * 10),
                    hMm=1600,
                ),
                stackable=stackable,
                timeWindow=None,
            )
            slots[sid] = pallet

        color_idx += 1

    return slots


def get_used_ldm(slots: dict[str, PalletData | None]) -> float:
    return sum(pallet.ldm for pallet in slots.values() if pallet is not None)


def get_used_weight(slots: dict[str, PalletData | None]) -> int:
    return sum(pallet.weight_kg for pallet in slots.values() if pallet is not None)


def _pallet_fits_slot(pallet: PalletData, slot: PayloadSlotConfig) -> bool:
    """Euro pallet may be placed with a 90° turn when it fits the slot footprint."""
    slot_w_mm = int(slot.width_cm * 10)
    slot_d_mm = int(slot.depth_cm * 10)
    w_mm = pallet.dims.w_mm
    d_mm = pallet.dims.d_mm
    fits_as_is = w_mm <= slot_w_mm and d_mm <= slot_d_mm
    fits_rotated = w_mm <= slot_d_mm and d_mm <= slot_w_mm
    return fits_as_is or fits_rotated


def _orient_pallet_for_slot(pallet: PalletData, slot: PayloadSlotConfig) -> PalletData:
    slot_w_mm = int(slot.width_cm * 10)
    slot_d_mm = int(slot.depth_cm * 10)
    w_mm = pallet.dims.w_mm
    d_mm = pallet.dims.d_mm
    fits_as_is = w_mm <= slot_w_mm and d_mm <= slot_d_mm
    fits_rotated = w_mm <= slot_d_mm and d_mm <= slot_w_mm

    if not fits_as_is and not fits_rotated:
        return pallet
    if w_mm == slot_w_mm and d_mm == slot_d_mm:
        return pallet

    return pallet.model_copy(
        update={
            "dims": pallet.dims.model_copy(update={"w_mm": slot_w_mm, "d_mm": slot_d_mm}),
        },
    )


def _swap_fits_dimensions(
    slots: dict[str, PalletData | None],
    vehicle: PlannerVehicle,
    slot_a: str,
    slot_b: str,
) -> bool:
    pallet_a = slots.get(slot_a)
    pallet_b = slots.get(slot_b)
    config_a = vehicle.payload_slots.get(slot_a)
    config_b = vehicle.payload_slots.get(slot_b)
    if pallet_a is None or pallet_b is None or config_a is None or config_b is None:
        return False
    return _pallet_fits_slot(pallet_a, config_b) and _pallet_fits_slot(pallet_b, config_a)


def find_first_assignable_slot(
    slots: dict[str, PalletData | None],
    vehicle: PlannerVehicle,
    pallet: PalletData,
    source_slot_id: str,
) -> str | None:
    """First empty slot where the pallet passes all assignment rules."""
    for slot_id, value in slots.items():
        if slot_id == source_slot_id or value is not None:
            continue
        if can_assign(slots, vehicle, pallet, slot_id, source_slot_id):
            return slot_id
    return None


def assign_failure_reason(
    slots: dict[str, PalletData | None],
    vehicle: PlannerVehicle,
    pallet: PalletData,
    target_slot_id: str,
    source_slot_id: str | None = None,
) -> str:
    target_config = vehicle.payload_slots.get(target_slot_id)
    if target_config is None:
        return "Brak miejsca: przekroczono LDM lub tonaż."

    exclude = {source_slot_id} if source_slot_id else set()
    if _source_target_footprints_overlap(source_slot_id, target_slot_id, vehicle.payload_slots):
        return "To miejsce nachodzi na inną paletę."
    if _has_occupied_footprint_overlap(
        target_slot_id,
        slots,
        vehicle.payload_slots,
        exclude,
    ):
        return "To miejsce nachodzi na inną paletę."
    if not _pallet_fits_slot(pallet, target_config):
        return "Paleta nie mieści się w tym slocie."

    return "Brak miejsca: przekroczono LDM lub tonaż."


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

    exclude = {source_slot_id} if source_slot_id else set()
    if _source_target_footprints_overlap(source_slot_id, target_slot_id, vehicle.payload_slots):
        return False
    if _has_occupied_footprint_overlap(
        target_slot_id,
        slots,
        vehicle.payload_slots,
        exclude,
    ):
        return False

    target_config = vehicle.payload_slots[target_slot_id]
    if not _pallet_fits_slot(pallet, target_config):
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

    config_a = vehicle.payload_slots.get(slot_a)
    config_b = vehicle.payload_slots.get(slot_b)
    if config_a is None or config_b is None:
        return False

    if not _pallet_fits_slot(pallet_a, config_b) or not _pallet_fits_slot(pallet_b, config_a):
        return False

    if _footprints_overlap(config_a, config_b):
        return False

    for slot_id, pallet in slots.items():
        if pallet is None or slot_id in {slot_a, slot_b}:
            continue
        other_config = vehicle.payload_slots.get(slot_id)
        if other_config is None:
            continue
        if _footprints_overlap(config_a, other_config) or _footprints_overlap(
            config_b,
            other_config,
        ):
            return False

    used_ldm = get_used_ldm(slots)
    used_weight = get_used_weight(slots)
    return used_ldm <= vehicle.max_ldm and used_weight <= vehicle.max_weight_kg


def _has_occupied_footprint_overlap(
    target_slot_id: str,
    slots: dict[str, PalletData | None],
    payload_slots: dict[str, PayloadSlotConfig],
    exclude_slot_ids: set[str] | None = None,
) -> bool:
    target_config = payload_slots.get(target_slot_id)
    if target_config is None:
        return False

    excluded = {target_slot_id, *(exclude_slot_ids or set())}
    for slot_id, pallet in slots.items():
        if pallet is None or slot_id in excluded:
            continue
        other_config = payload_slots.get(slot_id)
        if other_config is not None and _footprints_overlap(target_config, other_config):
            return True
    return False


def _source_target_footprints_overlap(
    source_slot_id: str | None,
    target_slot_id: str,
    payload_slots: dict[str, PayloadSlotConfig],
) -> bool:
    """Interlocking slots (e.g. L4 s3/s8) share floor space — no moves between them."""
    if source_slot_id is None:
        return False
    source_config = payload_slots.get(source_slot_id)
    target_config = payload_slots.get(target_slot_id)
    if source_config is None or target_config is None:
        return False
    return _footprints_overlap(source_config, target_config)


def _slot_bounds(config: PayloadSlotConfig) -> tuple[float, float, float, float]:
    width = config.width_cm
    depth = config.depth_cm
    left = config.x_offset_cm
    top = config.y_offset_cm
    return left, top, left + width, top + depth


def _footprints_overlap(a: PayloadSlotConfig, b: PayloadSlotConfig) -> bool:
    a_left, a_top, a_right, a_bottom = _slot_bounds(a)
    b_left, b_top, b_right, b_bottom = _slot_bounds(b)
    return not (
        a_right <= b_left
        or b_right <= a_left
        or a_bottom <= b_top
        or b_bottom <= a_top
    )


def detect_conflicts(
    slots: dict[str, PalletData | None],
    vehicle: PlannerVehicle,
) -> list[SlotConflict]:
    conflicts: list[SlotConflict] = []
    slot_entries = list(vehicle.payload_slots.items())

    for index, (slot_a, config_a) in enumerate(slot_entries):
        pallet_a = slots.get(slot_a)
        if pallet_a is None:
            continue
        for slot_b, config_b in slot_entries[index + 1 :]:
            pallet_b = slots.get(slot_b)
            if pallet_b is None:
                continue
            if not _footprints_overlap(config_a, config_b):
                continue
            if not pallet_a.stackable or not pallet_b.stackable:
                conflicts.append(
                    SlotConflict(
                        type="stacking_violation",
                        affectedSlotIds=[slot_a, slot_b],
                        message=(
                            "Niedozwolone stackowanie: co najmniej jedna paleta "
                            "w tym miejscu jest niestackowalna."
                        ),
                    ),
                )
                continue

            conflicts.append(
                SlotConflict(
                    type="footprint_overlap",
                    affectedSlotIds=[slot_a, slot_b],
                    message=(
                        "Dwa ładunki nie mogą zajmować tego samego miejsca na podłodze."
                    ),
                ),
            )

    for slot_id, pallet in slots.items():
        if pallet is None:
            continue
        config = vehicle.payload_slots.get(slot_id)
        if config is None or _pallet_fits_slot(pallet, config):
            continue
        conflicts.append(
            SlotConflict(
                type="dimension_mismatch",
                affectedSlotIds=[slot_id],
                message=f"Paleta {pallet.client_name} nie mieści się w slocie {slot_id}.",
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


def _validate_layout_slots(
    slots: dict[str, PalletData | None],
    vehicle: PlannerVehicle,
) -> None:
    """Reject slot maps that violate assignment rules (used on PUT saves)."""
    for slot_id, pallet in slots.items():
        if pallet is None:
            continue
        config = vehicle.payload_slots.get(slot_id)
        if config is None:
            msg = f"Unknown slot '{slot_id}'."
            raise ValidationAppError(msg)
        if not _pallet_fits_slot(pallet, config):
            msg = f"Paleta {pallet.client_name} nie mieści się w slocie {slot_id}."
            raise ValidationAppError(msg)

    for slot_id, pallet in slots.items():
        if pallet is None:
            continue
        if _has_occupied_footprint_overlap(slot_id, slots, vehicle.payload_slots, set()):
            msg = f"Slot {slot_id} nachodzi na inną paletę."
            raise ValidationAppError(msg)


def _is_legacy_demo_layout(stored: dict[str, Any]) -> bool:
    """Zwraca True gdy layout zawiera stare hardcoded demo-palety (offerId o1/o2/o4/o5)."""
    demo_offer_ids = {"o1", "o2", "o4", "o5"}
    for value in stored.values():
        if isinstance(value, dict):
            offer_id = value.get("offerId") or value.get("offer_id", "")
            if offer_id in demo_offer_ids:
                return True
    return False


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

    async def get_session_layout(self, session_id: UUID) -> LoadLayoutResponse:
        session = await self._load_session(session_id)
        if session.vehicle is None:
            raise ValidationAppError("Session has no vehicle assigned.")

        planner_vehicle = vehicle_to_planner(session.vehicle)
        stored = session.load_layout if isinstance(session.load_layout, dict) else None

        # Wykryj stary demo-layout (zawierający hardcoded offerId "o1"/"o2")
        # i zastąp go prawdziwymi danymi.
        if stored is not None and _is_legacy_demo_layout(stored):
            stored = None
            session.load_layout = None

        slots = slots_from_storage(stored, planner_vehicle.payload_slots)

        if stored is None:
            slots = await self._build_initial_slots_from_session(session, planner_vehicle)
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
        _validate_layout_slots(payload.slots, planner_vehicle)
        session.load_layout = slots_to_storage(payload.slots)
        await self._db.flush()
        return build_layout_response(planner_vehicle, payload.slots, session_id=str(session.id))

    async def apply_move(
        self,
        session_id: UUID,
        *,
        from_slot: str,
        to_slot: str,
    ) -> LoadLayoutResponse:
        layout = await self.get_session_layout(session_id)
        slots = dict(layout.slots)
        source = slots.get(from_slot)
        if source is None:
            raise ValidationAppError(f"Source slot '{from_slot}' is empty.")

        target = slots.get(to_slot)
        if target is not None:
            if not can_swap(slots, layout.vehicle, from_slot, to_slot):
                raise ValidationAppError(
                    "Paleta nie mieści się w tym slocie."
                    if not _swap_fits_dimensions(slots, layout.vehicle, from_slot, to_slot)
                    else "Brak miejsca: przekroczono LDM lub tonaż.",
                )
            config_a = layout.vehicle.payload_slots[from_slot]
            config_b = layout.vehicle.payload_slots[to_slot]
            slots[from_slot] = _orient_pallet_for_slot(target, config_a)
            slots[to_slot] = _orient_pallet_for_slot(source, config_b)
        else:
            if not can_assign(slots, layout.vehicle, source, to_slot, from_slot):
                raise ValidationAppError(
                    assign_failure_reason(
                        slots,
                        layout.vehicle,
                        source,
                        to_slot,
                        from_slot,
                    ),
                )
            target_config = layout.vehicle.payload_slots[to_slot]
            slots[to_slot] = _orient_pallet_for_slot(source, target_config)
            slots[from_slot] = None

        update = LoadLayoutUpdate(slots=slots)
        return await self.update_session_layout(session_id, update)

    async def remove_slot(
        self,
        session_id: UUID,
        slot_id: str,
    ) -> LoadLayoutResponse:
        layout = await self.get_session_layout(session_id)
        slots = dict(layout.slots)
        if slot_id not in slots:
            raise ValidationAppError(f"Unknown slot '{slot_id}'.")
        slots[slot_id] = None
        update = LoadLayoutUpdate(slots=slots)
        return await self.update_session_layout(session_id, update)

    async def move_to_first_free(
        self,
        session_id: UUID,
        slot_id: str,
    ) -> LoadLayoutResponse:
        layout = await self.get_session_layout(session_id)
        slots = dict(layout.slots)
        pallet = slots.get(slot_id)
        if pallet is None:
            raise ValidationAppError(f"Slot '{slot_id}' is empty.")

        target = find_first_assignable_slot(slots, layout.vehicle, pallet, slot_id)
        if target is None:
            raise ValidationAppError("Brak wolnego slotu pasującego dla tej palety.")

        target_config = layout.vehicle.payload_slots[target]
        slots[target] = _orient_pallet_for_slot(pallet, target_config)
        slots[slot_id] = None
        update = LoadLayoutUpdate(slots=slots)
        return await self.update_session_layout(session_id, update)

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

    async def _build_initial_slots_from_session(
        self,
        session: ConsolidationSession,
        planner_vehicle: PlannerVehicle,
    ) -> dict[str, PalletData | None]:
        """Zbuduj layout z ofert przypisanych do sesji (przez route_stops).

        Jeśli sesja nie ma ofert — zwraca puste sloty (nie demo).
        Wywołuje ``build_layout_from_offers`` która rozmieszcza po kolei od frontu pacy.
        """
        from decimal import Decimal  # noqa: F401  # kept for future use
        # Pobierz unikalne offer_id z pickup stops (unikamy duplikatów delivery)
        stmt = (
            select(RouteStop.offer_id)
            .where(
                RouteStop.session_id == session.id,
                RouteStop.stop_type == "pickup",
            )
            .order_by(RouteStop.sequence_order)
        )
        result = await self._db.execute(stmt)
        offer_ids = [row[0] for row in result.all()]

        if not offer_ids:
            return empty_slots(planner_vehicle.payload_slots)

        # Pobierz dane ofert w kolejności sekwencji
        offers_result = await self._db.execute(
            select(MarketOffer).where(MarketOffer.id.in_(offer_ids))
        )
        offers_by_id = {o.id: o for o in offers_result.scalars().all()}

        # Buduj listę dicts w kolejności przystanków
        offer_dicts: list[dict] = []
        for oid in offer_ids:
            offer = offers_by_id.get(oid)
            if offer is None:
                continue
            offer_dicts.append({
                "id": str(offer.id),
                "ldm": float(offer.ldm),
                "weight_kg": int(offer.weight_kg),
                "price_eur": float(offer.price_eur),
                "stackable": bool(offer.stackable),
                "pickup_label": f"Oferta {str(offer.id)[:8]}",
            })

        return build_layout_from_offers(planner_vehicle.payload_slots, offer_dicts)

