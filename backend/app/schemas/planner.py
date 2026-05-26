"""Schemas for the visual load planner (SlotEditor) API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SlotConflictType = Literal["stacking_violation", "time_window_breach", "weight_overload"]


class PalletDims(BaseModel):
    model_config = ConfigDict(extra="forbid", ser_json_by_alias=True)

    w_mm: int = Field(..., alias="wMm")
    d_mm: int = Field(..., alias="dMm")
    h_mm: int = Field(..., alias="hMm")


class PalletTimeWindow(BaseModel):
    model_config = ConfigDict(extra="forbid", ser_json_by_alias=True)

    open: datetime
    close: datetime


class PalletData(BaseModel):
    """Pallet assigned to a trailer slot."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True, ser_json_by_alias=True)

    id: str
    offer_id: str = Field(..., alias="offerId")
    client_id: str = Field(..., alias="clientId")
    client_name: str = Field(..., alias="clientName")
    client_color: str = Field(..., alias="clientColor")
    ldm: float
    weight_kg: int = Field(..., alias="weightKg")
    dims: PalletDims
    stackable: bool
    time_window: PalletTimeWindow | None = Field(default=None, alias="timeWindow")


class PayloadSlotConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, ser_json_by_alias=True)

    row: int
    col: int
    ldm_per_slot: float = Field(..., alias="ldmPerSlot")
    x_offset_cm: float = Field(..., alias="xOffsetCm")
    y_offset_cm: float = Field(..., alias="yOffsetCm")
    width_cm: float = Field(default=80.0, alias="widthCm")
    depth_cm: float = Field(default=120.0, alias="depthCm")


class PlannerVehicle(BaseModel):
    """Vehicle shape consumed by TrailerCanvas / SlotEditor."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True, ser_json_by_alias=True)

    id: str
    name: str
    type: Literal["master_l2", "master_l3", "master_l4", "man_solo"]
    max_ldm: float = Field(..., alias="maxLdm")
    max_weight_kg: int = Field(..., alias="maxWeightKg")
    trailer_length_cm: int = Field(..., alias="trailerLengthCm")
    trailer_width_cm: int = Field(..., alias="trailerWidthCm")
    payload_slots: dict[str, PayloadSlotConfig] = Field(..., alias="payloadSlots")


class SlotConflict(BaseModel):
    model_config = ConfigDict(extra="forbid", ser_json_by_alias=True)

    type: SlotConflictType
    affected_slot_ids: list[str] = Field(..., alias="affectedSlotIds")
    message: str


class LoadLayoutResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, ser_json_by_alias=True)

    session_id: str | None = Field(default=None, alias="sessionId")
    vehicle: PlannerVehicle
    slots: dict[str, PalletData | None]
    conflicts: list[SlotConflict] = Field(default_factory=list)


class LoadLayoutUpdate(BaseModel):
    """Replace the full slot map (after drag/drop or context-menu action)."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True, ser_json_by_alias=True)

    slots: dict[str, PalletData | None]


class LayoutActionResult(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, ser_json_by_alias=True)

    ok: bool
    layout: LoadLayoutResponse
    message: str | None = None
