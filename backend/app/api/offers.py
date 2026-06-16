"""Market offers endpoints (`/api/v1/offers`)."""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.lib.geo import geo_point_from_geometry
from app.models import MarketOffer
from app.schemas.offer import OfferRead, SimulateOffersResponse
from app.services.market_offers import bulk_insert_offers
from app.services.market_simulator import generate_batch

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
    summary="List market offers from the database",
)
async def list_offers(
    response: Response,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[OfferRead]:
    total = int(await db.scalar(select(func.count()).select_from(MarketOffer)) or 0)
    response.headers["X-Total-Count"] = str(total)
    result = await db.execute(
        select(MarketOffer).order_by(MarketOffer.time_window_open.desc()).limit(limit).offset(offset),
    )
    return [_offer_to_read(row) for row in result.scalars().all()]


@router.post(
    "/simulate",
    response_model=SimulateOffersResponse,
    summary="Generate synthetic market offers (no session required)",
)
async def simulate_offers(
    db: AsyncSession = Depends(get_db),
    count: int = Query(200, ge=1, le=500),
) -> SimulateOffersResponse:
    """Seed the market_offers table with synthetic data without needing a session."""
    generated = generate_batch(count)
    offer_creates = [item.offer for item in generated]
    inserted, skipped = await bulk_insert_offers(db, offer_creates)
    await db.commit()
    return SimulateOffersResponse(requested=count, inserted=inserted, skipped=skipped)
