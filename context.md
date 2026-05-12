# Kontekst projektu (architektura i zależności)

## Cel

Aplikacja wspiera planowanie tras i kalkulację kosztów (m.in. paliwo, przystanki, ograniczenia biznesowe). Backend udostępnia API (FastAPI); frontend będzie rozwijany w katalogu `frontend/`.

## Routing — OpenRouteService (ORS)

- Lekki model z **zewnętrznym API OpenRouteService** ([api.openrouteservice.org](https://api.openrouteservice.org)). Lokalnie uruchamiamy tylko bazę, Redis i API; klucz API trafia do zmiennych środowiskowych.
- **Backend:** `ORS_API_KEY` — m.in. healthcheck (`GET /health` pole `ors`) i przyszłe wywołania serwisu po stronie serwera.
- **Frontend (plan):** `NEXT_PUBLIC_ORS_API_KEY` — tylko jeśli zapytania do ORS mają iść z przeglądarki; w produkcji rozważ proxy przez backend, żeby nie eksponować klucza publicznie bez potrzeby.

## Monorepo

- `backend/` — Python, FastAPI, Dockerfile pod serwis `api`.
- `frontend/` — na razie pusty katalog (szkielet pod Next.js).

## Infrastruktura lokalna (Docker Compose)

Serwisy: **db** (PostGIS), **redis**, **api**. ORS jest używany przez HTTPS spoza Compose (brak lokalnego kontenera routingu).

Pytania infrastrukturalne można kierować do roli **DevOps** w opisie zespołu (np. materiały kursowe / board).
