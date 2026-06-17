"""Market offers endpoints (`/api/v1/offers`)."""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.lib.geo import geo_point_from_geometry
from app.models import MarketOffer
from app.schemas.offer import OfferRead, SimulateOffersResponse
from app.services.european_offer_generator import generate_european_batch, get_catalog
from app.services.market_offers import bulk_insert_offers

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
    # Minimalna cena odpowiadająca min_viable_price z generatorów.
    # Nowe generatory (RATE_MIN=0.45): min ~51 EUR dla najkrótszych tras.
    # Próg 50 EUR eliminuje stare oferty bez odcinania nowych.
    MIN_PRICE_EUR = 50.0
    total = int(
        await db.scalar(
            select(func.count()).select_from(MarketOffer).where(MarketOffer.price_eur >= MIN_PRICE_EUR)
        ) or 0
    )
    response.headers["X-Total-Count"] = str(total)
    result = await db.execute(
        select(MarketOffer)
        .where(MarketOffer.price_eur >= MIN_PRICE_EUR)
        .order_by(MarketOffer.time_window_open.desc())
        .limit(limit)
        .offset(offset),
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
    generated = generate_european_batch(get_catalog(), count)
    offer_creates = [item.offer for item in generated]
    inserted, skipped = await bulk_insert_offers(db, offer_creates)
    await db.commit()
    return SimulateOffersResponse(requested=count, inserted=inserted, skipped=skipped)


@router.delete(
    "/stale",
    summary="Remove market offers with price below minimum viable threshold (45 EUR)",
    status_code=status.HTTP_200_OK,
)
async def delete_stale_offers(
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Delete market offers with price_eur < 50 EUR (generated before rate fix).

    Safe to call multiple times — idempotent.
    """
    MIN_PRICE_EUR = 50.0
    del_result = await db.execute(
        delete(MarketOffer).where(MarketOffer.price_eur < MIN_PRICE_EUR)
    )
    deleted: int = getattr(del_result, "rowcount", None) or 0
    await db.commit()
    return {"deleted": deleted, "min_price_threshold_eur": int(MIN_PRICE_EUR)}
