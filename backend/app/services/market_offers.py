"""Persistence helpers for :class:`app.models.MarketOffer`."""

from __future__ import annotations

import re

from geoalchemy2.elements import WKTElement
from sqlalchemy import literal_column
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.offer import MarketOffer
from app.schemas.offer import MarketOfferCreate

_EWKT_POINT_RE = re.compile(
    r"^SRID=4326;POINT\((?P<lon>[-\d.]+)\s+(?P<lat>[-\d.]+)\)$",
)


def _ewkt_to_wkt_element(ewkt: str) -> WKTElement:
    match = _EWKT_POINT_RE.match(ewkt.strip())
    if match is None:
        msg = f"Invalid EWKT point: {ewkt!r}"
        raise ValueError(msg)
    lon = match.group("lon")
    lat = match.group("lat")
    return WKTElement(f"POINT({lon} {lat})", srid=4326)


def _offer_to_row(offer: MarketOfferCreate) -> dict[str, object]:
    return {
        "pickup_point": _ewkt_to_wkt_element(offer.pickup_point),
        "delivery_point": _ewkt_to_wkt_element(offer.delivery_point),
        "ldm": offer.ldm,
        "weight_kg": offer.weight_kg,
        "price_eur": offer.price_eur,
        "time_window_open": offer.time_window_open,
        "time_window_close": offer.time_window_close,
        "handling_time_minutes": offer.handling_time_minutes,
        "stackable": offer.stackable,
        "pickup_label": offer.pickup_label,
        "delivery_label": offer.delivery_label,
        "shipper_company": offer.shipper_company,
    }


async def bulk_insert_offers(
    db: AsyncSession,
    offers: list[MarketOfferCreate],
) -> tuple[int, int]:
    """Insert offers; skip rows that violate the deduplication unique index.

    Returns ``(inserted, skipped)``.
    """
    if not offers:
        return 0, 0

    table = MarketOffer.__table__
    rows = [_offer_to_row(offer) for offer in offers]
    stmt = (
        insert(table)
        .values(rows)
        .on_conflict_do_nothing(
            index_elements=[
                literal_column("(pickup_point::text)"),
                literal_column("(delivery_point::text)"),
                table.c.time_window_open,
            ],
        )
    )
    result = await db.execute(stmt)
    inserted = result.rowcount if result.rowcount is not None and result.rowcount >= 0 else 0
    skipped = len(offers) - inserted
    return inserted, skipped
