# LoadMax — planowanie tras i optymalizacja transportu

System wspiera **logistykę i TMS** w skali Europy: planowanie tras, **Vehicle Routing Problem (VRP)** oraz **kalkulację kosztów** (paliwo, czas pracy, przystanki, parametry biznesowe). Architektura jest **lekka, wysokowydajna i skalowalna**: obliczenia i reguły biznesowe koncentrują się w backendzie, routing odbywa się przez **hostowane API OpenRouteService (ORS)**, a frontend odpowiada wyłącznie za **UI i interakcje**.

---

## Domena biznesowa i matematyka transportowa

- **VRP i pokrewne modele** — redukcja kosztów przez sensowną kolejność przystanków i pojazdów przy ograniczeniach (czas, pojemność, liczba przystanków).
- **Koszty operacyjne** — m.in. paliwo (w tym wpływ masy ładunku na zużycie), utrzymanie pojazdu, dzienne diety kierowcy, koszt postojów.
- **Reguły UE** — czas pracy kierowcy oraz **tachograf** jako warstwa ograniczeń nakładana na plan tras (nie na sam silnik routingu).
- **Cel produktowy** — narzędzie pod realne **planowanie floty** i integracje TMS, z naciskiem na **Europę** (sieć dróg OSM, spójne założenia kosztowe w EUR).

Te elementy pozostają w **logice biznesowej backendu**; dostawca routingu dostarcza wyłącznie **metryki sieci** (odległości, czasy, geometria), bez „rozumienia” kosztów firmy ani przepisów socjalnych.

---

## Architektura systemu

| Warstwa | Technologie | Rola |
|--------|----------------|------|
| **Frontend** | React lub Next.js, **Leaflet** / **React Leaflet** | Renderowanie mapy, markery, wyświetlanie tras, interakcje użytkownika, wizualizacja statystyk z API. **Bez** optymalizacji tras, liczenia kosztów transportu i ciężkich obliczeń. |
| **Backend** | **Python**, **FastAPI** | Logika biznesowa, kalkulacja kosztów, czas pracy kierowcy, zasady tachografu UE, optymalizacja tras, integracja z ORS API, cache, agregacja danych. |
| **Routing engine** | **OpenRouteService** (hosted API) | Geometria trasy, macierz odległości/czasów, ETA, profil HGV (`driving-hgv`). **Bez** logiki biznesowej, kosztów transportu i zarządzania czasem pracy. |
| **Dane i wydajność** | **PostgreSQL** (PostGIS), **Redis** | Trwałe dane operacyjne; cache odpowiedzi ORS (macierze, trasy) dla powtarzalnych zapytań i niższego obciążenia API. |

Środowisko developerskie i docelowe uruchomienie opisuje **Docker Compose** z serwisami: **frontend**, **api** (backend), **db** (postgres), **redis**. Routing wymaga klucza **ORS_API_KEY** (darmowy plan Standard na [openrouteservice.org](https://openrouteservice.org/)).

---

## Przepływ działania (end-to-end)

1. **Frontend** wysyła do API zestaw **waypointów** (np. kolejność zaproponowana przez użytkownika lub wstępna trasa).
2. **Backend** żąda od **ORS** **macierzy** odległości/czasów (oraz ewentualnie pojedynczych odcinków) dla potrzebnej pary/k zbioru punktów.
3. **Backend** wykonuje **optymalizację** (kolejność przystanków / przydział do pojazdów) na podstawie macierzy i ograniczeń biznesowych.
4. **Backend** liczy **koszty** oraz **ograniczenia kierowcy** (np. czas jazdy, przerwy, zgodność z regułami pracy).
5. **Backend** po zamknięciu optymalizacji pobiera z ORS **finalną geometrię** tras dla wybranej kolejności punktów.
6. **Frontend** **renderuje** gotową geometrię i metadane (np. legenda, statystyki) — bez ponownego „liczenia” biznesu po stronie przeglądarki.

---

## OpenRouteService (routing)

- **Rejestracja** — załóż konto na [openrouteservice.org](https://openrouteservice.org/) i wygeneruj klucz API.
- **Konfiguracja** — ustaw `ORS_API_KEY` w pliku `.env` (patrz `.env.example`).
- **Profil** — domyślnie `driving-hgv` (ciężarówki / HGV).
- **Limity** — plan Standard: ok. 2000 directions/dzień, 500 matrix/dzień; cache Redis (`ors:route:`, `ors:matrix:`) ogranicza zużycie.

Szczegóły setupu: **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

---

## Zasady wydajności (Performance Principles)

- **Frontend renderuje dane** — backend wykonuje wszystkie obliczenia biznesowe i optymalizacyjne.
- **ORS odpowiada wyłącznie za routing** w sieci drogowej (metryki i geometria).
- **Optymalizacja** przebiega po stronie **backendu**, na macierzach i regułach domenowych.
- **Redis** przechowuje cache **macierzy** oraz **odpowiedzi tras** (kluczowane po zestawie współrzędnych w kolejności), aby ograniczyć powtarzalne wywołania ORS.
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

Jako kierunek solverów dyskretnych przewidziana jest integracja z **Google OR-Tools** (np. VRP z macierzą kosztów z backendu), przy czym **ORS** nadal dostarcza wyłącznie dane sieciowe.

---

## Repozytorium

- `backend/` — FastAPI, logika biznesowa, integracja ORS, cache.
- `frontend/` — UI (React lub Next.js), mapa Leaflet.
- `docker-compose.yml` — orkiestracja stacku (db, redis, api, frontend).
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — setup developera, ORS, Redis, Compose.
- **[CONTEXT.md](./CONTEXT.md)** — zwięzły kontekst architektoniczny dla całego zespołu.

---

## Licencje i zewnętrzne dane

Dane drogowe pochodzą z **OpenStreetMap** (ODbL), serwowane przez **OpenRouteService**. Użycie API podlega warunkom ORS i licencji danych OSM.
