# Contributing — uruchomienie projektu (środowisko developerskie)

Ten dokument jest dla całego zespołu: opisuje **minimalny zestaw narzędzi**, **co robi Docker** w skrócie oraz **konkretne komendy** od zera do działającego API. Jeśli nie pracowałeś wcześniej z Dockerem, zacznij od sekcji „Docker w dwóch zdaniach”.

---

## Docker w dwóch zdaniach

**Docker** pozwala uruchomić aplikację wraz z bazą, Redisem i OSRM w **izolowanych kontenerach** (jak lekkie, przewidywalne maszyny wirtualne), zdefiniowanych w pliku `docker-compose.yml`. Dzięki temu każdy ma **ten sam** Postgres z PostGIS, tę samą wersję OSRM i te same porty — bez ręcznej instalacji PostgreSQLa na laptopie.

**Docker Compose** to narzędzie, które czyta `docker-compose.yml` i uruchamia lub zatrzymuje cały zestaw usług jedną komendą.

---

## Wymagania wstępne

1. **Git** — klonowanie repozytorium.
2. **Docker Desktop** (Windows / macOS) albo **Docker Engine**.
   - Po instalacji upewnij się, że Docker **działa** (ikona w stanie „running”; w terminalu: `docker version` bez błędów).
3. **Pierwszy raz: przygotowanie mapy OSRM** (patrz niżej) wymaga dodatkowo:
   - **Wolnego miejsca na dysku** (rząd wielkości: kilka–kilkanaście GB na pliki Polski + graf OSRM).
   - **`wget`** w terminalu (na macOS często: `brew install wget`; na Linuxie zwykle już jest).
   - **Dostępu do internetu** tylko na czas pobrania pliku `.osm.pbf` i pierwszego `docker compose pull` / budowy obrazu API.

Reszta pracy z API i bazą odbywa się **lokalnie** między kontenerami — zgodnie z założeniem projektu (brak zależności od zewnętrznych API w runtime).

---

## Klonowanie i katalog roboczy

W terminalu:

```bash
git clone <URL-repozytorium>
cd <nazwa-katalogu-repozytorium>
```

Wszystkie kolejne komendy zakładają, że jesteś w **katalogu głównym repozytorium**, tam gdzie leży plik `docker-compose.yml`.

---

## Plik `.env` (opcjonalnie, ale zalecane)

1. Skopiuj szablon:

   ```bash
   cp .env.example .env
   ```

2. Domyślne wartości w `docker-compose.yml` i tak pozwalają uruchomić stack **bez** `.env`, ale plik `.env` jest potrzebny, gdy chcesz **nadpisać** np. koszty paliwa lub URL bazy. Docker Compose automatycznie wczytuje `.env` z tego samego katalogu co `docker-compose.yml` do **podstawiania zmiennych** w pliku compose.

Szczegółowe znaczenie każdej zmiennej jest opisane w komentarzach wewnątrz `.env.example`.

---

## Krok 1 — przygotowanie danych OSRM (pierwszy raz albo po świadomym wyczyszczeniu `osrm-data`)

Serwis **OSRM** w Compose potrzebuje **wstępnie przetworzonej** mapy Polski w katalogu `osrm-data/`. Bez tego kontener OSRM może się od razu zatrzymać, a endpoint `/health` zwróci `osrm: false`.

Uruchom **na hoście** (nie wewnątrz kontenera API):

```bash
chmod +x scripts/osrm_setup.sh   # tylko raz, jeśli skrypt nie jest wykonywalny
./scripts/osrm_setup.sh
```

Co się dzieje w skrócie:

- pobierany jest plik OpenStreetMap dla Polski (Geofabrik);
- trzykrotnie uruchamiany jest obraz OSRM (`extract`, `partition`, `customize`) — to **długotrwałe** (często wiele minut do znacznie dłużej, zależnie od CPU i dysku).

Skrypt jest **idempotentny**: ponowne uruchomienie pomija kroki, które już zakończyły się plikami wynikowymi w `osrm-data/`.

---

## Krok 2 — budowanie i start całego stacku

W katalogu z `docker-compose.yml`:

```bash
docker compose up -d --build
```

Znaczenie flag:

- **`up`** — uruchom usługi zdefiniowane w compose.
- **`-d`** — w tle (detached), terminal nie „trzyma” logów na pierwszym planie.
- **`--build`** — przebuduj obraz `api`, jeśli zmienił się kod w `backend/` lub `Dockerfile`.

Pierwsze uruchomienie pobierze obrazy baz (`PostGIS`, `Redis`, `OSRM`) i zbuduje obraz API — to normalne i wymaga internetu.

### Jak sprawdzić, czy wszystko wstało

```bash
docker compose ps
```

W kolumnie `STATUS` serwisy powinny być w stanie typu `running` (dla bazy czasem najpierw `health: starting`, potem `healthy`).

### Szybka weryfikacja API

```bash
curl -s http://localhost:8000/health
```

Oczekiwany kształt odpowiedzi (wartości logiczne zależą od stanu OSRM i bazy):

```json
{"status":"ok","db":true,"osrm":true,"version":"1.0.0"}
```

---

## Porty (żeby nie kolidować z innymi projektami)

| Usługa   | Port na komputerze hosta | Uwagi                          |
|----------|---------------------------|--------------------------------|
| API      | 8000                      | FastAPI / Uvicorn              |
| Postgres | 5432                      | PostGIS                        |
| OSRM     | 5000                      | HTTP routing (np. `/route/...`) |
| Redis    | 6379                      | Cache / kolejki (na przyszłość) |

Jeśli któryś port jest zajęty, zatrzymaj inny program albo (za porozumieniem zespołem) zmień mapowanie portów w `docker-compose.yml`.

---

## Przydatne komendy na co dzień

| Cel | Komenda |
|-----|---------|
| Logi wszystkich usług (na żywo) | `docker compose logs -f` |
| Logi tylko API | `docker compose logs -f api` |
| Zatrzymanie bez usuwania wolumenów z danymi Postgres | `docker compose stop` |
| Zatrzymanie i usunięcie kontenerów | `docker compose down` |
| Dodatkowo usunięcie **named volume** z bazą (`pgdata`) | `docker compose down -v` |

Uwaga: katalog **`osrm-data/`** jest **montowany z dysku** (bind mount), więc **`docker compose down -v` nie kasuje** przygotowanych plików OSRM — tylko wolumen Dockera z Postgresa. Świadome wyczyszczenie mapy = usunięcie lub przeniesienie zawartości `osrm-data/` ręcznie.

---

## Typowe problemy

**„Cannot connect to the Docker daemon”**  
Docker Desktop / usługa Dockera nie jest uruchomiona. Uruchom aplikację Dockera i spróbuj ponownie.

**`osrm` w `docker compose ps` jest `Exited`**  
Najczęściej brak lub uszkodzone pliki w `osrm-data/`. Uruchom ponownie `./scripts/osrm_setup.sh` i potem `docker compose up -d`.

**`/health` zwraca `osrm: false`**  
OSRM nie odpowiada (jeszcze się nie podniósł, brak danych albo błąd routingu). Sprawdź `docker compose logs osrm`.

**Port zajęty (np. 5432)**  
Inna instancja Postgresa na hoście. Zatrzymaj ją albo zmień port w sekcji `ports` serwisu `db` w `docker-compose.yml`.

**`wget: command not found` przy OSRM setup**  
Zainstaluj `wget` (np. na macOS: Homebrew) albo użyj maszyny / WSL z GNU coreutils.

---

## Rozwój samego backendu bez przebudowy całego świata

Po zmianach w kodzie Pythona w `backend/app/` zwykle wystarczy:

```bash
docker compose up -d --build api
```

Jeśli pracujesz **lokalnie** z Pythonem na hoście (bez Dockera), musisz sam uruchomić Postgres / Redis / OSRM przez Compose i ustawić zmienne (np. z `.env`) tak, aby `DATABASE_URL` wskazywał na `localhost:5432` zamiast hosta `db` — to tryb zaawansowany; domyślna ścieżka zespołu to **wszystko przez `docker compose`**.

---

## Podsumowanie najkrótszej ścieżki dla nowej osoby

1. Zainstaluj Docker, upewnij się, że działa (`docker version`).
2. Sklonuj repo, wejdź do katalogu z `docker-compose.yml`.
3. `cp .env.example .env` (zalecane).
4. `./scripts/osrm_setup.sh` (pierwszy raz — cierpliwość i miejsce na dysku).
5. `docker compose up -d --build`
6. `curl http://localhost:8000/health`

Pytania infrastrukturalne warto kierować do roli **DevOps** z opisu zespołu w `context.md`; poprawki do tego dokumentu — przez zwykły merge request z krótkim opisem zmiany.
