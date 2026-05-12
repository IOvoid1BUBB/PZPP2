# Contributing — uruchomienie projektu (środowisko developerskie)

Ten dokument jest dla całego zespołu: opisuje **minimalny zestaw narzędzi**, **co robi Docker** w skrócie oraz **konkretne komendy** od zera do działającego API. Jeśli nie pracowałeś wcześniej z Dockerem, zacznij od sekcji „Docker w dwóch zdaniach”.

---

## Docker w dwóch zdaniach

**Docker** pozwala uruchomić aplikację wraz z bazą i Redisem w **izolowanych kontenerach** (jak lekkie, przewidywalne maszyny wirtualne), zdefiniowanych w pliku `docker-compose.yml`. Dzięki temu każdy ma **ten sam** Postgres z PostGIS, ten sam Redis i te same porty — bez ręcznej instalacji PostgreSQLa na laptopie.

**Docker Compose** to narzędzie, które czyta `docker-compose.yml` i uruchamia lub zatrzymuje cały zestaw usług jedną komendą.

**Routing w trasach** korzysta z **OpenRouteService (ORS)** — zewnętrznego API. W Compose nie ma kontenera z silnikiem routingu; potrzebny jest **klucz ORS** w `.env` (patrz niżej).

---

## Wymagania wstępne

1. **Git** — klonowanie repozytorium.
2. **Docker Desktop** (Windows / macOS) albo **Docker Engine**.
   - Po instalacji upewnij się, że Docker **działa** (ikona w stanie „running”; w terminalu: `docker version` bez błędów).
3. **Konto i klucz OpenRouteService** — darmowy tier i panel: [openrouteservice.org — dev / signup](https://openrouteservice.org/dev/#/signup). Klucz wklejasz do `.env` jako `ORS_API_KEY` (oraz `NEXT_PUBLIC_ORS_API_KEY`, jeśli planujesz wołania ORS z frontu w przeglądarce).

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

2. Uzupełnij przynajmniej **`ORS_API_KEY`** (wartość z panelu ORS). Bez poprawnego klucza endpoint `/health` zwróci `"ors": false`, mimo że API i baza działają.

3. Docker Compose wczytuje `.env` z tego samego katalogu co `docker-compose.yml` do **podstawiania zmiennych** w pliku compose oraz (dla zmapowanych kluczy) do środowiska kontenera `api`.

Szczegółowe znaczenie pozostałych zmiennych jest opisane w komentarzach wewnątrz `.env.example`.

---

## Krok 1 — budowanie i start całego stacku

W katalogu z `docker-compose.yml`:

```bash
docker compose up -d --build
```

Znaczenie flag:

- **`up`** — uruchom usługi zdefiniowane w compose.
- **`-d`** — w tle (detached), terminal nie „trzyma” logów na pierwszym planie.
- **`--build`** — przebuduj obraz `api`, jeśli zmienił się kod w `backend/` lub `Dockerfile`.

Pierwsze uruchomienie pobierze obrazy baz (`PostGIS`, `Redis`) i zbuduje obraz API — to normalne i wymaga internetu (także przy pierwszym healthchecku w stronę ORS).

### Jak sprawdzić, czy wszystko wstało

```bash
docker compose ps
```

W kolumnie `STATUS` serwisy powinny być w stanie typu `running` (dla bazy czasem najpierw `health: starting`, potem `healthy`).

### Szybka weryfikacja API

```bash
curl -s http://localhost:8000/health
```

Oczekiwany kształt odpowiedzi (wartość `ors` zależy od klucza ORS i dostępności API):

```json
{"status":"ok","db":true,"ors":true,"version":"1.0.0"}
```

---

## Porty (żeby nie kolidować z innymi projektami)

| Usługa   | Port na komputerze hosta | Uwagi                                      |
|----------|---------------------------|--------------------------------------------|
| API      | 8000                      | FastAPI / Uvicorn                          |
| Postgres | 5432                      | PostGIS                                    |
| Redis    | 6379                      | Cache / kolejki (na przyszłość)           |

**ORS** nie nasłuchuje lokalnie — to HTTPS do `api.openrouteservice.org` z kontenera `api` (i ewentualnie z frontu przez `NEXT_PUBLIC_ORS_API_KEY`).

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

---

## Typowe problemy

**„Cannot connect to the Docker daemon”**  
Docker Desktop / usługa Dockera nie jest uruchomiona. Uruchom aplikację Dockera i spróbuj ponownie.

**`/health` zwraca `ors: false`**  
Najczęściej brak lub zły **`ORS_API_KEY`** w `.env`, limit / błąd po stronie ORS albo chwilowa niedostępność sieci. Sprawdź klucz w panelu ORS, popraw `.env` i zrestartuj API: `docker compose up -d --build api`.

**`db: false` lub błąd połączenia z bazą**  
Postgres jeszcze nie przeszedł healthchecka albo zmieniono `DATABASE_URL` niezgodnie z serwisem `db` w compose. Poczekaj kilka sekund; w razie potrzeby: `docker compose logs db`.

**Port zajęty (np. 5432)**  
Inna instancja Postgresa na hoście. Zatrzymaj ją albo zmień port w sekcji `ports` serwisu `db` w `docker-compose.yml`.

---

## Rozwój samego backendu bez przebudowy całego świata

Po zmianach w kodzie Pythona w `backend/app/` zwykle wystarczy:

```bash
docker compose up -d --build api
```

Jeśli pracujesz **lokalnie** z Pythonem na hoście (bez Dockera), musisz sam uruchomić Postgres i Redis przez Compose i ustawić zmienne (np. z `.env`) tak, aby `DATABASE_URL` wskazywał na `localhost:5432` zamiast hosta `db`, oraz **`ORS_API_KEY`** dla wywołań ORS — to tryb zaawansowany; domyślna ścieżka zespołu to **wszystko przez `docker compose`**.

---

## Podsumowanie najkrótszej ścieżki dla nowej osoby

1. Zainstaluj Docker, upewnij się, że działa (`docker version`).
2. Sklonuj repo, wejdź do katalogu z `docker-compose.yml`.
3. `cp .env.example .env` i uzupełnij **`ORS_API_KEY`** (panel ORS).
4. `docker compose up -d --build`
5. `curl http://localhost:8000/health`

Pytania infrastrukturalne warto kierować do roli **DevOps** z opisu zespołu w `context.md`; poprawki do tego dokumentu — przez zwykły merge request z krótkim opisem zmiany.
