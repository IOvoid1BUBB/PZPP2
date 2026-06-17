"""Synthetic market-offer generator for logistics-hub-based transport lanes.

DEPRECATED: używany tylko w testach regionalnych. Do live seedingu używaj
european_offer_generator.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.lib.geo import haversine_km
from app.schemas.offer import HUB_LABELS, MarketOfferCreate

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

# ---------------------------------------------------------------------------
# Masa ladunku: ~600-1800 kg/LDM (realna paleta EUR wazy 300-900 kg -> 750-2250
# kg/LDM). Gorny cap tuz pod ladownoscia solowki 12 t.
# ---------------------------------------------------------------------------
WEIGHT_MIN_KG_PER_LDM = 600.0
WEIGHT_MAX_KG_PER_LDM = 1800.0
MAX_WEIGHT_CAP_KG = 11900

# ---------------------------------------------------------------------------
# Stawka frachtu EUR/LDM*km.
#
# Dane rynkowe Europa 2024/2025 (Trans.eu, Timocom, Freightos):
#   LTL małe (1-3 palety, 100-500km):  0.45-0.90 EUR/LDM/km
#   LTL średnie (4-6 palet, 300-800km): 0.35-0.70 EUR/LDM/km
#   LTL duże (7-10 palet, 500-1500km):  0.30-0.65 EUR/LDM/km
#
# Koszt własny (Master L4, 900km trasa, 3.6 LDM):
#   paliwo 21.8 L/100km × 1.75 EUR = ~0.106 EUR/LDM/km
#   myto 0.187 EUR/km / 3.6 LDM   = ~0.052 EUR/LDM/km
#   serwis 0.08 / 3.6              = ~0.022 EUR/LDM/km
#   kierowca 49 EUR/dzień/600km/3.6 = ~0.023 EUR/LDM/km
#   Razem breakeven:               = ~0.203 EUR/LDM/km
#   Przy marży 100-200%: 0.40-0.60 EUR/LDM/km
# ---------------------------------------------------------------------------
RATE_MIN = 0.45   # Minimum rynkowe — pokrywa koszty operacyjne z minimalną marżą
RATE_MAX = 1.20   # Maximum dla małych ładunków (1-2 palety, krótkie trasy)
RATE_MEAN = 0.65  # Środek rynku europejskiego LTL
RATE_STDDEV = 0.12

ESTIMATED_STOP_COST_EUR = 15.0
MIN_PRICE_COVERAGE_FACTOR = 1.5

# Minimalny koszt paliwa na km (bez ładunku) — używany w dynamicznym min_viable_price.
# Pusty Master: 18.5 L/100km × 1.75 EUR/l ≈ 0.32 EUR/km
FUEL_COST_EMPTY_EUR_PER_KM = 0.32


def pallet_count_from_ldm(ldm: float) -> int:
    """Convert LDM into an integer pallet count (1 pallet = PALLET_LDM)."""
    if ldm <= 0:
        return 0
    return int(round(ldm / PALLET_LDM))


def adjust_rate_for_pallet_count(base_rate: float, pallet_count: int) -> float:
    """Apply a size-based rate adjustment: small (1-3 pallets) costs more per LDM-km.

    Based on European LTL market data (Trans.eu, Timocom 2024):
    - 1-3 pallets: premium ~20% (small shipments have higher per-unit costs)
    - 4-6 pallets: neutral
    - 7+ pallets: slight discount (~10%) for larger fills
    """
    if pallet_count <= 0:
        return base_rate

    if pallet_count <= 3:
        multiplier = 1.20
    elif pallet_count <= 6:
        multiplier = 1.0
    else:
        multiplier = 0.90

    adjusted = base_rate * multiplier
    return max(RATE_MIN, min(RATE_MAX, adjusted))


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
    weight_kg = min(
        int(ldm * random.uniform(WEIGHT_MIN_KG_PER_LDM, WEIGHT_MAX_KG_PER_LDM)),
        MAX_WEIGHT_CAP_KG,
    )
    distance_km = haversine_km(pickup_lon, pickup_lat, delivery_lon, delivery_lat)
    rate = max(RATE_MIN, min(RATE_MAX, random.gauss(RATE_MEAN, RATE_STDDEV)))
    price_eur = max(0.01, round(ldm * distance_km * rate, 2))

    # Dynamiczny min_viable_price: pokrywa koszt paliwa trasy + koszty obsługi stopów
    # Paliwo pusty pojazd: ~0.32 EUR/km × dystans (amortyzowane przez ładunek)
    # Stop costs: 2 × ESTIMATED_STOP_COST_EUR × MIN_PRICE_COVERAGE_FACTOR
    fuel_floor = round(FUEL_COST_EMPTY_EUR_PER_KM * distance_km * 0.4, 2)  # 40% kosztu paliwa per ofertę
    stop_floor = round(MIN_PRICE_COVERAGE_FACTOR * 2 * ESTIMATED_STOP_COST_EUR, 2)
    min_viable_price = round(fuel_floor + stop_floor, 2)
    price_eur = max(min_viable_price, price_eur)

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
        pickup_label=HUB_LABELS.get(pickup_hub_key, pickup_hub_key.capitalize()),
        delivery_label=HUB_LABELS.get(delivery_hub_key, delivery_hub_key.capitalize()),
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
