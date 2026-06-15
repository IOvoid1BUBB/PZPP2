# CONTRIBUTING — LoadMax

Ten dokument jest dla całego zespołu: opisuje **minimalny zestaw narzędzi**, **rolę Dockera**, **routing przez OpenRouteService (ORS)** oraz **konkretne komendy** od zera do działającego stacku.

---

## Docker w dwóch zdaniach

**Docker** pozwala uruchomić aplikację wraz z bazą i Redisem w **izolowanych kontenerach**, zdefiniowanych w pliku `docker-compose.yml`. Dzięki temu każdy ma **ten sam** Postgres z PostGIS, ten sam Redis i te same porty — bez ręcznej instalacji PostgreSQLa na laptopie.

**Routing** obsługuje **hostowane API OpenRouteService** — backend woła `https://api.openrouteservice.org` z kluczem `ORS_API_KEY`. Nie ma lokalnego silnika routingu w Dockerze.

---

## Wymagania wstępne

1. **Docker** i **Docker Compose** (v2).
2. **Klucz ORS** — zarejestruj się na [openrouteservice.org](https://openrouteservice.org/) → API keys. Plan Standard (darmowy): ok. 2000 directions/dzień, 500 matrix/dzień.
3. **Git** — klon repozytorium.

---

## Struktura warstw (skrót)

- `frontend/` — UI (Next.js), mapa Leaflet; **nie** woła routingu.
- `backend/app/api/` — endpointy REST.
- `backend/app/services/` — logika biznesowa, kalkulatory, solver.
- `backend/app/lib/ors.py` — klient ORS (directions + matrix, cache Redis).
- `backend/app/services/routing` — modele i factory (`routing.py`).

---

## Szybki start

```bash
cd PZPP2
cp .env.example .env
# Edytuj .env — wklej ORS_API_KEY z panelu OpenRouteService
docker compose up -d --build
```

Po starcie:

- Frontend: http://localhost:3000
- API: http://localhost:8000
- Docs: http://localhost:8000/docs
- Readiness: http://localhost:8000/health/ready (sprawdza db, redis, **routing**)

---

## Zmienne środowiskowe (`.env`)

| Zmienna | Opis |
|---------|------|
| `DATABASE_URL` | Połączenie async do Postgres (domyślnie `db:5432` w Compose) |
| `REDIS_URL` | Redis (`redis:6379/0`) |
| `ORS_API_KEY` | **Wymagane** — klucz z openrouteservice.org |
| `ORS_BASE_URL` | Domyślnie `https://api.openrouteservice.org` |
| `ORS_PROFILE` | Domyślnie `driving-hgv` (HGV) |

Pozostałe (`FUEL_PRICE_EUR_PER_LITER`, `MAX_STOPS_PER_ROUTE`, …) — patrz `.env.example`.

---

## Backend lokalnie (bez pełnego Compose)

Tryb zaawansowany: Python na hoście + Postgres i Redis z Compose:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export DATABASE_URL=postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax
export REDIS_URL=redis://localhost:6379/0
export ORS_API_KEY=your_key_here
pytest -q
uvicorn app.main:app --reload --port 8000
```

---

## Testy

```bash
cd backend
pytest -q
```

Testy routingu mockują HTTP (respx) — nie wymagają prawdziwego klucza ORS w CI, ale `ORS_API_KEY` jest ustawiane w `test_ors.py` / conftest.

---

## Redis — prefiksy cache

- `ors:route:` — cache tras (TTL 7200 s)
- `ors:matrix:` — cache macierzy (TTL 7200 s, max 15 punktów)
- `route_map:`, `route_geom:` — cache odpowiedzi API sesji

---

## Docker Compose — serwisy

| Serwis | Port hosta | Rola |
|--------|-----------|------|
| `db` | 5432 | PostgreSQL + PostGIS |
| `redis` | 6379 | Cache |
| `api` | 8000 | FastAPI backend |
| `frontend` | 3000 | Next.js |

```bash
docker compose ps
docker compose logs -f api
docker compose down
```

---

## Troubleshooting

**API unhealthy / readiness `routing: false`**  
Brak lub niepoprawny `ORS_API_KEY`. Ustaw klucz w `.env` i zrestartuj: `docker compose up -d api`.

**503 na `/health/ready`**  
Sprawdź db, redis i routing — wszystkie trzy są wymagane.

**Limit ORS przekroczony**  
Plan Standard ma dzienne limity; cache Redis ogranicza powtórzenia. Rozważ upgrade planu lub mniejszą liczbę testów na produkcji.

---

## Checklist nowego developera

1. Zainstaluj Docker.
2. `cp .env.example .env` i wklej `ORS_API_KEY`.
3. `docker compose up -d --build`
4. `curl http://localhost:8000/health/ready` — `routing` powinno być `ok: true`.
5. Otwórz http://localhost:3000
