from __future__ import annotations

from app.services.european_offer_generator import generate_european_batch


def test_ldm_bucket_shares_distribution_40_40_20() -> None:
    # 200 makes the 40/40/20 split exact and easy to validate.
    batch = generate_european_batch(
        _distant_sites(),
        200,
        seed=123,
        ldm_bucket_shares=(0.40, 0.40, 0.20),
    )
    ldms = [float(item.offer.ldm) for item in batch]

    small = sum(1 for ldm in ldms if 0.4 <= ldm <= 0.8)
    medium = sum(1 for ldm in ldms if 0.8 < ldm <= 2.0)
    large = sum(1 for ldm in ldms if ldm > 2.0)

    assert small >= 80
    assert medium >= 80
    assert large <= 40


def _distant_sites():
    # Minimal local sites to satisfy generator constraints (no file IO).
    from app.services.european_offer_generator import LogisticsSite

    return [
        LogisticsSite(
            id="pickup-de",
            company="DHL",
            facility_name="DHL DC Hamburg",
            facility_type="distribution_center",
            city="Hamburg",
            country_code="DE",
            lat=53.55,
            lon=9.99,
            facility_code="DC",
        ),
        LogisticsSite(
            id="delivery-pl",
            company="DHL",
            facility_name="DHL DC Warszawa",
            facility_type="distribution_center",
            city="Warszawa",
            country_code="PL",
            lat=52.22,
            lon=21.01,
            facility_code="DC",
        ),
        LogisticsSite(
            id="delivery-fr",
            company="DHL",
            facility_name="DHL DC Paris",
            facility_type="distribution_center",
            city="Paris",
            country_code="FR",
            lat=48.85,
            lon=2.35,
            facility_code="DC",
        ),
    ]

