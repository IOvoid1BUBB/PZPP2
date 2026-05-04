# 📖 Project Context: LoadMax AI
**Version:** 1.0 (May 2026)
**Role:** Strategic & Technical Foundation for Developers

---

## 1. Vision & Core Mission
**LoadMax AI** to autonomiczny system klasy TMS (Transport Management System) do **konsolidacji wieloładunkowej**. System nie jest prostą bazą danych; to silnik optymalizacyjny, który skanuje rynek (Market Simulator) i automatycznie buduje najbardziej dochodowe trasy, łącząc ładunki od wielu różnych klientów na jednej naczepie.

### Key Value Proposition:
- **Eliminacja pustych przebiegów:** Optymalizacja współczynnika załadowania (LFILL).
- **Maksymalizacja zysku netto:** Kalkulacja oparta na realnych kosztach (paliwo, myto, czas pracy).
- **Wizualna pewność:** Planowanie załadunku w oparciu o fizyczne wymiary naczepy i palet.

---

## 2. Technical Stack & Infrastructure
Każdy element stacku został wybrany pod kątem wydajności obliczeniowej i precyzji renderowania.

- **Frontend:** Next.js 16 (App Router), TypeScript, Tailwind CSS.
    - **UI Policy:** ZERO zewnętrznych UI-kitów (no shadcn). Wszystkie komponenty budujemy od zera, aby zapewnić lekkość i pełną kontrolę nad SVG/Canvas.
    - **State Management:** Zustand (synchronizacja mapy, planera i finansów).
- **Backend:** Python 3.14+, FastAPI.
    - **Optimization:** Google OR-Tools (CP-SAT Solver) dla problemów VRP i Knapsack.
    - **Routing:** Lokalna instancja OSRM (Open Source Routing Machine).
- **Database:** PostgreSQL 16 + PostGIS (obowiązkowo dla zapytań przestrzennych).
- **Infrastructure:** Docker & Docker Compose (api, db, osrm, redis).

---

## 3. System Architecture & Modules

### 3.1. Market Simulator & Scoring
Z powodu braku otwartych API giełd transportowych, system posiada moduł generujący syntetyczne oferty:
- **Scoring:** Każda oferta otrzymuje `total_score` bazujący na:
    - Gęstości przychodu ($Price / LDM$).
    - Karze za odchylenie od trasy (Detour penalty).
    - Kompatybilności okien czasowych.

### 3.2. Visual Trailer Planner (The Paka Engine)
Interaktywny widok naczepy (Bus 8/9/10 palet, Solówka 33 palety).
- **Grid System:** Naczepa podzielona na sloty o wymiarach Euro-palety (1200x800mm).
- **Multi-client Coloring:** Każdy klient w sesji konsolidacji otrzymuje unikalny kolor z palety 12 barw.
- **Collision Logic:** System blokuje umieszczenie palety "stackable: false" pod innym ładunkiem.

### 3.3. Profit & Cost Engine
Zaawansowany model matematyczny wyliczający rentowność trasy ($NetProfit$):

$$NetProfit = TotalRevenue - (FuelCost + Tolls + StopCosts + DriverCost + Maintenance)$$

- **Dynamic Fuel:** Spalanie rośnie liniowo wraz z masą ładunku (Base + 30% przy pełnym załadunku).
- **Tolls:** PostGIS wykrywa kraje tranzytowe i mnoży dystans przez lokalne stawki (MAUT, e-TOLL).
- **Stop Costs:** Każdy punkt załadunku/rozładunku dodaje koszt stały (czas obsługi + paliwo na postoju).

---

## 4. Dashboard & Navigation Map
Struktura Dashboardu (`/dashboard`):
1.  **Home (Command Center):** Widok floty na mapie (mockup ruchu GPS), szybkie statystyki zysku i alerty o wolnych LDM.
2.  **Planning Lab:** Główny widok pracy spedytora. Giełda (lewo), Trailer Visualizer (środek), Waterfall Chart (prawo).
3.  **Fleet Manager:** Zarządzanie parametrami pojazdów (spalanie, tonaż, wymiary).
4.  **Market Hub:** Widok makro giełdy i heatmapy stawek transportowych.

---

## 5. Engineering Challenges (Critical Areas)
Zespół musi skupić się na rozwiązaniu następujących problemów:
- **VRP Sequence Optimization:** Znalezienie optymalnej kolejności PU/DO (Pickup/Delivery) dla np. 5 różnych klientów (10 przystanków).
- **Weight Redistribution:** Solver powinien dążyć do równomiernego rozłożenia masy na osie (ciężkie palety bliżej środka/osi).
- **Async Matrix Computation:** Wyliczanie macierzy dystansów dla 50 ofert jednocześnie bez blokowania głównego wątku.

---

## 6. Team Roles & Responsibilities (7-person team)
1.  **Lead Architect:** Nadzór nad integracją solvera i spójnością danych.
2.  **Backend Dev (Logic):** Implementacja OR-Tools, algorytmów scoringu i VRP.
3.  **Backend Dev (Data/Infra):** PostGIS, OSRM, migracje bazy i skrypty seedujące.
4.  **Frontend Dev (UI/UX):** Główny layout, dashboard, system komponentów Tailwind.
5.  **Frontend Dev (Visuals):** Silnik TrailerVisualizer (SVG), mapy i animacje.
6.  **QA Engineer:** Testy E2E (Playwright), walidacja matematyczna kosztów.
7.  **DevOps:** CI/CD, konteneryzacja, monitoring wydajności OSRM.

---

## 7. Development Guidelines (The Golden Rules)
- **Typing:** Strict TypeScript na froncie, Pydantic v2 na backendzie.
- **No Magic Numbers:** Wszystkie stałe (cena paliwa, stawki myta) muszą pochodzić z `.env` lub bazy danych.
- **Mobile-First:** Spedytorzy używają tabletów. TrailerVisualizer musi być w pełni responsywny.
- **Performance:** Każda operacja zapisu/odczytu trasy musi trwać < 200ms (z wyłączeniem czasu pracy Solvera).

---

## 8. Glossary
- **LDM (Loading Meters):** Długość przestrzeni ładunkowej zajmowana przez towar (standardowy bus = 4.2 - 5.0 LDM).
- **VRP:** Vehicle Routing Problem.
- **Knapsack:** Problem plecakowy (wybór najbardziej wartościowych ładunków do ograniczonej przestrzeni).
- **Multi-drop:** Trasa z wieloma punktami rozładunku.