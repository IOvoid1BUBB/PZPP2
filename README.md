# LoadMax — planowanie tras i optymalizacja transportu

System wspiera **logistykę i TMS** w skali Europy: konsolidację ładunków, planowanie tras, **Vehicle Routing Problem (VRP)**, kalkulację **zysku netto** (paliwo, myto, czas pracy, przystanki) oraz kontrolę **zgodności kierowcy z rozporządzeniem UE 561/2006**. Architektura jest **lekka i skalowalna**: obliczenia i reguły biznesowe koncentrują się w backendzie, routing odbywa się przez **hostowane API OpenRouteService (ORS)**, a frontend odpowiada wyłącznie za **UI i interakcje**.

---

## Moduły aplikacji

| Moduł | Ścieżka | Opis |
|-------|---------|------|
| **Dashboard** | `/dashboard` | KPI operacyjne, mapa Europy z pozycjami floty, alerty, podgląd aktywnej sesji i symulacja pozycji kierowcy. |
| **Planning lab** | `/planner` | Wybór pojazdu, biblioteka ofert, edytor slotów palet (drag-and-drop), solver VRP, mapa trasy z heat-mapą obciążenia. |
| **Fleet manager** | `/fleet` | CRUD pojazdów floty, profile kierowców, przypisanie sesji, statusy (`draft` → `confirmed` → `in_transit`). |
| **Market hub** | `/market` | Przegląd ofert rynkowych, heat-mapa destynacji, wykres EUR/LDM, dodawanie ofert do sesji. |
| **Analytics** | `/analytics` | Waterfall kosztów i zysku, trendy tygodniowe (przychód, fill-rate) dla wybranej sesji. |
| **Sesja (szczegóły)** | `/sessions/[id]` | Widok sesji konsolidacyjnej z metrykami i akcjami. |
| **Mapa sesji** | `/sessions/[id]/map` | Pełnoekranowa mapa trasy dla sesji. |

---

## Domena biznesowa

- **VRP i wybór ofert** — solver **OR-Tools CP-SAT** maksymalizuje szacowany zysk netto przy ograniczeniach LDM, masy, liczby przystanków i okien czasowych. Alternatywnie: greedy mock (`USE_SOLVER_MOCK=true`) do CI i szybkich testów.
- **Koszty operacyjne** — paliwo (w tym wpływ masy ładunku), utrzymanie pojazdu (EUR/km), dzienna dieta kierowcy, koszt postojów, **myto** (geometrie krajów z danych OSM).
- **Reguły UE** — `DriverComplianceService` sprawdza plan trasy względem **rozporządzenia 561/2006** (czas jazdy, przerwy).
- **Rynek europejski** — generator ofert na bazie katalogu `european_logistics_sites.json`; tło odświeża pulę ofert co 5 minut.
- **Cel produktowy** — narzędzie pod realne **planowanie floty** w Europie (sieć dróg OSM, koszty w EUR).

Te elementy pozostają w **logice biznesowej backendu**. ORS dostarcza wyłącznie **metryki sieci** (odległości, czasy, geometria).

---

## Architektura systemu

| Warstwa | Technologie | Rola |
|--------|-------------|------|
| **Frontend** | **Next.js 16**, React 19, **Tailwind CSS 4**, **Leaflet** / React Leaflet, Zustand, SWR, Recharts, dnd-kit | Renderowanie map, wykresów, edytor slotów, interakcje. Proxy `/api/*` → backend. **Bez** optymalizacji tras i liczenia kosztów po stronie przeglądarki. |
| **Backend** | **Python 3.14**, **FastAPI**, SQLAlchemy async, Alembic | Logika biznesowa, kalkulatory, solver CP-SAT, integracja ORS, cache Redis, REST API `/api/v1`. |
| **Routing** | **OpenRouteService** (hosted API) | Geometria trasy, macierz odległości/czasów, profil HGV (`driving-hgv`). Mock haversine: `USE_ROUTING_MOCK=true`. |
| **Dane** | **PostgreSQL 16** + **PostGIS**, **Redis 7** | Trwałe dane operacyjne; cache ORS i wyników API sesji. |

Środowisko developerskie: **Docker Compose** (`db`, `redis`, `api`, `frontend`). Routing wymaga klucza **ORS_API_KEY** ([openrouteservice.org](https://openrouteservice.org/)).

---

## Przepływ działania (end-to-end)

1. Użytkownik tworzy **sesję konsolidacyjną** i wybiera pojazd (katalog 4 typów: Master L2/L3/L4, MAN Solówka).
2. Oferty rynkowe są **rankingowane** (`GET …/ranked-offers`) lub dodawane ręcznie z Market hub.
3. **Solver** (`POST …/optimize` → 202) wybiera optymalny podzbiór ofert; frontend polluje `GET …/optimize/status`.
4. Backend żąda od **ORS** macierzy i — po ustaleniu kolejności — **geometrii** tras.
5. Backend liczy **profit breakdown** (5 kategorii kosztów + przychód), **zgodność kierowcy** i buduje **route-map** z obciążeniem per odcinek.
6. Frontend renderuje geometrię na mapie Leaflet i wizualizuje KPI — bez ponownego liczenia biznesu w przeglądarce.

---

## API (skrót)

Główny prefiks: `/api/v1`. Dokumentacja interaktywna: `http://localhost:8000/docs`.

| Grupa | Prefix | Kluczowe operacje |
|-------|--------|-------------------|
| Dashboard | `/dashboard` | KPI i ostatnie sesje |
| Sesje | `/sessions` | CRUD, oferty, profit, route, route-map, simulate, driver-compliance |
| Solver | `/sessions/{id}/optimize` | Start (202), status, cancel |
| Planner | `/planner` | Layout slotów palet (GET/PUT/move/swap) |
| Oferty | `/offers` | Lista ofert rynkowych |
| Flota | `/fleet` | CRUD pojazdów floty, route-stops (symulacja) |
| Pojazdy | `/vehicles` | Katalog typów pojazdów |
| Kierowcy | `/driver-profiles` | Profile kierowców |
| Health | `/health`, `/health/ready` | Liveness i readiness (db, redis, routing) |

---

## OpenRouteService (routing)

- **Rejestracja** — konto na [openrouteservice.org](https://openrouteservice.org/) → klucz API.
- **Konfiguracja** — `ORS_API_KEY` w `.env` (patrz `.env.example`).
- **Profil** — domyślnie `driving-hgv`.
- **Limity** — plan Standard: ok. 2000 directions/dzień, 500 matrix/dzień; cache Redis (`ors:route:`, `ors:matrix:`) ogranicza zużycie.
- **Dev bez klucza** — `USE_ROUTING_MOCK=true` (haversine zamiast ORS).

Szczegóły setupu: **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

---

## Zasady wydajności

- **Frontend renderuje dane** — backend wykonuje obliczenia biznesowe i optymalizacyjne.
- **ORS** odpowiada wyłącznie za routing w sieci drogowej.
- **Redis** cache'uje macierze i trasy ORS oraz zagregowane odpowiedzi API sesji.
- **Geometria** pobierana dopiero po ustabilizowaniu kolejności punktów — mniej zapytań niż przy każdej permutacji.
- Frontend odświeża mapę trasy z **debounce 800 ms** po zmianach layoutu.

---

## Repozytorium

```
PZPP2/
├── backend/          # FastAPI, serwisy, modele, migracje Alembic, testy pytest
│   ├── app/
│   │   ├── api/      # Routery REST
│   │   ├── services/ # VRP, profit, fuel, toll, compliance, …
│   │   ├── lib/      # ORS, routing, geo, redis
│   │   └── models/   # SQLAlchemy + PostGIS
│   ├── alembic/      # Migracje bazy
│   ├── data/         # Katalog europejskich lokalizacji logistycznych
│   └── scripts/      # Seed, geocoding, katalog
├── frontend/         # Next.js 16, komponenty UI, testy Vitest + Playwright
├── docker-compose.yml
├── .env.example
├── CONTRIBUTING.md   # Setup developera, testy, troubleshooting
└── context.md        # Zwięzły kontekst architektoniczny
```

---

## Testy

| Warstwa | Narzędzie | Uruchomienie |
|---------|-----------|--------------|
| Backend | pytest (~470 testów) | `cd backend && pytest -q` |
| Frontend (unit) | Vitest | `cd frontend && npm test` |
| E2E | Playwright | `cd frontend && npm run e2e` (wymaga Docker stack) |

Szczegóły: **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

---

## Licencje i zewnętrzne dane

Dane drogowe pochodzą z **OpenStreetMap** (ODbL), serwowane przez **OpenRouteService**. Użycie API podlega warunkom ORS i licencji danych OSM.
