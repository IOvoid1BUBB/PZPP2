"""Market offers endpoints (`/api/v1/offers`)."""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.lib.geo import geo_point_from_geometry
from app.models.offer import MarketOffer
from app.schemas.offer import OfferRead

router = APIRouter(prefix="/offers", tags=["offers"])


def _offer_to_read(offer: MarketOffer) -> OfferRead:
    return OfferRead(
        id=offer.id,
        pickup=geo_point_from_geometry(offer.pickup_point),
        delivery=geo_point_from_geometry(offer.delivery_point),
        ldm=Decimal(str(offer.ldm)),
        weight_kg=int(offer.weight_kg),
        price_eur=Decimal(str(offer.price_eur)),
        time_window_open=offer.time_window_open,
        time_window_close=offer.time_window_close,
        handling_time_minutes=offer.handling_time_minutes,
        stackable=bool(offer.stackable),
        is_within_corridor=bool(offer.is_within_corridor),
        pickup_label=offer.pickup_label,
        delivery_label=offer.delivery_label,
        shipper_company=offer.shipper_company,
    )


@router.get(
    "",
    response_model=list[OfferRead],
    summary="List market offers",
)
async def list_offers(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[OfferRead]:
    stmt = (
        select(MarketOffer)
        .order_by(MarketOffer.id)
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return [_offer_to_read(offer) for offer in result.scalars().all()]
