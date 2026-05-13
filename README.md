# LoadMax — planowanie tras i optymalizacja transportu

System wspiera **logistykę i TMS** w skali Europy: planowanie tras, **Vehicle Routing Problem (VRP)** oraz **kalkulację kosztów** (paliwo, czas pracy, przystanki, parametry biznesowe). Architektura jest **lekka, wysokowydajna i skalowalna**: obliczenia i reguły biznesowe koncentrują się w backendzie, silnik routingu jest **osobnym serwisem**, a frontend odpowiada wyłącznie za **UI i interakcje**.

---

## Domena biznesowa i matematyka transportowa

- **VRP i pokrewne modele** — redukcja kosztów przez sensowną kolejność przystanków i pojazdów przy ograniczeniach (czas, pojemność, liczba przystanków).
- **Koszty operacyjne** — m.in. paliwo (w tym wpływ masy ładunku na zużycie), utrzymanie pojazdu, dzienne diety kierowcy, koszt postojów.
- **Reguły UE** — czas pracy kierowcy oraz **tachograf** jako warstwa ograniczeń nakładana na plan tras (nie na sam silnik routingu).
- **Cel produktowy** — narzędzie pod realne **planowanie floty** i integracje TMS, z naciskiem na **Europę** (sieć dróg OSM, spójne założenia kosztowe w EUR).

Te elementy pozostają w **logice biznesowej backendu**; silnik routingu dostarcza wyłącznie **metryki sieci** (odległości, czasy, geometria), bez „rozumienia” kosztów firmy ani przepisów socjalnych.

---

## Architektura systemu

| Warstwa | Technologie | Rola |
|--------|----------------|------|
| **Frontend** | React lub Next.js, **Leaflet** / **React Leaflet** | Renderowanie mapy, markery, wyświetlanie tras, interakcje użytkownika, wizualizacja statystyk z API. **Bez** optymalizacji tras, liczenia kosztów transportu i ciężkich obliczeń. |
| **Backend** | **Python**, **FastAPI** | Logika biznesowa, kalkulacja kosztów, czas pracy kierowcy, zasady tachografu UE, optymalizacja tras, integracja z OSRM, cache, agregacja danych. |
| **Routing engine** | **OSRM** (kontener Docker) | Geometria trasy, macierz odległości/czasów, ETA, najkrótsza / najszybsza ścieżka w sieci OSM. **Bez** logiki biznesowej, kosztów transportu i zarządzania czasem pracy. |
| **Dane i wydajność** | **PostgreSQL** (PostGIS), **Redis** | Trwałe dane operacyjne; cache odpowiedzi OSRM (macierze, trasy) dla powtarzalnych zapytań i niższego obciążenia OSRM. |

Środowisko developerskie i docelowe uruchomienie opisuje **Docker Compose** z serwisami: **frontend**, **backend**, **osrm**, **postgres**, **redis**. **Nie** zakładamy zewnętrznego **OpenRouteService** jako głównego silnika routingu — routing jest **lokalny** (OSRM w sieci Dockera).

---

## Przepływ działania (end-to-end)

1. **Frontend** wysyła do API zestaw **waypointów** (np. kolejność zaproponowana przez użytkownika lub wstępna trasa).
2. **Backend** żąda od **OSRM** **macierzy** odległości/czasów (oraz ewentualnie pojedynczych odcinków) dla potrzebnej pary/k zbioru punktów.
3. **Backend** wykonuje **optymalizację** (kolejność przystanków / przydział do pojazdów) na podstawie macierzy i ograniczeń biznesowych.
4. **Backend** liczy **koszty** oraz **ograniczenia kierowcy** (np. czas jazdy, przerwy, zgodność z regułami pracy).
5. **Backend** po zamknięciu optymalizacji pobiera z OSRM **finalną geometrię** tras (np. `route` / `match`) dla wybranej kolejności punktów.
6. **Frontend** **renderuje** gotową geometrię i metadane (np. legenda, statystyki) — bez ponownego „liczenia” biznesu po stronie przeglądarki.

---

## OSRM i dane OpenStreetMap (Europa)

- **Extract** — pobierasz **Europe** (lub mniejszy region) z [Geofabrik](https://download.geofabrik.de/) lub innego dostawcy plików `.osm.pbf`.
- **Preprocessing** (typowy łańcuch OSRM): `osrm-extract` → `osrm-partition` → `osrm-customize` (profil `car` / `truck` według potrzeb), następnie uruchomienie `osrm-routed` (lub odpowiednika w obrazie Docker) z przygotowanymi plikami `.osrm*`.
- **Skala** — pełny extract Europy wymaga **odpowiedniej RAM i dysku** na hoście CI/CD lub maszynie developerskiej; na start zespołu często wystarcza **mniejszy region**; produkcyjnie planuje się **dedykowany** host pod OSRM lub repliki w read-only.

Szczegóły komend i healthchecków: **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

---

## Zasady wydajności (Performance Principles)

- **Frontend renderuje dane** — backend wykonuje wszystkie obliczenia biznesowe i optymalizacyjne.
- **OSRM odpowiada wyłącznie za routing** w sieci drogowej (metryki i geometria).
- **Optymalizacja** przebiega po stronie **backendu**, na macierzach i regułach domenowych.
- **Redis** przechowuje cache **macierzy** oraz **odpowiedzi tras** (kluczowane m.in. po zestawie współrzędnych i profilu), aby ograniczyć powtarzalne wywołania OSRM.
- **Geometria trasy** jest pobierana **dopiero po** ustabilizowaniu kolejności punktów z optymalizacji — mniej zapytań o pełne polyline niż przy „na żywo” na każdą permutację.
- Projekt dąży do **niskiego zużycia zasobów** przy zachowaniu sensownego SLA dla floty w Europie.

---

## Cele skalowalności (Scalability Goals)

Planowany rozwój obejmuje m.in.:

- **VRP** / **TSP** oraz **optymalizację wielopojazdową**,
- **fleet management** i **harmonogramowanie kierowców**,
- **real-time ETA** (na bazie świeżych macierzy i odświeżanego cache),
- symulację **paliwa** i **myta**,
- pełniejsze modelowanie **regul tachografu UE**.

Jako kierunek solverów dyskretnych przewidziana jest integracja z **Google OR-Tools** (np. VRP z macierzą kosztów z backendu), przy czym **OSRM** nadal dostarcza wyłącznie dane sieciowe.

---

## Repozytorium

- `backend/` — FastAPI, logika biznesowa, integracja OSRM, cache.
- `frontend/` — UI (React lub Next.js), mapa Leaflet.
- `docker-compose.yml` — orkiestracja stacku (w tym OSRM).
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — setup developera, OSRM, Redis, Compose.
- **[CONTEXT.md](./CONTEXT.md)** — zwięzły kontekst architektoniczny dla całego zespołu.

---

## Licencje i zewnętrzne dane

Dane drogowe pochodzą z **OpenStreetMap** (ODbL). Profil i reguły OSRM muszą być zgodne z licencją danych i polityką produktu.
