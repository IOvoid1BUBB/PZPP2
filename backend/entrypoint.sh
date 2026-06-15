#!/usr/bin/env bash
# entrypoint.sh — uruchamia pipeline startowy i API.
# Kolejność: migracje → seed pojazdów → seed ofert → uvicorn.
set -euo pipefail

echo "[entrypoint] Uruchamiam migracje Alembic..."
alembic upgrade head

echo "[entrypoint] Seed: pojazdy..."
python scripts/seed_vehicles.py

echo "[entrypoint] Seed: oferty rynkowe (docelowo 200)..."
python scripts/seed_market_offers.py --count "${SEED_OFFER_COUNT:-200}"

echo "[entrypoint] Start API..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
