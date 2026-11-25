# DnD Companion – specyfikacja (v0.1)

Aplikacja webowa do zarządzania ekwipunkiem graczy w D&D 5e. Na tym etapie: **tylko ciężar przedmiotów, udźwig i pojemniki**. Cała reszta (waluta jako przedmiot, cechy poza SIŁ, itp.) jest poza zakresem v0.1.

## 1. Cele i zakres

- Każdy gracz widzi i edytuje **tylko swój** ekwipunek.
- DM widzi ekwipunek **wszystkich** graczy, tworzy i edytuje przedmioty oraz zarządza wspólnym skarbcem.
- Jest sekcja **wspólna** (party stash) widoczna dla wszystkich.
- Udźwig liczony automatycznie z SIŁ gracza.
- Obsługa mechanik plecaków i pojemników z 5e.

**Poza zakresem v0.1:** monety jako osobny licznik wagi (patrz 9. Przyszłe rozszerzenia), walka, rzuty kośćmi, pełne karty postaci, czat.

## 2. Role i uprawnienia

| Akcja | Gracz | DM |
|---|---|---|
| Widok własnego ekwipunku | tak | tak |
| Widok cudzego ekwipunku | nie | tak |
| Dodanie/usunięcie przedmiotu z własnego ekwipunku | nie- tylkp przesuniecie do czesci wspolne | tak (każdemu) |
| Tworzenie/edycja/usuwanie definicji przedmiotów (katalog) | nie | tak |
| Wybór przedmiotu z katalogu do własnego ekwipunku | nie (przedmioty daje DM) | tak |
| Przenoszenie między własnymi pojemnikami | tak | tak |
| Notatka, założone/zdjęte | tak (własne) | tak |
| Ilość, waga egzemplarza | nie | tak |
| Własny przedmiot niestandardowy gracza | nie (v0.1) | tak |
| Edycja SIŁ postaci | tak (własnej) | tak (każdej) |
| Rozmiar, Powerful Build, mnożnik udźwigu | nie | tak |
| Wspólny skarbiec: podgląd | tak | tak |
| Wspólny skarbiec: dodawanie/zabieranie | tak | tak |
| Zarządzanie kampanią i graczami | nie | tak |

Zasada: uprawnienia egzekwuje **backend**, nie frontend.

## 3. Model danych

Wagi zapisywane zawsze w **funtach (lb)** jako liczby, wyświetlanie opcjonalnie w kg (1 lb = 0,4536 kg), ustawienie per kampania.

### 3.1 Campaign
- `id`, `name`
- `dmTokenHash` – sekret DM
- `joinCode` – kod dla graczy
- `settings`: `units` (`lb`|`kg`), `encumbranceMode` (`simple`|`variant`), `allowPlayerCustomItems` (bool)

### 3.2 Player (postać)
- `id`, `campaignId`, `name`, `playerTokenHash`
- `strength` (1–30)
- `size` (`tiny`|`small`|`medium`|`large`|`huge`|`gargantuan`), domyślnie `medium`
- `powerfulBuild` (bool) – np. goliat, półork; liczy się jako rozmiar większy przy udźwigu
- `capacityModifier` (liczba, domyślnie 1) – ręczny mnożnik DM (np. magiczne efekty)

### 3.3 ItemDefinition (katalog DM)
- `id`, `campaignId`, `name`, `description`
- `weight` (lb, >= 0, dopuszczalne ułamki, np. 0.1)
- `size` (liczba >= 0, **wpisywana dowolnie przez DM**, bez list predefiniowanych ani sztywnych jednostek; domyślnie puste = przedmiot nie zajmuje miejsca w pojemnikach limitowanych rozmiarem). To jednostka „miejsca” ustalana przez DM (np. cu ft albo własne punkty), spójna w całej kampanii.
- `category` (opcjonalnie: broń, zbroja, sprzęt, magiczny, inne)
- `stackable` (bool) – przedmioty liczone w sztukach (strzały, racje)
- `container` (opcjonalny obiekt, patrz 3.4) – jeśli ustawiony, przedmiot jest pojemnikiem

### 3.4 ContainerSpec (część ItemDefinition)
- `capacityWeight` (lb) – maks. waga zawartości, `null` = brak limitu wagi
- `capacitySize` – maks. suma `size` zawartości, wpisywana dowolnie przez DM w tej samej jednostce co `size` przedmiotów; `null` = nie liczymy rozmiaru
- `contentsWeightMultiplier` – ile z wagi zawartości liczy się do noszącego:
  - `1` – zwykły plecak, torba
  - `0` – pełna ekstradimensja (Bag of Holding, Portable Hole: zawartość nie liczy się wcale)
  - ułamek, np. `0.5` – własne reguły DM (opcjonalnie)
- `extradimensional` (bool) – flaga informacyjna i dla reguły zagnieżdżania (3.6)
- `maxItemDimension` (opcjonalne, tekst) – np. „3 ft”, tylko informacyjnie
- `allowedCategories` (opcjonalne) – np. kołczan tylko strzały

### 3.5 InventoryEntry (stan ekwipunku)
- `id`, `ownerType` (`player`|`party`), `ownerId`
- `itemId` (do ItemDefinition), `quantity` (>= 1)
- `parentEntryId` (opcjonalne) – wpis, w którym ten przedmiot leży (pojemnik); `null` = noszony bezpośrednio
- `equipped` (bool, informacyjnie; nie zmienia wagi)
- `notes` (opcjonalnie)
- `weightOverride` (opcjonalne, tylko DM) – nadpisanie wagi dla egzemplarza

### 3.6 Reguły zagnieżdżania
- Pojemnik może leżeć w innym pojemniku (plecak w skrzyni), głębokość ograniczona do **3** poziomów.
- **Przedmiot z `extradimensional = true` nie może trafić do innego pojemnika z `extradimensional = true`** (reguła 5e: Bag of Holding w Portable Hole itp. niszczy zawartość). Aplikacja blokuje takie przeniesienie i pokazuje ostrzeżenie. DM może wymusić.
- Cykle zabronione (pojemnik nie może zawierać siebie, bezpośrednio ani pośrednio).

## 4. Obliczenia

### 4.1 Udźwig
Reguły 5e (PHB):
- **Udźwig bazowy** = `SIŁ × 15` lb
- **Pchanie/ciągnięcie/podnoszenie** = `SIŁ × 30` lb (informacyjnie)
- Mnożniki rozmiaru: Tiny ×0,5; Small/Medium ×1; Large ×2; Huge ×3; Gargantuan ×4
- `powerfulBuild` liczy się jako rozmiar o jeden większy (dla Medium → ×2)
- Na końcu mnożnik `capacityModifier`

`capacity = STR × 15 × sizeMultiplier × capacityModifier`

### 4.2 Waga ekwipunku
Rekurencyjnie po drzewie wpisów:

```
weight(entry) = unitWeight × quantity + contentsWeight(entry) × multiplier
unitWeight    = weightOverride ?? item.weight
contentsWeight = suma weight(dziecko) po wszystkich wpisach z parentEntryId = entry.id
multiplier    = container.contentsWeightMultiplier (domyślnie 1)
```

Waga całkowita gracza = suma `weight(entry)` dla wpisów z `parentEntryId = null`.

Uwaga: pojemnik z `multiplier = 0` waży tyle co on sam (np. Bag of Holding 15 lb), niezależnie od zawartości.

### 4.3 Stan obciążenia

**Tryb `simple`:** obciążony = waga > udźwig. Pokazujemy pasek zapełnienia i procent.

**Tryb `variant`** (wariant z PHB, zasady o obciążeniu):
- waga > `SIŁ × 5` → **Encumbered**: prędkość −10 ft
- waga > `SIŁ × 10` → **Heavily Encumbered**: prędkość −20 ft, **zakłada się też**: nieskuteczność w testach cech, rzutach ataku i rzutach obronnych używających SIŁ/ZRĘ/KON (przewaga/utrudnienie wg wariantu: disadvantage)
- waga > udźwig bazowy (`SIŁ × 15`) → **przekroczony udźwig**: prędkość spada do 5 ft; ostrzeżenie „nie może się ruszać”
- Progi także skalowane mnożnikiem rozmiaru i `capacityModifier`

UI: pasek z trzema progami, kolor zielony/żółty/pomarańczowy/czerwony, tekst z konsekwencjami.

### 4.4 Walidacja pojemników
Dla każdego pojemnika: suma wagi zawartości (z uwzględnieniem ilości) <= `capacityWeight`. Przekroczenie:
- gracz: blokada dodania (twarde ograniczenie), komunikat „plecak pełny: 31/30 lb”
- DM: ostrzeżenie z możliwością wymuszenia

Jeśli ustawiona `capacitySize`, analogicznie dla rozmiaru: suma `size × quantity` zawartości <= `capacitySize`. Przedmiot bez `size` nie liczy się do limitu rozmiaru. Wartości rozmiarów i pojemności ustawia DM dowolnie, aplikacja nie narzuca skali.

## 5. Mechaniki plecaków i pojemników (5e) – predefiniowane szablony

Katalog startowy to tylko **propozycje domyślne**: DM może zmienić każdą wagę, rozmiar i pojemność albo go nie używać. Kolumna „pojemność” podaje wartości z 5e (lb / cu ft), które po imporcie trafiają do `capacityWeight` i `capacitySize`. Wagi w lb:

| Przedmiot | Waga własna | Pojemność | Mnożnik zawartości | Uwagi |
|---|---|---|---|---|
| Backpack (plecak) | 5 | 30 lb / 1 cu ft | 1 | w PHB 5 lb, w niektórych wydaniach 5 |
| Pouch (sakiewka) | 1 | 6 lb / 1/5 cu ft | 1 | |
| Sack (worek) | 0,5 | 30 lb / 1 cu ft | 1 | |
| Basket (kosz) | 2 | 40 lb / 2 cu ft | 1 | |
| Chest (skrzynia) | 25 | 300 lb / 12 cu ft | 1 | |
| Barrel (beczka) | 70 | 40 gal płynu / 4 cu ft | 1 | |
| Quiver (kołczan) | 1 | 20 strzał | 1 | `allowedCategories = ammunition` |
| Case, crossbow bolt | 1 | 20 bełtów | 1 | |
| Bag of Holding | 15 | 500 lb / 64 cu ft | **0** | `extradimensional`, nie mieści się w innej przestrzeni pozawymiarowej |
| Handy Haversack (Heward) | 5 | główna kieszeń 120 lb / 8 cu ft, dwie boczne po 20 lb / 2 cu ft | **0** | wyciągnięcie przedmiotu to akcja bonusowa, zawartość nie waży |
| Portable Hole | 0 | 6 ft średnicy, 10 ft głębokości (~282 cu ft) | **0** | `extradimensional` |
| Efficient Quiver | 2 | 3 przedziały: 60 strzał / 18 oszczepów lub włóczni / 6 łuków i podobnych | **0** | |
| Component Pouch | 2 | – | 1 | |

Szczegóły:
- **Efficient Quiver, Handy Haversack:** wiele przedziałów → docelowo lista `compartments`, każdy z własnym limitem. W v0.1 uproszczenie: jeden pojemnik z sumarycznym limitem (Haversack 160 lb / 12 cu ft), przedziały opisane w opisie przedmiotu.
- **Bag of Holding:** zawartość nie liczy się do udźwigu. UI pokazuje wagę własną (15 lb) i obok w nawiasie „zawartość: 230/500 lb (nie liczona)”.
- **Strata przy zniszczeniu pojemnika pozawymiarowego:** opcjonalny przycisk DM „zniszcz pojemnik” usuwa zawartość z logiem (czy zawartość znika do skarbca, DM wybiera).

## 6. Funkcje UI

### Widok gracza
- Nagłówek: imię postaci, SIŁ (edytowalna), udźwig, aktualna waga, pasek obciążenia, stan (`variant`).
- Drzewo ekwipunku: pojemniki rozwijalne, drag&drop przedmiotów między pojemnikami.
- Dodawanie: wyszukiwarka katalogu DM, ilość, pojemnik docelowy.
- Przenoszenie do/ze wspólnego skarbca jednym kliknięciem.
- Per pojemnik: pasek zapełnienia (waga i rozmiar), blokada przy przekroczeniu.
- Przełącznik jednostek lb/kg (jeśli DM dopuści per użytkownik).

### Widok DM
- Lista graczy z paskami obciążenia i alertami (kto jest przeciążony).
- Wejście w dowolny ekwipunek (tryb edycji).
- Katalog przedmiotów: lista, filtr, tworzenie/edycja/usuwanie (ostrzeżenie o użyciu, jeśli przedmiot jest już w czyimś ekwipunku).
- Zarządzanie pojemnikami (3.4), szablony z tabeli w 5.
- Wspólny skarbiec: pełna edycja.
- Wyślij przedmiot do gracza (wpis do ekwipunku bez zgody gracza).
- Ustawienia kampanii.

### Wspólny skarbiec (party)
- Ta sama struktura co ekwipunek (też z pojemnikami, np. wspólny wóz lub skrzynia).
- Waga skarbca liczona osobno, bez udźwigu (opcjonalnie ustawiany limit przez DM, np. „wóz: 600 lb”).

## 7. Architektura

- **API:** Node + Express 5 + `@libsql/client`, katalog `api/`, hosting Render (plan darmowy, `render.yaml`).
- **Baza:** Turso (hostowany SQLite, darmowy plan, trwały). Lokalnie i w testach ten sam klient na pliku SQLite.
- **Frontend:** React + Vite + Sass, katalog `web/`, hosting GitHub Pages przez GitHub Actions. Styl przeniesiony z `now-or-never-calculator` (fonty Cinzel / IM Fell English, ścięte ramki, tło).
- **Cold start:** darmowy Render usypia po ok. 15 min bezczynności; frontend pokazuje „Budzenie serwera…”, gdy żądanie trwa ponad 2,5 s.
- **Trwałość:** dane w Turso, więc restart i redeploy Rendera niczego nie kasują. Dodatkowa kopia: **eksport/import kampanii do JSON** (DM, zakładka Ustawienia).

### 7.1 Tabele
`campaigns`, `players`, `items`, `entries` (ekwipunek, `owner_type` = `player` | `party`, `parent_id` = pojemnik), `sessions`. Schemat w `api/src/db.js`, tworzony przy starcie API. Skarbiec ma `owner_id` = id kampanii. Klucze obce są tylko opisowe (Turso po HTTP nie trzyma `PRAGMA foreign_keys`), więc zależne wiersze (sesje, wpisy) usuwa aplikacja. Operacje odczyt-zapis idą w transakcjach, import w jednym atomowym batchu.

### 7.2 Autoryzacja (hasła, bez kont)
- **Tworzenie kampanii:** nazwa, **hasło DM**, **hasło kampanii** (muszą się różnić, min. 4 znaki). Kampania dostaje 6-znakowy kod (bez mylących znaków 0/O, 1/I/L).
- **DM** loguje się kodem i hasłem DM.
- **Nowa postać:** kod + hasło kampanii + imię + własne hasło postaci + SIŁ. Imię unikalne w kampanii (bez rozróżniania wielkości liter).
- **Gracz** loguje się potem kodem, imieniem i hasłem postaci (hasło kampanii nie jest już potrzebne).
- Hasła: scrypt z solą. Sesje: losowy token 256 bit w `localStorage`, w bazie hash SHA-256, nagłówek `Authorization: Bearer`.
- DM może ustawić nowe hasło postaci (wylogowuje gracza), zmienić hasło DM i hasło kampanii.
- Limit 20 prób na minutę na IP dla logowania i tworzenia.

### 7.3 Endpointy

```
POST   /campaigns                  utwórz kampanię -> token DM
POST   /auth/dm                    kod + hasło DM
POST   /auth/join                  kod + hasło kampanii + nowa postać
POST   /auth/player                kod + imię + hasło postaci
POST   /auth/logout
GET    /me                         rola, kampania, postać, kategorie

PATCH  /campaign                   nazwa, jednostki, tryb obciążenia, limit skarbca, hasła (DM)
GET    /players                    DM: wszyscy; gracz: tylko on (z udźwigiem i stanem obciążenia)
PATCH  /players/:id                gracz: SIŁ; DM: wszystko + nowe hasło
DELETE /players/:id                DM; ekwipunek trafia do skarbca

GET    /items                      katalog (z liczbą użyć)
POST   /items                      DM
POST   /items/templates            DM: dodaje pojemniki z 5e (tabela w 5.)
PATCH  /items/:id                  DM
DELETE /items/:id[?force=1]        DM; używany przedmiot wymaga force

GET    /inventory/party            skarbiec
GET    /inventory/player/:id       ekwipunek postaci (gracz: tylko swój)
POST   /inventory                  DM daje przedmiot z katalogu {ownerType, ownerId, itemId, quantity, parentId, force}
PATCH  /entries/:id                gracz: notatka, założone; DM: + ilość, waga egzemplarza
POST   /entries/:id/move           {ownerType, ownerId, parentId, quantity, force}; częściowa ilość dzieli stos
DELETE /entries/:id                DM; zawartość wypada piętro wyżej

GET    /export                     JSON (DM)
POST   /import                     JSON (DM), zastępuje postacie, katalog i ekwipunki
```

Naruszenie reguł (limity pojemników, kategorie, głębokość, pozawymiarowe w pozawymiarowym, limit skarbca) zwraca `409` z listą `problems`; DM może ponowić z `force: true`. Przedmioty `stackable` bez notatek łączą się w jeden stos. Odpowiedzi ekwipunku zawierają przeliczone wagi (`totalWeight`, `contentsWeight`, `contentsSize`, `capacity`, `encumbrance`), cała logika obliczeń jest w `api/src/calc.js`.

### 7.4 Aktualizacje na żywo
v0.1: odświeżanie po akcji + polling co 10 s (gdy karta jest widoczna). Przenoszenie przez listę „Dokąd” zamiast drag&drop (wygodniejsze na telefonie). Później: SSE lub WebSocket, drag&drop na desktopie.

## 8. Wymagania niefunkcjonalne
- Responsywny UI (telefon przy stole to główny scenariusz).
- Wszystkie obliczenia wagi deterministyczne i pokryte testami jednostkowymi.
- Zaokrąglanie: waga w UI do 2 miejsc po przecinku, obliczenia na liczbach rzeczywistych (lub w setnych funta jako integer, żeby uniknąć błędów zmiennoprzecinkowych).
- Walidacja wejścia po stronie serwera (zakresy SIŁ, wagi >= 0, ilości całkowite).
- Rate limiting na endpointach tworzenia kampanii i dołączania.
- Język UI: polski (z możliwością dodania angielskiego), nazwy przedmiotów dowolne.

## 9. Przyszłe rozszerzenia (po v0.1)
- **Monety:** 50 monet = 1 lb, liczniki cp/sp/ep/gp/pp wliczane do wagi.
- **Dostrojenie (attunement):** limit 3 przedmiotów magicznych.
- Zwierzęta jucze i wozy (udźwig konia, muła, wozu) jako dodatkowe „nosiciele” w kampanii.
- Wartość przedmiotów (gp) i podział łupów.
- Historia zmian (log: kto, co, kiedy) i cofanie.
- Cechy poza SIŁ, pełna karta postaci.
- Import przedmiotów z SRD (open5e API).
- Kategorie i tagi, zdjęcia przedmiotów.
- Powiadomienia (np. DM dostaje alert o przeciążonym graczu).

## 10. Plan realizacji (etapy)

1. **Moduł obliczeń** (udźwig, waga rekurencyjna, progi) + testy.
2. **Backend:** kampanie, tokeny, gracze, katalog, ekwipunek, walidacja pojemników.
3. **Frontend gracza:** widok ekwipunku, dodawanie, pojemniki, pasek obciążenia.
4. **Frontend DM:** katalog, podgląd wszystkich, edycja, ustawienia.
5. **Wspólny skarbiec** i transfery.
6. **Szablony pojemników** z tabeli 5, eksport/import JSON.
7. Deploy: API na Render, frontend na GitHub Pages, test cold startu, backup przez eksport JSON.

## 11. Otwarte pytania
- Czy gracz może tworzyć własne przedmioty, czy tylko wybierać z katalogu DM? (domyślnie: tylko katalog, opcja włączana przez DM)
- Tryb obciążenia domyślnie `simple` czy `variant`?
- Jednostki domyślnie lb czy kg?
- Czy jedna osoba może mieć kilka postaci w kampanii?
- Czy DM ma mieć też własny ekwipunek (NPC, sprzęt DM)?
- Czy transfer gracz → gracz ma wymagać akceptacji drugiej strony?
