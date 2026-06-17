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
    PALLET_LDM,
    RATE_MAX,
    RATE_MEAN,
    RATE_MIN,
    RATE_STDDEV,
)

ALLOWED_LDM: tuple[float, ...] = tuple(round(k * PALLET_LDM, 1) for k in range(1, 11))
MIN_ROUTE_DISTANCE_KM = 50.0
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
        if prefer_international and pickup.country_code == delivery.country_code:
            if rng.random() < 0.5:
                continue
        return pickup, delivery
    pickup = rng.choice(sites)
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

    ldm = randomizer.choice(ALLOWED_LDM)
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
    rate = max(RATE_MIN, min(RATE_MAX, randomizer.gauss(RATE_MEAN, RATE_STDDEV)))
    price_eur = max(0.01, round(ldm * distance_km * rate, 2))

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
) -> list[GeneratedEuropeanOffer]:
    if count < 1:
        msg = "count must be at least 1"
        raise ValueError(msg)

    anchor = base_time if base_time is not None else datetime.now(UTC)
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=UTC)

    rng = random.Random(seed)
    return [
        generate_european_offer(sites, anchor, index=index, rng=rng)
        for index in range(count)
    ]
