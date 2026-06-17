from __future__ import annotations

from app.services.market_simulator import (
    PALLET_LDM,
    adjust_rate_for_pallet_count,
    pallet_count_from_ldm,
)


def test_small_shipments_have_higher_per_pallet_rate_than_6_plus() -> None:
    base_rate = 0.13
    distance_km = 100.0

    ldm_1_pallet = PALLET_LDM
    ldm_6_pallets = round(6 * PALLET_LDM, 1)

    rate_small = adjust_rate_for_pallet_count(base_rate, pallet_count_from_ldm(ldm_1_pallet))
    rate_large = adjust_rate_for_pallet_count(base_rate, pallet_count_from_ldm(ldm_6_pallets))

    # price per pallet = PALLET_LDM * km * rate  (since price = ldm * km * rate)
    per_pallet_small = PALLET_LDM * distance_km * rate_small
    per_pallet_large = PALLET_LDM * distance_km * rate_large

    assert per_pallet_small > per_pallet_large

