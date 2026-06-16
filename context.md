# LoadMax — kontekst architektoniczny

Dokument dla zespołu: **co robi która warstwa**, jakie są granice odpowiedzialności i jakie technologie są założone w repozytorium.

---

## Routing — OpenRouteService API

- **OpenRouteService (ORS)** działa jako **hostowany serwis HTTP** (`https://api.openrouteservice.org`), wywoływany z backendu.
- **Odpowiedzialność ORS:** geometria trasy, **macierz** odległości/czasów, **ETA**, najkrótsza / najszybsza ścieżka w grafie drogowym OSM (profil `driving-hgv`).
- **Poza zakresem ORS:** logika biznesowa, **koszty transportu**, **spalanie**, **myto**, **czas pracy kierowcy**, **tachograf UE** — to wyłącznie **backend**.

Autoryzacja: nagłówek `Authorization: <ORS_API_KEY>`. Klucz w `.env` — patrz CONTRIBUTING.md.

---

## Backend (FastAPI)

- Integracja z **ORS** (`/v2/directions/{profile}/geojson`, `/v2/matrix/{profile}`).
- Kalkulatory: paliwo, myto, koszt przystanków, zgodność kierowcy (UE 561/2006).
- Solver VRP (OR-Tools / CP-SAT) na macierzach z ORS + regułach biznesowych.
- **Cache Redis:** odpowiedzi **macierzy** i **tras** z ORS (`ors:matrix:`, `ors:route:`) oraz zagregowane wyniki zapytań API — mniejsze obciążenie ORS i krótszy czas odpowiedzi.

---

## Frontend

- **Leaflet** / React — mapa, markery, polyline tras z API.
- **Nie** woła routingu bezpośrednio — tylko endpointy backendu (`/route-map`, `/route`, itd.).

---

## Docker Compose (dev stack)

Serwisy: **frontend**, **api** (backend), **postgres** (PostGIS), **redis**. Routing jest **zewnętrzny** (ORS API); wymagany `ORS_API_KEY` w `.env`.

---

## Solvery i optymalizacja

Planowane jest użycie **OR-Tools** do solverów **VRP** / **TSP** / przypisań wielopojazdowych, z **kosztami krawędzi** wyliczanymi w backendzie (na podstawie macierzy z ORS i reguł biznesowych). ORS pozostaje **czystym** dostawcą metryk sieciowych.

Optymalizacja ofert w sesji jest **asynchroniczna**: `POST …/optimize` (202) + polling `GET …/optimize/status` aż solver zwróci wynik.
