# Kontekst projektu (architektura i zależności)

## Cel

Aplikacja wspiera **planowanie tras**, **optymalizację transportu** i **kalkulację kosztów** w kontekście **logistyki i TMS dla Europy**. Backend (**FastAPI**, Python) realizuje całą **logikę biznesową** oraz obliczenia; frontend odpowiada za **prezentację** i interakcje. Architektura jest **lekka i wysokowydajna**: routing jest wydzielony do osobnego procesu, a warstwa API skupia się na agregacji, cache i regułach domenowych.

## Routing — lokalny OSRM

- **OSRM** działa jako **osobny serwis w Dockerze** (sieć wewnętrzna Compose), bez zależności od zewnętrznego **OpenRouteService** jako głównego dostawcy routingu.
- **Odpowiedzialność OSRM:** geometria trasy, **macierz** odległości/czasów, **ETA**, najkrótsza / najszybsza ścieżka w grafie drogowym OSM.
- **Poza zakresem OSRM:** logika biznesowa, **koszty transportu**, **spalanie**, **myto**, **czas pracy kierowcy**, **tachograf UE** — to wyłącznie **backend**.

Dane: **Europe-wide routing** opiera się na **extractach OSM** (np. Europa z Geofabrika lub mniejszy region na development); preprocessing (`extract` → `partition` → `customize`) przygotowuje pliki serwowane przez `osrm-routed`.

## Backend FastAPI — odpowiedzialności

- Integracja z **OSRM** (table / route / match — zgodnie z implementacją).
- **Kalkulacja:** spalania (w tym czynniki zależne od masy), **myto** (gdy wprowadzono warstwę danych), **czasu pracy kierowcy**, **kosztów transportu** (paliwo, postoje, diety, utrzymanie itd.).
- **Ograniczenia** zgodne z przepisami (**tachograf UE**) nakładane na wynik planowania, nie na silnik routingu.
- **Cache Redis:** odpowiedzi **macierzy** i **tras** z OSRM oraz ewentualnie zagregowane wyniki zapytań API — mniejsze obciążenie OSRM i krótszy czas odpowiedzi.

## Frontend

- **React** lub **Next.js** z **Leaflet** / **React Leaflet**: mapa, markery, polyline, statystyki z API.
- Frontend **nie** wykonuje optymalizacji, **nie** liczy kosztów operacyjnych ani ciężkich symulacji — tylko wywołuje API i wizualizuje wynik.

## Monorepo

- `backend/` — Python, FastAPI, moduły domenowe (w rozwoju: `services/routing`, `services/optimization`, `services/costs`, `services/drivers`).
- `frontend/` — aplikacja kliencka.

## Infrastruktura (Docker Compose — docelowy zestaw)

Serwisy: **frontend**, **backend**, **osrm**, **postgres** (PostGIS), **redis**. Routing jest **lokalny**; brak wymogu konta u zewnętrznego dostawcy ORS dla podstawowego dev stacku.

## Przyszła integracja OR-Tools

Planowane jest użycie **OR-Tools** do solverów **VRP** / **TSP** / przypisań wielopojazdowych, z **kosztami krawędzi** wyliczanymi w backendzie (na podstawie macierzy z OSRM i reguł biznesowych). OSRM pozostaje **czystym** dostawcą metryk sieciowych.

Pytania infrastrukturalne można kierować do roli **DevOps** w materiałach zespołu; zmiany w tym pliku — przez merge request z krótkim uzasadnieniem.
