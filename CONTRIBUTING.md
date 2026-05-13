# Contributing — uruchomienie projektu (środowisko developerskie)

Ten dokument jest dla całego zespołu: opisuje **minimalny zestaw narzędzi**, **rolę Dockera**, **lokalny OSRM** oraz **konkretne komendy** od zera do działającego stacku. Jeśli nie pracowałeś wcześniej z Dockerem, zacznij od sekcji „Docker w dwóch zdaniach”.

---

## Docker w dwóch zdaniach

**Docker** pozwala uruchomić aplikację wraz z bazą, Redisem i **silnikiem OSRM** w **izolowanych kontenerach** (jak lekkie, przewidywalne maszyny wirtualne), zdefiniowanych w pliku `docker-compose.yml`. Dzięki temu każdy ma **ten sam** Postgres z PostGIS, ten sam Redis, ten sam OSRM i te same porty — bez ręcznej instalacji PostgreSQLa ani lokalnej kompilacji OSRM na laptopie (opcjonalnie możesz budować obrazy OSRM samodzielnie; domyślnie zakładamy gotowy obraz + zamontowany wolumen z danymi).

**Docker Compose** czyta `docker-compose.yml` i uruchamia lub zatrzymuje cały zestaw usług jedną komendą.

**Routing** obsługuje **lokalna instancja OSRM** w sieci Dockera. **Nie** jest wymagane konto ani klucz u zewnętrznego dostawcy OpenRouteService dla tej architektury.

---

## Wymagania wstępne

1. **Git** — klonowanie repozytorium.
2. **Docker Desktop** (Windows / macOS) albo **Docker Engine**.
   - Po instalacji upewnij się, że Docker **działa** (ikona w stanie „running”; w terminalu: `docker version` bez błędów).
3. **Dane OSM pod OSRM** — przy pierwszym uruchomieniu serwisu `osrm` musisz mieć **wstępnie przetworzone** pliki `.osrm` (patrz sekcja „Preprocessing OSM dla OSRM”). Na start zespołu zalecamy **mniejszy extract** (np. jeden kraj); pełna **Europa** jest możliwa, lecz wymaga znacznej **RAM i miejsca na dysku**.

---

## Zasady frontendu

- Frontend ma być **lekki**: **mapa**, **markery**, **wyświetlanie geometrii** i **statystyk** z API.
- **Zabronione** na froncie: optymalizacja tras, liczenie kosztów transportu, ciężkie obliczenia — to **wyłącznie backend**.

---

## Modularna architektura backendu (konwencja katalogów)

Nowy kod biznesowy i integracyjny umieszczamy modularnie, m.in.:

- `backend/app/services/routing` — komunikacja z OSRM, normalizacja odpowiedzi, brak reguł kosztowych.
- `backend/app/services/optimization` — VRP / kolejność przystanków / przypisanie do pojazdów.
- `backend/app/services/costs` — paliwo, myto, utrzymanie, postoje itd.
- `backend/app/services/drivers` — czas pracy, przerwy, reguły zgodne z **tachografem UE**.

*(Dokładne ścieżki mogą ewoluować, ale **separacja** routingu, optymalizacji, kosztów i kierowców jest obowiązkowa.)*

---

## Klonowanie i katalog roboczy

W terminalu:

```bash
git clone <URL-repozytorium>
cd <nazwa-katalogu-repozytorium>
```

Wszystkie kolejne komendy zakładają, że jesteś w **katalogu głównym repozytorium**, tam gdzie leży plik `docker-compose.yml`.

---

## Plik `.env` (zalecane)

1. Skopiuj szablon:

   ```bash
   cp .env.example .env
   ```

2. Uzupełnij zmienne zgodnie z komentarzami w `.env.example` (np. `DATABASE_URL`, `REDIS_URL`, URL wewnętrzny do OSRM w sieci Compose — typowo `http://osrm:5000` po dodaniu serwisu w compose).

3. Docker Compose wczytuje `.env` z tego samego katalogu co `docker-compose.yml` do **podstawiania zmiennych** w pliku compose oraz do środowiska kontenerów.

**Uwaga:** dokumentacja **nie** zakłada już `ORS_API_KEY` ani konta OpenRouteService.

---

## Preprocessing danych OpenStreetMap dla OSRM

1. Pobierz plik **`.osm.pbf`** — dla Europy np. [Geofabrik Europe](https://download.geofabrik.de/europe.html) (duży plik; na dev często wybiera się jeden kraj).
2. W katalogu z plikiem `.osm.pbf` uruchom narzędzia OSRM (lokalnie lub jednorazowo w kontenerze `osrm/osrm-backend`), np. dla profilu samochodowego:

   ```bash
   docker run --rm -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/car.lua /data/europe-latest.osm.pbf
   docker run --rm -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend osrm-partition /data/europe-latest.osrm
   docker run --rm -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/europe-latest.osrm
   ```

   Dla mniejszego regionu podstaw nazwę pliku (np. `poland-latest.osm.pbf` → `poland-latest.osrm`).

3. Upewnij się, że wolumen Dockera (lub bind mount) wskazuje na katalog z wygenerowanymi plikami `*.osrm*` i że serwis `osrm` w `docker-compose.yml` uruchamia `osrm-routed` z poprawną ścieżką bazową (np. `/data/europe-latest`).

Szczegóły profili (`car` vs `truck`) i wersji obrazów — w dokumentacji [Project OSRM](https://github.com/Project-OSRM/osrm-backend/wiki/Running-OSRM).

---

## Cache Redis (macierz i trasy)

- Zalecam cache'ować odpowiedzi **Table Service** (macierz) oraz **Route / Match** (geometria i metadane), z kluczem uwzględniającym m.in. zestaw współrzędnych (zaokrąglonych), profil i parametry (np. `annotations=durations,distances`).
- Backend powinien **invalidować** lub skracać TTL cache przy zmianie profilu OSM / wersji danych mapy.
- Redis jest współdzielony z innymi potrzebami kolejkowania — trzymaj **prefiksy kluczy** (np. `osrm:table:`, `osrm:route:`).

---

## Krok 1 — budowanie i start całego stacku

W katalogu z `docker-compose.yml` (gdy w compose zdefiniowane są m.in. `frontend`, `backend`, `osrm`, `db`, `redis`):

```bash
docker compose up -d --build
```

Znaczenie flag:

- **`up`** — uruchom usługi zdefiniowane w compose.
- **`-d`** — w tle (detached).
- **`--build`** — przebuduj obrazy, jeśli zmienił się Dockerfile lub kontekst buildu.

Pierwsze uruchomienie pobierze obrazy baz; **OSRM** startuje po podmontowaniu przygotowanych plików — bez nich kontener może się restartować (sprawdź logi).

### Przykładowe komendy (pełny stack)

```bash
# pełna przebudowa i start
docker compose build --no-cache
docker compose up -d

# tylko backend po zmianach w kodzie
docker compose up -d --build backend

# logi OSRM
docker compose logs -f osrm
```

### Healthcheck OSRM

W `docker-compose.yml` warto dodać `healthcheck` wywołujący HTTP OSRM, np. prosty request do API route (dostosuj port i ścieżkę do wersji API):

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://127.0.0.1:5000/route/v1/driving/8.68,49.41;8.69,49.42?overview=false"]
  interval: 30s
  timeout: 10s
  retries: 5
  start_period: 60s
```

Ręczna weryfikacja z hosta (gdy port `5000` jest wystawiony):

```bash
curl -s "http://localhost:5000/route/v1/driving/8.681495,49.41461;8.686507,49.41943?overview=false" | head -c 200
```

Oczekiwany wynik: JSON z polami routingu (np. `routes`), a nie błąd połączenia.

### Jak sprawdzić, czy wszystko wstało

```bash
docker compose ps
```

W kolumnie `STATUS` serwisy powinny być `running` / `healthy` (Postgres i OSRM po udanym healthchecku).

### Szybka weryfikacja API backendu

```bash
curl -s http://localhost:8000/health
```

Kształt odpowiedzi zależy od implementacji (np. status bazy, Redis, OSRM); po migracji z ORS **nie** oczekuj pola `ors` ani klucza API OpenRouteService.

---

## Porty (żeby nie kolidować z innymi projektami)

| Usługa    | Port na hoście (przykład) | Uwagi                          |
|-----------|---------------------------|--------------------------------|
| Backend   | 8000                      | FastAPI / Uvicorn              |
| Frontend  | 3000 (Next) / 5173 (Vite) | zależnie od szablonu frontendu |
| Postgres  | 5432                      | PostGIS                        |
| Redis     | 6379                      | cache macierzy / tras          |
| OSRM      | 5000                      | HTTP OSRM (domyślnie)          |

Jeśli port jest zajęty, zmień mapowanie w `docker-compose.yml` po uzgodnieniu z zespołem.

---

## Przydatne komendy na co dzień

| Cel | Komenda |
|-----|---------|
| Logi wszystkich usług (na żywo) | `docker compose logs -f` |
| Logi tylko backendu | `docker compose logs -f backend` |
| Zatrzymanie bez usuwania wolumenów | `docker compose stop` |
| Zatrzymanie i usunięcie kontenerów | `docker compose down` |
| Usunięcie wolumenu z bazą (`pgdata`) | `docker compose down -v` |

---

## Typowe problemy

**„Cannot connect to the Docker daemon”**  
Docker nie jest uruchomiony. Uruchom Docker Desktop / usługę i powtórz komendę.

**OSRM się restartuje lub 502**  
Brak plików `.osrm*` w zamontowanym katalogu, zła ścieżka do bazy w `osrm-routed`, albo za mało RAM dla dużego extractu. Sprawdź: `docker compose logs osrm`.

**`db: false` w health**  
Postgres nie przeszedł healthchecka albo zły `DATABASE_URL`. Poczekaj lub: `docker compose logs db`.

**Port zajęty**  
Zatrzymaj konfliktującą usługę albo zmień `ports` w compose.

---

## Rozwój samego backendu bez przebudowy całego świata

Po zmianach w kodzie Pythona zwykle wystarczy:

```bash
docker compose up -d --build backend
```

Tryb zaawansowany: Python na hoście + Postgres, Redis i OSRM z Compose — ustaw `DATABASE_URL`, `REDIS_URL` i bazowy URL OSRM na `localhost` z portów wystawionych w compose.

---

## Podsumowanie najkrótszej ścieżki dla nowej osoby

1. Zainstaluj Docker (`docker version` bez błędów).
2. Sklonuj repo, wejdź do katalogu z `docker-compose.yml`.
3. Przygotuj dane OSRM (extract → partition → customize) i podmontuj je pod serwis `osrm`.
4. `cp .env.example .env` — uzupełnij zmienne (bez ORS).
5. `docker compose up -d --build`
6. `curl http://localhost:8000/health` oraz test OSRM (curl na port routingu).

Pytania infrastrukturalne warto kierować do roli **DevOps** z opisu zespołu w `CONTEXT.md`; poprawki do tego dokumentu — przez merge request z krótkim opisem zmiany.
