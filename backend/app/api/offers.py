"""Market offers endpoints (`/api/v1/offers`)."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.schemas.offer import OfferRead

router = APIRouter(prefix="/offers", tags=["offers"])


@router.get(
    "",
    response_model=list[OfferRead],
    summary="List market offers (stub — DB integration pending)",
)
async def list_offers(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[OfferRead]:
    # NOTE: DB-backed implementation comes in a follow-up task.
    _ = (limit, offset)
    return []
