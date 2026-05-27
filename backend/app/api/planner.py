"""Planner layout API for SlotEditor (`/api/v1/planner`)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import ValidationAppError
from app.schemas.planner import (
    LayoutActionResult,
    LoadLayoutResponse,
    LoadLayoutUpdate,
)
from app.services.planner_layout import PlannerLayoutService

router = APIRouter(prefix="/planner", tags=["planner"])


def _service(db: AsyncSession) -> PlannerLayoutService:
    return PlannerLayoutService(db)


@router.get(
    "/demo",
    response_model=LoadLayoutResponse,
    summary="Demo load layout for SlotEditor (any vehicle type)",
)
async def get_demo_layout(
    vehicle_type: str | None = Query(default=None, alias="vehicleType"),
    db: AsyncSession = Depends(get_db),
) -> LoadLayoutResponse:
    return await _service(db).get_demo_layout(vehicle_type)


@router.put(
    "/demo",
    response_model=LoadLayoutResponse,
    summary="Replace demo slot map after manual edits",
)
async def update_demo_layout(
    payload: LoadLayoutUpdate,
    vehicle_type: str | None = Query(default=None, alias="vehicleType"),
    db: AsyncSession = Depends(get_db),
) -> LoadLayoutResponse:
    return await _service(db).update_demo_layout(payload, vehicle_type)


@router.post(
    "/demo/reset",
    response_model=LoadLayoutResponse,
    summary="Rebuild demo layout for a given vehicle type",
)
async def reset_demo_layout(
    vehicle_type: str | None = Query(default=None, alias="vehicleType"),
    db: AsyncSession = Depends(get_db),
) -> LoadLayoutResponse:
    return await _service(db).reset_demo_layout(vehicle_type)


@router.post(
    "/demo/move",
    response_model=LayoutActionResult,
    summary="Move or swap pallets on the demo layout",
)
async def demo_move_pallet(
    from_slot: str = Query(..., alias="fromSlot"),
    to_slot: str = Query(..., alias="toSlot"),
    vehicle_type: str | None = Query(default=None, alias="vehicleType"),
    db: AsyncSession = Depends(get_db),
) -> LayoutActionResult:
    service = _service(db)
    try:
        layout = await service.apply_move(
            None,
            from_slot=from_slot,
            to_slot=to_slot,
            demo=True,
            vehicle_type=vehicle_type,
        )
    except ValidationAppError as exc:
        return LayoutActionResult(
            ok=False,
            layout=await service.get_demo_layout(vehicle_type),
            message=str(exc.detail),
        )
    return LayoutActionResult(ok=True, layout=layout)


@router.delete(
    "/demo/slots/{slot_id}",
    response_model=LoadLayoutResponse,
    summary="Remove pallet from demo slot",
)
async def demo_remove_slot(
    slot_id: str,
    vehicle_type: str | None = Query(default=None, alias="vehicleType"),
    db: AsyncSession = Depends(get_db),
) -> LoadLayoutResponse:
    return await _service(db).remove_slot(None, slot_id, demo=True, vehicle_type=vehicle_type)


@router.post(
    "/demo/slots/{slot_id}/move-to-first-free",
    response_model=LayoutActionResult,
    summary="Move demo pallet to first empty slot",
)
async def demo_move_to_first_free(
    slot_id: str,
    vehicle_type: str | None = Query(default=None, alias="vehicleType"),
    db: AsyncSession = Depends(get_db),
) -> LayoutActionResult:
    service = _service(db)
    try:
        layout = await service.move_to_first_free(
            None,
            slot_id,
            demo=True,
            vehicle_type=vehicle_type,
        )
    except ValidationAppError as exc:
        return LayoutActionResult(
            ok=False,
            layout=await service.get_demo_layout(vehicle_type),
            message=str(exc.detail),
        )
    return LayoutActionResult(ok=True, layout=layout)


@router.get(
    "/sessions/{session_id}/layout",
    response_model=LoadLayoutResponse,
    summary="Load layout for a consolidation session",
)
async def get_session_layout(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> LoadLayoutResponse:
    return await _service(db).get_session_layout(session_id)


@router.put(
    "/sessions/{session_id}/layout",
    response_model=LoadLayoutResponse,
    summary="Persist full slot map for a session",
)
async def update_session_layout(
    session_id: UUID,
    payload: LoadLayoutUpdate,
    db: AsyncSession = Depends(get_db),
) -> LoadLayoutResponse:
    layout = await _service(db).update_session_layout(session_id, payload)
    await db.commit()
    return layout


@router.post(
    "/sessions/{session_id}/layout/move",
    response_model=LayoutActionResult,
    summary="Move or swap pallets within a session layout",
)
async def session_move_pallet(
    session_id: UUID,
    from_slot: str = Query(..., alias="fromSlot"),
    to_slot: str = Query(..., alias="toSlot"),
    db: AsyncSession = Depends(get_db),
) -> LayoutActionResult:
    service = _service(db)
    try:
        layout = await service.apply_move(session_id, from_slot=from_slot, to_slot=to_slot)
        await db.commit()
    except ValidationAppError as exc:
        current = await service.get_session_layout(session_id)
        return LayoutActionResult(ok=False, layout=current, message=str(exc.detail))
    return LayoutActionResult(ok=True, layout=layout)


@router.delete(
    "/sessions/{session_id}/layout/slots/{slot_id}",
    response_model=LoadLayoutResponse,
    summary="Remove pallet from a session slot",
)
async def session_remove_slot(
    session_id: UUID,
    slot_id: str,
    db: AsyncSession = Depends(get_db),
) -> LoadLayoutResponse:
    layout = await _service(db).remove_slot(session_id, slot_id)
    await db.commit()
    return layout


@router.post(
    "/sessions/{session_id}/layout/slots/{slot_id}/move-to-first-free",
    response_model=LayoutActionResult,
    summary="Move session pallet to first empty slot",
)
async def session_move_to_first_free(
    session_id: UUID,
    slot_id: str,
    db: AsyncSession = Depends(get_db),
) -> LayoutActionResult:
    service = _service(db)
    try:
        layout = await service.move_to_first_free(session_id, slot_id)
        await db.commit()
    except ValidationAppError as exc:
        current = await service.get_session_layout(session_id)
        return LayoutActionResult(ok=False, layout=current, message=str(exc.detail))
    return LayoutActionResult(ok=True, layout=layout)
