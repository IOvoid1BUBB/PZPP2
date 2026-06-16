"""Synthetic market-offer generator for logistics-hub-based transport lanes."""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.lib.geo import haversine_km
from app.schemas.offer import MarketOfferCreate

PALLET_LDM = 0.4

LOGISTICS_HUBS: dict[str, tuple[float, float]] = {
    "warszawa": (21.01, 52.22),
    "lodz": (19.46, 51.75),
    "wroclaw": (17.03, 51.11),
    "poznan": (16.92, 52.41),
    "katowice": (19.02, 50.26),
    "gdansk": (18.65, 54.35),
    "berlin": (13.40, 52.52),
    "prague": (14.42, 50.08),
    "vienna": (16.37, 48.21),
    "hamburg": (9.99, 53.55),
}

# ---------------------------------------------------------------------------
# ADR: LDM jako wielokrotności 1 palety EUR (1 paleta = 1 slot = 0.4 LDM)
# Dozwolone wartości: k × 0.4 dla k = 1..34 → max 13.6 LDM (pełna naczepa mega).
# Gwarantuje, że każda oferta = całkowita liczba palet bez ułamkowych konfliktów.
# ---------------------------------------------------------------------------
PALLET_LDM = 0.4
_LDM_CHOICES: tuple[float, ...] = tuple(round(k * PALLET_LDM, 1) for k in range(1, 11))
# → (0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2, 3.6, 4.0)
_HANDLING_CHOICES: tuple[int, ...] = (15, 30, 45, 60)
_HANDLING_WEIGHTS: tuple[float, ...] = (0.2, 0.5, 0.2, 0.1)


@dataclass(frozen=True, slots=True)
class GeneratedOffer:
    """Single generated offer plus hub keys (for diversity checks in tests)."""

    offer: MarketOfferCreate
    pickup_hub_key: str
    delivery_hub_key: str


def _ewkt_point(lon: float, lat: float) -> str:
    return f"SRID=4326;POINT({lon} {lat})"


def generate_single_offer(
    base_time: datetime,
    *,
    pickup_hub_key: str | None = None,
    delivery_hub_key: str | None = None,
) -> GeneratedOffer:
    """Build one synthetic :class:`MarketOfferCreate` around logistics hubs."""
    if pickup_hub_key is None:
        pickup_hub_key = random.choice(list(LOGISTICS_HUBS))
    if delivery_hub_key is None:
        delivery_hub_key = random.choice(
            [k for k in LOGISTICS_HUBS if k != pickup_hub_key],
        )

    pickup_hub = LOGISTICS_HUBS[pickup_hub_key]
    delivery_hub = LOGISTICS_HUBS[delivery_hub_key]

    pickup_lon = pickup_hub[0] + random.gauss(0, 0.03)
    pickup_lat = pickup_hub[1] + random.gauss(0, 0.02)
    delivery_lon = delivery_hub[0] + random.gauss(0, 0.03)
    delivery_lat = delivery_hub[1] + random.gauss(0, 0.02)

    window_open = base_time + timedelta(hours=random.uniform(0, 72))
    window_width = max(2.0, random.gauss(4.0, 1.5))
    window_close = window_open + timedelta(hours=window_width)

    ldm = round(random.choice(_LDM_CHOICES), 1)
    weight_kg = int(ldm * random.uniform(150, 400))
    distance_km = haversine_km(pickup_lon, pickup_lat, delivery_lon, delivery_lat)
    rate = max(0.60, min(2.50, random.gauss(1.20, 0.25)))
    price_eur = max(0.01, round(ldm * distance_km * rate, 2))

    offer = MarketOfferCreate(
        pickup_point=_ewkt_point(pickup_lon, pickup_lat),
        delivery_point=_ewkt_point(delivery_lon, delivery_lat),
        ldm=Decimal(str(ldm)),
        weight_kg=weight_kg,
        price_eur=Decimal(str(price_eur)),
        time_window_open=window_open,
        time_window_close=window_close,
        handling_time_minutes=random.choices(
            _HANDLING_CHOICES,
            weights=_HANDLING_WEIGHTS,
        )[0],
        stackable=random.random() < 0.65,
    )
    return GeneratedOffer(
        offer=offer,
        pickup_hub_key=pickup_hub_key,
        delivery_hub_key=delivery_hub_key,
    )


def generate_batch(count: int, base_time: datetime | None = None) -> list[GeneratedOffer]:
    """Generate ``count`` synthetic offers anchored at ``base_time`` (UTC now if omitted)."""
    if count < 1:
        msg = "count must be at least 1"
        raise ValueError(msg)
    anchor = base_time if base_time is not None else datetime.now(UTC)
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=UTC)
    return [generate_single_offer(anchor) for _ in range(count)]
