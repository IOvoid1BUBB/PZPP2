#!/usr/bin/env bash
# entrypoint.sh — migracje, seed pojazdów, seed ofert (europejskich lub legacy), uvicorn.
set -euo pipefail

echo "[entrypoint] Uruchamiam migracje Alembic..."
alembic upgrade head

echo "[entrypoint] Seed: pojazdy..."
python scripts/seed_vehicles.py

if [ "${SEED_EUROPEAN_LOADS:-1}" = "1" ]; then
  echo "[entrypoint] Seed: europejskie oferty (${SEED_OFFER_COUNT:-1200})..."
  python scripts/seed_european_loads.py --count "${SEED_OFFER_COUNT:-1200}"
else
  echo "[entrypoint] Seed: oferty rynkowe hub PL+DACH (${SEED_OFFER_COUNT:-200})..."
  python scripts/seed_market_offers.py --count "${SEED_OFFER_COUNT:-200}"
fi

echo "[entrypoint] Start API..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
