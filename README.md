# DnD Companion

Ekwipunek drużyny D&D 5e: waga przedmiotów, udźwig z SIŁ, pojemniki (w tym Bag of Holding), wspólny skarbiec. DM widzi wszystkich, gracz tylko siebie i skarbiec. Specyfikacja: [SPEC.md](SPEC.md).

```
web/   Frontend: React + Vite + Sass              -> GitHub Pages (GitHub Actions)
api/   REST API: Node + Express + @libsql/client  -> Render
       Baza: Turso (hostowany SQLite, trwały)     -> turso.tech
```

## Lokalnie

```bash
cd api && npm install && npm run dev        # http://localhost:3000, baza w api/data/dndcompanion.db
cd web && npm install && npm run dev        # http://localhost:5173
cd api && npm test                          # testy API i obliczeń
```

Bez zmiennych `TURSO_*` API używa lokalnego pliku SQLite (`DB_PATH`, domyślnie `./data/dndcompanion.db`). Żeby lokalnie pracować na bazie z Turso, ustaw `TURSO_DATABASE_URL` i `TURSO_AUTH_TOKEN` (patrz `api/.env.example`).

Frontend domyślnie łączy się z `http://localhost:3000`; inny adres ustawisz w `web/.env` (`VITE_API_URL=...`).

## Deploy

### 1. Baza w Turso

1. Załóż konto na https://turso.tech i utwórz bazę (np. `dndcompanion`). Wybierz region blisko regionu Rendera (np. Frankfurt dla Rendera we Frankfurcie).
2. Skopiuj **URL bazy** (`libsql://dndcompanion-<org>.turso.io`) i wygeneruj **token** (w panelu: Create Token; albo CLI: `turso db show dndcompanion --url`, `turso db tokens create dndcompanion`).

Tabele API tworzy samo przy starcie.

### 2. API na Render

1. Wrzuć repo na GitHub.
2. Render: **New → Blueprint**, wybierz repo. Render wczyta `render.yaml` (katalog `api`, plan free, healthcheck `/health`).
3. Uzupełnij zmienne: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `CORS_ORIGIN` (adres GitHub Pages, np. `https://<login>.github.io`).
4. Zapisz URL serwisu, np. `https://dndcompanion-api.onrender.com`.

Bez Blueprintu: **New → Web Service**, Root Directory `api`, Build `npm ci`, Start `npm start`, te same zmienne.

Darmowy Render usypia serwis po ~15 min bez ruchu; pierwsze wejście potem trwa do minuty (aplikacja pokazuje „Budzenie serwera…”). Dane są w Turso, więc restarty i redeploye niczego nie kasują.

### 3. Frontend na GitHub Pages

1. Repo → **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables**: dodaj `API_URL` = URL z Rendera.
3. Push na `main` (zmiany w `web/`) uruchamia `.github/workflows/deploy-web.yml`. Strona będzie pod `https://<login>.github.io/<repo>/`.

Workflow `test-api.yml` odpala testy API przy zmianach w `api/`.

### Kopia zapasowa

W aplikacji: **Ustawienia → Eksportuj JSON** / **Importuj JSON** (DM). Turso ma też własne kopie i przywracanie do punktu w czasie.

## Jak się gra

- **DM** tworzy kampanię (nazwa, hasło DM, hasło kampanii) i dostaje 6-znakowy kod.
- **Gracz** wybiera „Nowa postać”, podaje kod, hasło kampanii, imię, własne hasło i SIŁ. Potem loguje się kodem, imieniem i swoim hasłem.
- DM tworzy przedmioty w **Katalogu** (albo dodaje gotowe pojemniki z 5e) i rozdaje je graczom lub do skarbca.
- Gracz przenosi przedmioty między swoimi pojemnikami i skarbcem, zmienia SIŁ, zakłada/zdejmuje, dodaje notatki. Nie dodaje i nie usuwa przedmiotów.
- Limity pojemników (waga, rozmiar, dozwolone kategorie, zagnieżdżanie, pozawymiarowe w pozawymiarowym) blokują ruch gracza; DM może je wymusić.
