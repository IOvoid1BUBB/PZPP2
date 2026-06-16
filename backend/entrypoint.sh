#!/bin/sh
# Backend container entrypoint: migrations, fleet seed, European market offers.
#
# Set SEED_EUROPEAN_LOADS=1 to run seed_european_loads.py (default count from SEED_OFFER_COUNT=1200).
# Legacy hub-only seed: SEED_EUROPEAN_LOADS=0 runs seed_market_offers.py instead.

set -e

alembic upgrade head
python scripts/seed_vehicles.py

if [ "${SEED_EUROPEAN_LOADS:-1}" = "1" ]; then
  python scripts/seed_european_loads.py --count "${SEED_OFFER_COUNT:-1200}"
else
  python scripts/seed_market_offers.py
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
