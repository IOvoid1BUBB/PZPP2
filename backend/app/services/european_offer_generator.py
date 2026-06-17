"""Generate market offers from a European logistics site catalog."""

from __future__ import annotations

import functools
import json
import random
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from app.lib.geo import haversine_km
from app.schemas.offer import MarketOfferCreate
from app.services.market_simulator import (
    _HANDLING_CHOICES,
    _HANDLING_WEIGHTS,
    ESTIMATED_STOP_COST_EUR,
    FUEL_COST_EMPTY_EUR_PER_KM,
    MIN_PRICE_COVERAGE_FACTOR,
    PALLET_LDM,
    RATE_MAX,
    RATE_MEAN,
    RATE_MIN,
    RATE_STDDEV,
    adjust_rate_for_pallet_count,
    pallet_count_from_ldm,
)

ALLOWED_LDM: tuple[float, ...] = tuple(round(k * PALLET_LDM, 1) for k in range(1, 11))
MIN_ROUTE_DISTANCE_KM = 50.0
# ORS limit: 6000 km per request. Z sesją 4-6 ofert po ~800km każda można przekroczyć limit.
# Ograniczamy dystans pojedynczej oferty do 1200 km żeby sesja z 4 ofertami = max 4800 km.
MAX_ROUTE_DISTANCE_KM = 1200.0
INTERNATIONAL_SHARE = 0.6
LABEL_MAX_LENGTH = 200

# Realistyczna masa ladunku: ~600-1800 kg/LDM (srodek ~1200 kg/LDM odpowiada
# typowym towarom masowym). Gorny cap tuz pod ladownoscia solowki 12 t, zeby
# generator nigdy nie przekroczyl fizycznej ladownosci pojazdu.
WEIGHT_MIN_KG_PER_LDM = 600.0
WEIGHT_MAX_KG_PER_LDM = 1800.0
MAX_WEIGHT_CAP_KG = 11900

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_CATALOG_PATH = _BACKEND_ROOT / "data" / "european_logistics_sites.json"


@dataclass(frozen=True, slots=True)
class LogisticsSite:
    id: str
    company: str
    facility_name: str
    facility_type: str
    city: str
    country_code: str
    lat: float
    lon: float
    facility_code: str | None = None
    address_line: str | None = None
    postal_code: str | None = None
    region: str | None = None
    source: str | None = None
    verified_at: str | None = None
    geocode_method: str | None = None

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> LogisticsSite:
        return cls(
            id=str(raw["id"]),
            company=str(raw["company"]),
            facility_name=str(raw["facility_name"]),
            facility_type=str(raw["facility_type"]),
            city=str(raw["city"]),
            country_code=str(raw["country_code"]).upper(),
            lat=float(raw["lat"]),
            lon=float(raw["lon"]),
            facility_code=raw.get("facility_code"),
            address_line=raw.get("address_line"),
            postal_code=raw.get("postal_code"),
            region=raw.get("region"),
            source=raw.get("source"),
            verified_at=raw.get("verified_at"),
            geocode_method=raw.get("geocode_method"),
        )


@dataclass(frozen=True, slots=True)
class GeneratedEuropeanOffer:
    offer: MarketOfferCreate
    pickup_site_id: str
    delivery_site_id: str


def format_site_label(site: LogisticsSite) -> str:
    """Build UI label: ``{company} {code_or_type} · {city}``."""
    code_or_type = site.facility_code or _facility_type_short(site.facility_type)
    label = f"{site.company} {code_or_type} · {site.city}"
    return label[:LABEL_MAX_LENGTH]


def _facility_type_short(facility_type: str) -> str:
    mapping = {
        "fulfillment_center": "FC",
        "distribution_center": "DC",
        "logistics_terminal": "Terminal",
        "freight_hub": "Hub",
        "contract_logistics_warehouse": "WH",
        "retail_dc": "DC",
        "port_inland_terminal": "Terminal",
    }
    return mapping.get(facility_type, "Site")


def _ewkt_point(lon: float, lat: float) -> str:
    return f"SRID=4326;POINT({lon:.5f} {lat:.5f})"


def validate_site(site: LogisticsSite) -> None:
    if not (-180.0 <= site.lon <= 180.0 and -90.0 <= site.lat <= 90.0):
        msg = f"Invalid coordinates for site {site.id}"
        raise ValueError(msg)
    if site.lat < 35.0 or site.lat > 71.0 or site.lon < -10.0 or site.lon > 40.0:
        msg = f"Site {site.id} outside European bounds"
        raise ValueError(msg)


def validate_catalog(sites: list[LogisticsSite]) -> dict[str, int | set[str]]:
    """Validate catalog counts and uniqueness; return summary stats."""
    if len(sites) < 1090:
        msg = f"Catalog must contain at least 1090 sites, got {len(sites)}"
        raise ValueError(msg)

    ids = {site.id for site in sites}
    if len(ids) != len(sites):
        msg = "Duplicate site ids in catalog"
        raise ValueError(msg)

    coord_keys = {(round(site.lat, 5), round(site.lon, 5)) for site in sites}
    countries = {site.country_code for site in sites}
    if len(countries) < 25:
        msg = f"Catalog must cover at least 25 countries, got {len(countries)}"
        raise ValueError(msg)

    for site in sites:
        validate_site(site)

    return {
        "total_sites": len(sites),
        "unique_coordinates": len(coord_keys),
        "countries": countries,
        "country_count": len(countries),
    }


def _pick_site_pair(
    sites: Sequence[LogisticsSite],
    rng: random.Random,
    *,
    prefer_international: bool,
) -> tuple[LogisticsSite, LogisticsSite]:
    for _ in range(200):
        pickup = rng.choice(sites)
        delivery = rng.choice(sites)
        if pickup.id == delivery.id:
            continue
        distance = haversine_km(pickup.lon, pickup.lat, delivery.lon, delivery.lat)
        if distance < MIN_ROUTE_DISTANCE_KM:
            continue
        if distance > MAX_ROUTE_DISTANCE_KM:
            continue
        if prefer_international and pickup.country_code == delivery.country_code:
            if rng.random() < 0.5:
                continue
        return pickup, delivery
    pickup = rng.choice(sites)
    candidates = [
        site
        for site in sites
        if site.id != pickup.id
        and MIN_ROUTE_DISTANCE_KM <= haversine_km(pickup.lon, pickup.lat, site.lon, site.lat) <= MAX_ROUTE_DISTANCE_KM
    ]
    if not candidates:
        # Fallback: relax MAX constraint, just enforce MIN
        candidates = [
            site
            for site in sites
            if site.id != pickup.id
            and haversine_km(pickup.lon, pickup.lat, site.lon, site.lat) >= MIN_ROUTE_DISTANCE_KM
        ]
    if not candidates:
        msg = "Unable to find valid pickup/delivery pair with min distance"
        raise ValueError(msg)
    return pickup, rng.choice(candidates)


def generate_european_offer(
    sites: Sequence[LogisticsSite],
    base_time: datetime,
    *,
    index: int = 0,
    rng: random.Random | None = None,
    ldm_override: float | None = None,
) -> GeneratedEuropeanOffer:
    """Build one :class:`MarketOfferCreate` from catalog sites."""
    if len(sites) < 2:
        msg = "At least two sites required"
        raise ValueError(msg)

    randomizer = rng or random.Random()
    prefer_international = randomizer.random() < INTERNATIONAL_SHARE
    pickup_site, delivery_site = _pick_site_pair(
        sites,
        randomizer,
        prefer_international=prefer_international,
    )

    window_open = base_time + timedelta(
        hours=index * 0.25 + randomizer.uniform(0, 72),
    )
    window_width = max(2.0, randomizer.gauss(4.0, 1.5))
    window_close = window_open + timedelta(hours=window_width)

    ldm = float(ldm_override) if ldm_override is not None else randomizer.choice(ALLOWED_LDM)
    weight_kg = min(
        int(ldm * randomizer.uniform(WEIGHT_MIN_KG_PER_LDM, WEIGHT_MAX_KG_PER_LDM)),
        MAX_WEIGHT_CAP_KG,
    )
    distance_km = haversine_km(
        pickup_site.lon,
        pickup_site.lat,
        delivery_site.lon,
        delivery_site.lat,
    )
    base_rate = max(RATE_MIN, min(RATE_MAX, randomizer.gauss(RATE_MEAN, RATE_STDDEV)))
    pallets = pallet_count_from_ldm(ldm)
    rate = adjust_rate_for_pallet_count(base_rate, pallets)
    price_eur = max(0.01, round(ldm * distance_km * rate, 2))

    # Dynamiczny min_viable_price: pokrywa koszt paliwa trasy + koszty obsługi stopów
    fuel_floor = round(FUEL_COST_EMPTY_EUR_PER_KM * distance_km * 0.4, 2)
    stop_floor = round(MIN_PRICE_COVERAGE_FACTOR * 2 * ESTIMATED_STOP_COST_EUR, 2)
    min_viable_price = round(fuel_floor + stop_floor, 2)
    price_eur = max(min_viable_price, price_eur)

    offer = MarketOfferCreate(
        pickup_point=_ewkt_point(pickup_site.lon, pickup_site.lat),
        delivery_point=_ewkt_point(delivery_site.lon, delivery_site.lat),
        ldm=Decimal(str(ldm)),
        weight_kg=weight_kg,
        price_eur=Decimal(str(price_eur)),
        time_window_open=window_open,
        time_window_close=window_close,
        handling_time_minutes=randomizer.choices(
            _HANDLING_CHOICES,
            weights=_HANDLING_WEIGHTS,
        )[0],
        stackable=randomizer.random() < 0.65,
        pickup_label=format_site_label(pickup_site),
        delivery_label=format_site_label(delivery_site),
        shipper_company=pickup_site.company[:100],
    )
    return GeneratedEuropeanOffer(
        offer=offer,
        pickup_site_id=pickup_site.id,
        delivery_site_id=delivery_site.id,
    )


def load_catalog(path: Path | str | None = None) -> list[LogisticsSite]:
    """Load the European logistics catalog from JSON into ``LogisticsSite`` objects.

    Defaults to ``backend/data/european_logistics_sites.json`` when ``path`` is omitted.
    """
    catalog_path = Path(path) if path is not None else _DEFAULT_CATALOG_PATH
    with catalog_path.open(encoding="utf-8") as handle:
        raw = json.load(handle)
    if not isinstance(raw, list):
        msg = f"Catalog must be a JSON array: {catalog_path}"
        raise ValueError(msg)
    return [LogisticsSite.from_dict(entry) for entry in raw]


@functools.lru_cache(maxsize=1)
def get_catalog() -> tuple[LogisticsSite, ...]:
    """Return the default catalog as an immutable cached singleton.

    Wrapped in ``lru_cache`` so the JSON is parsed once per process. Returns a
    tuple (hashable/immutable) so it is safe to cache and share across requests.
    """
    return tuple(load_catalog())


def generate_european_batch(
    sites: Sequence[LogisticsSite],
    count: int,
    base_time: datetime | None = None,
    *,
    seed: int | None = None,
    min_small_ldm_offers: int = 0,
    ldm_bucket_shares: tuple[float, float, float] | None = None,
) -> list[GeneratedEuropeanOffer]:
    if count < 1:
        msg = "count must be at least 1"
        raise ValueError(msg)

    anchor = base_time if base_time is not None else datetime.now(UTC)
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=UTC)

    rng = random.Random(seed)

    # Optional LDM mix:
    #  - bucket 1: 0.4–0.8 LDM   (1–2 pallets)
    #  - bucket 2: 0.8–2.0 LDM   (3–5 pallets)
    #  - bucket 3: >2.0 LDM      (6+ pallets)
    #
    # This is used by seed scripts to ensure a healthy small/medium tail.
    bucket_ldm: tuple[tuple[float, ...], tuple[float, ...], tuple[float, ...]] = (
        (PALLET_LDM, round(2 * PALLET_LDM, 1)),
        (
            round(3 * PALLET_LDM, 1),
            round(4 * PALLET_LDM, 1),
            round(5 * PALLET_LDM, 1),
        ),
        (
            round(6 * PALLET_LDM, 1),
            round(7 * PALLET_LDM, 1),
            round(8 * PALLET_LDM, 1),
            round(9 * PALLET_LDM, 1),
            round(10 * PALLET_LDM, 1),
        ),
    )

    ldm_overrides: list[float | None] = [None] * count
    if ldm_bucket_shares is not None:
        import math

        small_share, medium_share, large_share = ldm_bucket_shares
        if small_share < 0 or medium_share < 0 or large_share < 0:
            raise ValueError("ldm_bucket_shares cannot contain negative values")
        if (small_share + medium_share + large_share) > 1.0 + 1e-9:
            raise ValueError("ldm_bucket_shares must sum to <= 1.0")

        small_n = min(count, int(math.ceil(count * small_share)))
        medium_n = min(count - small_n, int(math.ceil(count * medium_share)))
        large_n = min(count - small_n - medium_n, int(math.ceil(count * large_share)))
        remainder = count - small_n - medium_n - large_n
        # Fill any remainder into the "large" bucket by default.
        large_n += remainder

        chosen: list[float] = []
        chosen.extend(rng.choices(bucket_ldm[0], k=small_n))
        chosen.extend(rng.choices(bucket_ldm[1], k=medium_n))
        chosen.extend(rng.choices(bucket_ldm[2], k=large_n))
        rng.shuffle(chosen)
        ldm_overrides = chosen  # type: ignore[assignment]
    else:
        # Backwards-compatible behavior: enforce a minimum number of small offers.
        small_count = max(0, min(int(min_small_ldm_offers), count))
        if small_count > 0:
            forced = rng.choices(bucket_ldm[0], k=small_count)
            for i in range(small_count):
                ldm_overrides[i] = forced[i]

    items: list[GeneratedEuropeanOffer] = []
    for index in range(count):
        ldm_override = ldm_overrides[index]
        items.append(
            generate_european_offer(
                sites,
                anchor,
                index=index,
                rng=rng,
                ldm_override=ldm_override,
            )
        )
    return items
