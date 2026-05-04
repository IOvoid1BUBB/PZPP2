# 🚛Technical Documentation & Developer Guide

**Project Status:** 🛠 Development 
**Main Objective:** Automated Cargo Consolidation & Route Optimization  
**Date:** April 2026  

---

## 📖 1. Kontekst Biznesowy i Misja
W tradycyjnym transporcie spedytorzy ręcznie dopasowują ładunki, co generuje 20-30% "pustych przebiegów" i niewykorzystanej przestrzeni (LDM). Nasza aplikacja automatyzuje ten proces, rozwiązując problem **VRP (Vehicle Routing Problem)** w czasie rzeczywistym.

**Nasz cel:** Stworzyć "Wirtualnego Spedytora", który buduje najbardziej dochodową trasę, łącząc ładunki od 1 do 10 różnych klientów na jednej naczepie, dbając o fizyczne limity pojazdu i czas pracy kierowcy.

---

## 🏗 2. Architektura Systemu (Internal View)

Aplikacja składa się z czterech kluczowych mikroserwisów zamkniętych w ekosystemie Docker:

### 🧩 A. Backend Core (FastAPI)
- **Logika:** Zarządzanie sesjami konsolidacji, scoring ofert, integracja z solverem.
- **Strategia:** Asynchroniczne przetwarzanie (AsyncIO) dla wysokiej przepustowości zapytań o giełdę.

### 🧠 B. Optimization Engine (Python / OR-Tools)
- **Solver:** Wykorzystujemy `ortools.sat.python.cp_model` do rozwiązywania problemu *Pick-up and Delivery Problem with Time Windows (PDPTW)*.
- **Constraint Handling:** Solver musi uwzględnić, że:
    - Załadunek (PU) musi nastąpić przed Rozładunkiem (DO) danej oferty.
    - Całkowita masa i LDM w żadnym punkcie trasy nie mogą przekroczyć limitów.
    - Sekwencja przystanków musi być optymalna pod kątem dystansu (2-opt heuristic).

### 🗺 C. Geospatial & Routing (PostGIS / OSRM)
- **Spatial Search:** Wykorzystujemy `ST_Buffer` i `ST_DWithin`, aby ograniczyć przeszukiwanie giełdy do "Korytarza Transportowego" (np. 50 km od trasy głównej).
- **Routing:** Lokalna instancja OSRM serwuje macierze dystansów (Matrix API), co pozwala na wyliczenie tysięcy kombinacji tras bez opóźnień sieciowych.

### 🎨 D. Visual Interface (Next.js 16)
- **Design Philosophy:** Rezygnacja z gotowych UI-kitów (brak shadcn). Wszystkie komponenty (TrailerVisualizer, ProfitChart) są pisane od zera w Tailwindzie dla maksymalnej wydajności renderowania SVG.

---

## 🧮 3. Logika Matematyczna (Deep Dive)

### Modele Kosztowe
Aby wyliczyć **Zysk Netto**, stosujemy wzór uwzględniający dynamikę transportu:
```text
NetProfit = TotalRevenue - (FuelCost + Tolls + StopCosts + DriverDaily + Maintenance)