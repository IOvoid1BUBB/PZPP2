# CONTRIBUTING — LoadMax

Ten dokument opisuje **setup od zera**, **rolę Dockera**, **routing przez OpenRouteService (ORS)**, **testy** oraz **konwencje pracy** w repozytorium.

---

## Docker w dwóch zdaniach

**Docker Compose** uruchamia aplikację wraz z Postgres (PostGIS), Redis, API i frontendem w **izolowanych kontenerach**. Każdy developer ma ten sam stack — bez ręcznej instalacji PostgreSQL na laptopie.

**Routing** obsługuje **hostowane API OpenRouteService** — backend woła `https://api.openrouteservice.org` z kluczem `ORS_API_KEY`. Lokalnego silnika routingu w Dockerze nie ma; w dev/CI można użyć `USE_ROUTING_MOCK=true`.

---

## Wymagania wstępne

1. **Docker** i **Docker Compose** (v2).
2. **Klucz ORS** — [openrouteservice.org](https://openrouteservice.org/) → API keys. Plan Standard (darmowy): ok. 2000 directions/dzień, 500 matrix/dzień.
3. **Git** — klon repozytorium.
4. Opcjonalnie (tryb lokalny bez pełnego Compose): **Python 3.14**, **Node.js 22**.

---

## Szybki start

```bash
cd PZPP2
cp .env.example .env
# Edytuj .env — wklej ORS_API_KEY (lub ustaw USE_ROUTING_MOCK=true do testów bez ORS)
docker compose up -d --build
```

Po starcie:

| Usługa | URL |
|--------|-----|
| Frontend | http://localhost:3000 |
| API | http://localhost:8000 |
| Swagger | http://localhost:8000/docs |
| Readiness | http://localhost:8000/health/ready |

Weryfikacja:

```bash
curl -s http://localhost:8000/health/ready | python3 -m json.tool
```

Pole `checks.routing.ok` powinno być `true` (prawdziwy ORS) lub stack uruchomiony z `USE_ROUTING_MOCK=true`.

### Dane startowe w Compose (dev)

Przy `docker compose up` kontener `api` wykonuje:

1. `alembic upgrade head` — migracje bazy
2. `scripts/seed_vehicles.py` — katalog 4 typów pojazdów
3. `uvicorn --reload`

Pełny seed (oferty europejskie + pojazdy floty) z `entrypoint.sh` **nie** jest uruchamiany w trybie dev Compose. Zamiast tego:

- API w tle wstawia **50 nowych ofert co 5 minut** (pętla `offer_refresh` w `main.py`),
- oferty można wygenerować ręcznie: `POST /api/v1/sessions/{id}/simulate?count=200`,
- pełny seed (opcjonalnie):

```bash
docker compose exec api python scripts/seed_european_loads.py --count 1200
docker compose exec api python scripts/seed_fleet_vehicles.py
```

---

## Zmienne środowiskowe (`.env`)

| Zmienna | Opis |
|---------|------|
| `DATABASE_URL` | Połączenie async do Postgres (`db:5432` w Compose, `localhost:5432` na hoście) |
| `REDIS_URL` | Redis (`redis:6379/0` w Compose) |
| `ORS_API_KEY` | Klucz z openrouteservice.org (**wymagany** bez mocka) |
| `ORS_BASE_URL` | Domyślnie `https://api.openrouteservice.org` |
| `ORS_PROFILE` | Domyślnie `driving-hgv` |
| `USE_SOLVER_MOCK` | `true` — greedy mock solver (CI/E2E); `false` — OR-Tools CP-SAT |
| `USE_ROUTING_MOCK` | `true` — haversine zamiast ORS (dev/CI bez klucza) |
| `FUEL_PRICE_EUR_PER_LITER` | Cena paliwa w kalkulacji kosztów |
| `DRIVER_DAILY_ALLOWANCE_EUR` | Dzienna dieta kierowcy |
| `STOP_COST_MINUTES` | Koszt czasowy jednego przystanku |
| `MAX_STOPS_PER_ROUTE` | Twarde ograniczenie liczby przystanków w solverze |
| `WEIGHT_FUEL_FACTOR` | Wpływ masy na spalanie |
| `MAINTENANCE_EUR_PER_KM` | Koszt eksploatacji na km |
| `NOMINATIM_USER_AGENT` | User-Agent dla reverse geocoding etykiet |
| `SEED_EUROPEAN_LOADS` | `1` / `0` — tylko przy `entrypoint.sh` (produkcja) |
| `SEED_OFFER_COUNT` | Liczba ofert przy pełnym seedzie (domyślnie 1200) |
| `BACKEND_URL` | URL backendu dla Next.js rewrites (domyślnie `http://api:8000` w Dockerze) |

Pełna lista z komentarzami: `.env.example`.

`MAX_STOPS_PER_ROUTE` współpracuje z `vehicle.max_stops` — solver bierze minimum obu wartości.

---

## Struktura projektu

### Backend (`backend/`)

```
app/
├── api/           # Routery REST (/api/v1/…)
├── core/          # Config, DB, middleware, rate limit, exceptions
├── lib/           # ors.py, routing.py, geo, redis_client
├── models/        # SQLAlchemy (sesje, oferty, flota, pojazdy, …)
├── schemas/       # Pydantic v2
└── services/      # Logika biznesowa
    ├── vrp_solver.py          # OR-Tools CP-SAT
    ├── profit_calculator.py   # 5-kategoryjny breakdown
    ├── fuel_calculator.py
    ├── toll_calculator.py
    ├── driver_compliance.py   # UE 561/2006
    ├── offer_scorer.py
    ├── route_geometry.py
    └── …
alembic/           # Migracje (PostGIS)
data/              # european_logistics_sites.json, granice krajów
scripts/           # Seed, geocoding, budowa katalogu
tests/             # pytest (~470 testów)
```

### Frontend (`frontend/`)

```
app/
├── (dashboard)/   # dashboard, planner, fleet, market, analytics
└── sessions/[id]/ # szczegóły sesji i mapa
components/        # UI, mapa, planner, fleet, market
lib/
├── api/           # Klienty HTTP (sessionClient, fleetClient, …)
├── stores/        # Zustand (session, vehicle, load)
└── …              # Kalkulatory UI, typy, hooki
tests/e2e/         # Playwright
```

Frontend **nie** woła ORS bezpośrednio — tylko `/api/*` (proxy Next.js → backend).

---

## Optymalizacja sesji (async)

1. `POST /api/v1/sessions/{id}/optimize` → **202** `{ status: "RUNNING", … }`
2. Solver działa w tle (Redis job store + `solver_runner`)
3. `GET /api/v1/sessions/{id}/optimize/status` — poll co ~300 ms aż `status` ≠ `RUNNING`
4. `result` zawiera `SolverRunResult` (wybrane oferty, `objective_value`, `solver_status`)
5. `DELETE …/optimize` — anulowanie bieżącej optymalizacji

Frontend (`sessionClient.runSessionOptimize`) obsługuje polling automatycznie.

---

## Backend lokalnie (bez pełnego Compose)

Python na hoście + Postgres i Redis z Compose:

```bash
# Terminal 1 — tylko db + redis
docker compose up -d db redis

# Terminal 2 — backend
cd backend
python3.14 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL=postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax
export REDIS_URL=redis://localhost:6379/0
export ORS_API_KEY=your_key_here
# opcjonalnie:
export USE_ROUTING_MOCK=true
export USE_SOLVER_MOCK=true

alembic upgrade head
python scripts/seed_vehicles.py
pytest -q
uvicorn app.main:app --reload --port 8000
```

---

## Frontend lokalnie (bez kontenera frontend)

Wymaga działającego backendu (Compose `api` lub uvicorn na hoście):

```bash
cd frontend
npm ci --legacy-peer-deps
export BACKEND_URL=http://localhost:8000
npm run dev:local
```

> `npm run dev` celowo kończy się błędem — domyślny workflow to Docker. Użyj `dev:local` tylko gdy świadomie uruchamiasz Next.js na hoście.

Build produkcyjny (jak w Dockerfile):

```bash
BACKEND_URL=http://localhost:8000 npm run build
npm start
```

---

## Testy

### Backend (pytest)

```bash
cd backend
pip install -r requirements-dev.txt
export DATABASE_URL=postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax
export ORS_API_KEY=test-key
export USE_ROUTING_MOCK=true
export USE_SOLVER_MOCK=true
pytest -q
```

- Testy routingu mockują HTTP (**respx**) — nie wymagają prawdziwego klucza ORS.
- Testy `@pytest.mark.integration` są pomijane, gdy Postgres nie odpowiada.
- Lint i typy: `ruff check app tests`, `mypy app` (konfiguracja w `pyproject.toml`).

### Frontend (Vitest)

```bash
cd frontend
npm ci --legacy-peer-deps
npm test
```

### E2E (Playwright)

Wymaga Docker stack. Playwright uruchamia `docker compose up -d --build` automatycznie (chyba że `PW_REUSE=1` i stack już działa):

```bash
cd frontend
npm run e2e:install   # jednorazowo: Chromium
npm run e2e
```

Domyślnie E2E ustawia `USE_SOLVER_MOCK=true` i `USE_ROUTING_MOCK=true` dla deterministycznych wyników.

Scenariusze w `frontend/tests/e2e/`:

- `consolidation_flow.spec.ts` — pełny flow: pojazd → sesja → simulate → solver → confirm
- `routing_smoke.spec.ts` — smoke test routingu i mapy

---

## Redis — prefiksy cache

| Prefiks | TTL | Zawartość |
|---------|-----|-----------|
| `ors:route:` | 7200 s | Odpowiedzi ORS directions |
| `ors:matrix:` | 7200 s | Macierze ORS (max 15 punktów) |
| `route_map:` | — | Cache odpowiedzi route-map sesji |
| `route_geom:` | — | Cache geometrii trasy sesji |
| solver job keys | — | Status bieżącej optymalizacji |

---

## Docker Compose — serwisy

| Serwis | Port | Obraz / build | Rola |
|--------|------|---------------|------|
| `db` | 5432 | postgis/postgis:16-3.4-alpine | PostgreSQL + PostGIS |
| `redis` | 6379 | redis:7-alpine | Cache i job store solvera |
| `api` | 8000 | `backend/Dockerfile` | FastAPI (Python 3.14), hot-reload w dev |
| `frontend` | 3000 | `frontend/Dockerfile` | Next.js 16 standalone |

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f frontend
docker compose down          # zatrzymanie
docker compose down -v       # + usunięcie wolumenu bazy (świeży start)
```

---

## Konwencje kodu

- **Backend**: Ruff (lint + format), mypy strict na schematach, async SQLAlchemy, Pydantic v2.
- **Frontend**: ESLint (next config), TypeScript strict, Tailwind CSS 4, komponenty w `components/`.
- **Commity**: opisowe, po polsku lub angielsku — spójnie w obrębie PR.
- **Migracje**: nowe zmiany schematu przez Alembic (`alembic revision --autogenerate`).

---

## Troubleshooting

**API unhealthy / readiness `routing: false`**  
Brak lub niepoprawny `ORS_API_KEY`. Ustaw klucz w `.env` albo `USE_ROUTING_MOCK=true`, potem: `docker compose up -d api`.

**`/health/ready` zwraca 200 z `status: degraded`**  
Sprawdź pole `checks` — db, redis lub routing mogą być niedostępne. Endpoint zwraca **200** (nie 503), aby load balancer mógł odczytać szczegóły.

**Pusty Market hub po świeżym starcie**  
Poczekaj ~30 s na pierwszy refresh ofert lub uruchom simulate/seed (patrz sekcja „Dane startowe”).

**Pusta strona Fleet**  
Uruchom `docker compose exec api python scripts/seed_fleet_vehicles.py`.

**Limit ORS przekroczony**  
Plan Standard ma dzienne limity; cache Redis ogranicza powtórzenia. Readiness cache'uje wynik checku routingu na 60 s.

**Frontend nie widzi API**  
Sprawdź, czy `api` jest healthy (`docker compose ps`). Next.js proxy wymaga `BACKEND_URL` wskazującego na działający backend.

**E2E timeout przy pierwszym uruchomieniu**  
Pierwszy build obrazów + migracje + seed mogą trwać do 3 min — Playwright ma na to `webServer.timeout: 180_000`.

---

## Checklist nowego developera

1. Zainstaluj Docker (+ opcjonalnie Node 22, Python 3.14).
2. `cp .env.example .env` — wklej `ORS_API_KEY` lub ustaw mocki.
3. `docker compose up -d --build`
4. `curl http://localhost:8000/health/ready` — sprawdź `checks`.
5. Otwórz http://localhost:3000/dashboard
6. (Opcjonalnie) pełny seed ofert i floty — komendy w sekcji „Dane startowe”.
7. `cd backend && pytest -q` oraz `cd frontend && npm test` — potwierdź, że testy przechodzą.
