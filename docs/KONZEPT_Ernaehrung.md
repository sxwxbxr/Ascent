# Technisches Konzept – Ernährungs-Modul
### Stand: 23.07.2026 — Entwurf für die Bau-Planung (Orchestrator zerlegt dies in Arbeitspakete)

Dieses Dokument spezifiziert das Ernährungs-Modul aus dem Lastenheft (Abschnitt 4.4) technisch, im selben Stil wie `Technisches_Konzept_MVP.md`. Es dockt an die bestehende Architektur an (Sync-Konventionen aus `packages/shared/src/db/schema.ts`/`sync.ts`, Entitlements aus `apps/api/src/index.ts`, CRUD-Router-Muster aus `apps/api/src/routes/body-metrics.ts`/`exercises.ts`). Kein Code, nur illustrative Schema-/Router-Skizzen. Ziel: 2-3 private Nutzer, kein öffentliches Produkt — Umfang bewusst schlank geschnitten.

Fakten zu Open Food Facts (OFF) in Abschnitt 3 sind gegen die offizielle Doku verifiziert (siehe Quellenangaben dort), nicht aus dem Gedächtnis übernommen.

---

## 1. Scope V1 vs. später

Lastenheft 4.4 listet fünf Features mit Prioritäten. Für 2-3 Privatnutzer, die schnell beim Essen loggen wollen, empfiehlt sich folgender Zuschnitt:

| Feature | Lastenheft-Prio | V1? | Begründung |
|---|---|---|---|
| Kalorien-/Makro-Tracking (Tagebuch, Ziele) | Muss | **Ja** | Kernfunktion, ohne die das Modul nutzlos ist. |
| Lebensmitteldatenbank via Open Food Facts | Muss | **Ja** | Ohne Produktdaten müsste jede Mahlzeit komplett manuell mit kcal/Makros erfasst werden — das scheitert in der Praxis nach wenigen Tagen (Reibungsverlust zu hoch). Text-Suche reicht für V1, kein Barcode nötig. |
| Wasser-Tracking | Soll | **Ja** | Trivial in Aufwand (ein Zähler pro Tag, kein externer Datenzugriff), da günstig huckepack auf dem Tagebuch-Datenmodell (Abschnitt 2) mitnehmbar. Aufwand/Nutzen-Verhältnis exzellent — nicht separat verschieben. |
| Barcode-Scanner | Soll | **Nein, V1.1** | Braucht eine neue native Kamera-Permission (`expo-camera`) in einer Mobile-App, die noch **nie auf einem echten Gerät lief** (M3-Status laut `PROJEKTSTATUS.md`). Ein zweites ungetestetes Risiko (Kamera-Permission-Flow) direkt neben einem ersten (Ernährungs-Sync) zu stapeln, ist unnötig. Text-Suche gegen dieselbe OFF-Anbindung deckt denselben Bedarf ab, nur einen Tastendruck langsamer. Die serverseitige Barcode-Lookup-Route wird aber **in V1 mitgebaut** (Abschnitt 3) — sie wird ohnehin für die Datenmodell-Konsistenz gebraucht (Produkte haben einen Barcode als Schlüssel) und kostet ohne Kamera-UI kaum Mehraufwand. Nur die Scan-*Oberfläche* verschiebt sich. |
| Rezepte/Mahlzeitenplanung | Kann | **Nein** | Mehrere Zutaten × Mengen-Skalierung × Wiederverwendung ist ein eigenes kleines Feature mit spürbarem Aufwand, ohne das das Tagebuch funktioniert. Bewusst nicht im Etappenplan (Abschnitt 8), nur als Backlog-Idee vermerkt. |

**V1-Ergebnis:** Tagebuch (Mahlzeiten + Wasser) mit OFF-Produktsuche, manuelle Schnelleinträge als Fallback, Kalorien-/Makro-Ziele, Web-Statistik-Karte. Barcode-Scanner und Rezepte sind bewusst spätere Ausbaustufen (V1.1 bzw. offen).

---

## 2. Datenmodell

Drei neue Tabellen, alle im Stil von `packages/shared/src/db/schema.ts`: text-UUID-Primärschlüssel, Epoch-ms-Integer-Timestamps (`createdAt`/`updatedAt`), `deleted`-Soft-Delete-Flag.

### 2.1 `foods` — Cache von Lebensmitteln (OFF-Produkte + eigene)

Analog zu `exercises`: globale, geteilte Zeilen (`userId = null`, aus OFF importiert/gecacht) und eigene Zeilen (`userId` gesetzt, z. B. selbst gekochte Gerichte ohne Barcode) teilen sich dieselbe Tabelle.

```ts
export const foods = sqliteTable('foods', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id), // null = globaler OFF-Cache-Eintrag
  barcode: text('barcode'), // EAN/GTIN; null bei eigenen Lebensmitteln ohne Barcode
  name: text('name').notNull(),
  brand: text('brand'),
  // Nährwerte je 100 g/ml (OFF-Konvention) — Basis für die Snapshot-Berechnung in food_entries
  kcalPer100: real('kcal_per_100').notNull(),
  proteinPer100: real('protein_per_100'),
  carbsPer100: real('carbs_per_100'),
  fatPer100: real('fat_per_100'),
  servingSizeG: real('serving_size_g'), // optionale Portionsgrösse laut OFF ("serving_size")
  source: text('source', { enum: ['off', 'custom'] }).notNull().default('custom'),
  offLastFetchedAt: integer('off_last_fetched_at'), // Epoch ms; für spätere Refresh-Strategie
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
});
```

**Wichtige Skalierungs-Annahme:** `foods` wird NICHT als vollständiger OFF-Spiegel gedacht (das wären Millionen Zeilen), sondern rein bedarfsgesteuert befüllt — nur Produkte, die einer der 2-3 Nutzer tatsächlich gesucht/gescannt hat, landen hier. Für den Nutzerkreis bleibt die Tabelle über Jahre im niedrigen drei- bis vierstelligen Bereich.

### 2.2 `food_entries` — Tagebuch (Mahlzeiten + Wasser)

```ts
export const foodEntries = sqliteTable('food_entries', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  entryType: text('entry_type', { enum: ['food', 'water'] }).notNull().default('food'),
  foodId: text('food_id').references(() => foods.id), // null bei Wasser ODER manuellem Schnelleintrag ohne Katalog-Zeile
  /** ISO-Datum (YYYY-MM-DD) — der Tag, dem der Eintrag im Tagebuch zugerechnet wird. */
  loggedDate: text('logged_date').notNull(),
  mealSlot: text('meal_slot', { enum: ['breakfast', 'lunch', 'dinner', 'snack'] }), // null bei entryType 'water'
  amountG: real('amount_g'), // Menge in Gramm; nur bei entryType 'food'
  amountMl: real('amount_ml'), // Menge in ml; nur bei entryType 'water'
  // Snapshot der Nährwerte ZUM ERFASSUNGSZEITPUNKT (kcal/Makros bleiben stabil,
  // auch wenn sich der zugehörige foods-Cache-Eintrag später ändert — analog
  // dazu, dass workout_sets bereits geloggte weightKg/reps nie neu berechnet).
  kcal: real('kcal'),
  proteinG: real('protein_g'),
  carbsG: real('carbs_g'),
  fatG: real('fat_g'),
  /** Epoch ms — Erfassungszeitpunkt (Reihenfolge/Audit; für die Tagesgruppierung zählt loggedDate). */
  loggedAt: integer('logged_at').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
});
```

**Wasser als eigener Eintragstyp** (wie im Auftrag vorgegeben): eine Tabelle statt einer eigenen `water_entries`-Tabelle. Vorteil: Tages-Gruppierung, CRUD-Route, Sync-Tabelle und lokale Mobile-Ablage werden nur einmal gebaut, nicht zweimal. Nachteil: pro Zeile bleiben je nach `entryType` einige Spalten ungenutzt (`mealSlot`/`amountG` bei Wasser, `amountMl` bei Essen) — bei SQLite-Zeilenzahlen im niedrigen Tausenderbereich vernachlässigbar. Alternative (eigene schlanke `water_entries`-Tabelle mit nur `id`/`userId`/`loggedDate`/`amountMl`/`loggedAt`) wäre typsauberer, aber ein zusätzliches Sync-Tabellen-Paar (Schema+API+Sync+Screens) für ein Soll-Feature — nicht empfohlen.

`loggedDate` als eigenes ISO-Datumsfeld (nicht aus `loggedAt` clientseitig abgeleitet): verhindert Zeitzonen-/Geräte-Inkonsistenzen bei der Tagesgruppierung und erlaubt "auf gestern nachtragen" wie in gängigen Ernährungs-Apps.

### 2.3 Ernährungsziele: eigene Tabelle statt Profil-Felder

**Diskussion:** Analog zu `heightCm`/`goal` auf `users` wäre es naheliegend, `kcalTarget`/Makro-Targets einfach als weitere Spalten auf `users` zu legen und über die bestehende `GET/PUT /profile`-Route zu bedienen (kleinster Umbauschritt). Dagegen sprechen zwei Punkte, die für die Präzedenz von `body_metrics` sprechen (ebenfalls eine "profilnahe" persönliche Kennzahl, aber bewusst NICHT auf `users`, sondern als eigene History-Tabelle):

1. **Historisierung.** Ziele ändern sich (Aufbau- vs. Diätphase) — für rückwirkend korrekte Statistik ("war das damalige Ziel erreicht?") braucht es mehrere Zeilen über die Zeit, nicht eine mutierte Spalte. `users` hat kein `deleted`/History-Konzept.
2. **Offline-Verfügbarkeit.** `GET /profile` ist laut `apps/mobile/src/data/profile.ts` explizit **"nur online verfügbar"** (kein Sync-Table-Eintrag, kein lokaler Mirror). Kalorienziele sollten aber wie der Rest des Tagebuchs offline sichtbar/nutzbar sein (z. B. "noch 400 kcal übrig" beim Einkaufen ohne Empfang).

**Empfehlung:** eigene Sync-Tabelle `nutrition_goals`, ein Muster wie `body_metrics` — anfügend statt überschreibend:

```ts
export const nutritionGoals = sqliteTable('nutrition_goals', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  /** ISO-Datum (YYYY-MM-DD) — ab wann dieses Ziel gilt. */
  effectiveFrom: text('effective_from').notNull(),
  kcalTarget: integer('kcal_target').notNull(),
  proteinTargetG: real('protein_target_g'),
  carbsTargetG: real('carbs_target_g'),
  fatTargetG: real('fat_target_g'),
  waterTargetMl: integer('water_target_ml'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
});
```

Für V1 reicht "verwende immer das neueste, nicht gelöschte Ziel" (kein Blick auf `effectiveFrom` in der Auswertung nötig) — das Feld existiert aber schon, damit die spätere rückwirkende Auswertung ohne Migration nachrüstbar ist (siehe offene Entscheidung 5 in Abschnitt 9).

### 2.4 SYNC_TABLES-Erweiterung

`packages/shared/src/sync.ts` definiert `SYNC_TABLES` bewusst in Anwendungsreihenfolge (Eltern vor Kindern, wegen D1-Fremdschlüsseln). `food_entries.foodId` referenziert `foods.id` → `foods` muss vor `food_entries` stehen. `nutrition_goals` hat keine Fremdschlüssel-Abhängigkeit zu den beiden anderen neuen Tabellen, wird aber thematisch danach einsortiert:

```ts
export const SYNC_TABLES = [
  'exercises',
  'plans',
  'plan_exercises',
  'workouts',
  'workout_sets',
  'body_metrics',
  'foods',           // neu — Eltern von food_entries (globaler OFF-Cache + eigene Lebensmittel)
  'food_entries',    // neu — referenziert foods.id (nullable)
  'nutrition_goals', // neu — eigene userId-Spalte, keine Eltern-Auflösung nötig
] as const;
```

Zeilenschemas (`syncRowSchemas`) analog zu `exerciseRowSchema`/`bodyMetricRowSchema` (siehe `packages/shared/src/sync.ts`): `foodRowSchema` mit `barcode`/`name`/`brand`/den vier `*Per100`-Feldern optional bis auf `kcalPer100`; `foodEntryRowSchema` mit `entryType`-Enum, `loggedDate` als `z.iso.date()` (wie `profileSchema.birthDate`), `loggedAt` als `epochMs`; `nutritionGoalRowSchema` analog zu `bodyMetricRowSchema` mit `effectiveFrom` als `z.iso.date()`. `syncPushRequestSchema`/`syncPullRequestSchema` erweitern sich um die drei Tabellen nach demselben Muster (max. 500 Zeilen/Tabelle, `since`-Cursor optional).

**Owner-Auflösung beim Push** (`apps/api/src/routes/sync.ts`, welches NICHT generisch ist, sondern pro Tabelle eine `apply*`-Funktion + manuellen Push-Loop-Eintrag + manuelle Pull-Query hat — siehe Code): `food_entries` und `nutrition_goals` haben wie `body_metrics` eine eigene `userId`-Spalte → einfachster Fall, kein `ownerOfPlan`/`ownerOfWorkout`-Äquivalent nötig. `foods` folgt exakt dem `exercises`-Muster (global `userId = null` nie überschreibbar, eigene Zeilen nur vom Owner).

---

## 3. Open Food Facts Integration

### 3.1 Verifizierte Fakten (offizielle Doku, Stand dieser Recherche)

- **Endpunkte:** Produkt-Lookup per Barcode `GET https://world.openfoodfacts.org/api/v3/product/{barcode}.json` (aktuell; v2 existiert noch, gilt als deprecated). Strukturierte Suche `GET /api/v2/search` bzw. `/cgi/search.pl` (Parameter wie `search_terms`); echte Volltextsuche empfiehlt die Doku über den separaten Dienst *Search-a-licious* (search.openfoodfacts.org) — für V1 nicht nötig, die strukturierte Suche reicht.
- **Staging-Umgebung:** `https://world.openfoodfacts.net` (HTTP Basic Auth `off`/`off`) — sinnvoll für Entwicklung/Tests, um die Produktions-Rate-Limits nicht anzutasten.
- **Authentifizierung:** Lesezugriffe brauchen keinen API-Key, aber laut Doku **zwingend** einen aussagekräftigen `User-Agent`-Header im Format `AppName/Version (Kontakt-E-Mail)` ("always use a custom User-Agent to identify your app"). Schreibzugriffe (nicht relevant hier) brauchen Zugangsdaten.
- **Rate-Limits (offizielle Doku, Abschnitt "Rate limits"):** **15 Requests/Minute/IP** für alle lesenden Produkt-Abfragen (`GET /api/*/product`), **10 Requests/Minute/IP** für Such-Abfragen (`GET /api/*/search`, `/cgi/search.pl`). Keine Limite auf Schreib-Requests. Zusätzlich globale, IP-unabhängige Limits — bei Überschreitung HTTP 503. Bei Missbrauch behält sich OFF eine IP-Sperre vor.
- **Lizenz:** Datenbank-Struktur unter **Open Database License (ODbL) 1.0**, Inhalte unter **Database Contents License (DbCL) 1.0** (beide über Open Data Commons). Produktbilder unter **CC BY-SA 3.0** (können aber Elemente enthalten, die zusätzlichem Copyright unterliegen). Beide Lizenzen verlangen bei Weiterverbreitung/Erstellung abgeleiteter Datenbanken eine Namensnennung; für die reine Anzeige von Nährwertfakten an eingeloggte Endnutzer (kein Re-Publizieren der Datenbank) ist ein sichtbarer Attributions-Hinweis ("Daten von Open Food Facts, ODbL-lizenziert") die verbreitete, sichere Praxis.

Quellen: `https://openfoodfacts.github.io/openfoodfacts-server/api/` (Endpunkte, Auth, Rate-Limits), `https://world.openfoodfacts.org/data` (Lizenzen), `https://openfoodfacts.github.io/openfoodfacts-server/api/ref-cheatsheet/` (Endpunkt-Syntax).

### 3.2 Architektur-Entscheidung: Worker-Proxy statt direkter Client-Call

**Empfehlung: eigener Worker-Endpunkt (`apps/api/src/routes/foods.ts`) proxyt/cacht gegen OFF, kein direkter Aufruf von App oder Web aus.** Begründung, konkret an dieser Anforderung:

1. **Der `User-Agent`-Header ist im Browser nicht setzbar.** `User-Agent` steht auf der Forbidden-Header-Liste von `fetch`/`XMLHttpRequest` — ein Web-Client kann die von OFF geforderte Kennzeichnung technisch gar nicht senden. Ein Server-Proxy (Worker `fetch`, node-artiger Kontext) kann es. Für die Android-App wäre ein direkter Call zwar technisch möglich (Hermes/native `fetch` unterliegt der Browser-Restriktion nicht), aber dann bräuchte man zwei verschiedene Implementierungen für dieselbe Regel — unnötig.
2. **Zentrales Rate-Limit-Budget.** 15/10 Requests pro Minute sind pro *IP*, nicht pro Nutzer. Bei 2-3 Personen mit App **und** Web gleichzeitig ist das Budget schnell aufgebraucht, wenn jedes Gerät einzeln anfragt. Ein Worker bündelt alle Aufrufe hinter einer Instanz und kann selbst drosseln (z. B. clientseitiges Debouncing der Sucheingabe um 400-500 ms, siehe unten) statt dass jedes Gerät blind gegen OFF läuft.
3. **Zentrales Caching in D1 (`foods`-Tabelle).** Zwei Trainingspartner, die im selben Supermarkt/Gym dieselben Produkte (Proteinpulver, Riegel) kaufen, profitieren vom Cache-Treffer des jeweils anderen — ohne erneuten OFF-Call. Nach einer kurzen Einlaufzeit sind die meisten Lookups reine D1-Reads, das OFF-Rate-Limit wird real kaum berührt.
4. **Offline-Verhalten (siehe unten) fällt so "gratis" aus derselben Sync-Pull-Mechanik heraus, die `exercises` schon nutzt.**

### 3.3 Konkrete Endpunkte

Nach dem Muster von `exercises.ts` (dieselbe Datei/derselbe Router bedient sowohl Suche als auch CRUD für eigene Einträge):

- **`GET /foods?q=<text>`** — analog zu `GET /exercises?q=`: erst lokale `foods`-Tabelle (LIKE auf `name`/`brand`, global + eigene), dann — falls online und Ergebnis dünn — ein Live-Aufruf gegen `/api/v2/search`, Ergebnisse werden als globale Zeilen (`userId = null`) in `foods` upgeserted und gemeinsam mit den Cache-Treffern zurückgegeben. Debounce clientseitig 400-500 ms (bei 2-3 Nutzern bleibt das Team so komfortabel unter 10 req/min).
- **`GET /foods/barcode/:code`** — Cache-first per `barcode`-Spalte; bei Miss `GET /api/v3/product/{barcode}.json`, Mapping auf `kcalPer100`/`proteinPer100`/… , Upsert als globale Zeile, Rückgabe der `foods`-Zeile (inkl. `id`, damit der Client sofort einen `food_entries`-Eintrag anlegen kann) oder 404, falls OFF das Produkt nicht kennt (Client fällt dann auf den manuellen Schnelleintrag zurück).
- **`POST /foods`** / **`PUT /foods/:id`** / **`DELETE /foods/:id`** — CRUD für eigene Lebensmittel (`userId` gesetzt, `source: 'custom'`), Ownership-Check identisch zu `exercisesRouter` (globale Zeilen matchen die `userId`-Bedingung nie → 404 statt 403, kein Existenz-Leak).
- Alle drei liegen **hinter `requireAuth`** (Erweiterung der `PROTECTED`-Liste in `apps/api/src/index.ts` um `/foods`, `/food-entries`, `/nutrition-goals`) — bewusst nicht öffentlich wie `mediaRouter`, weil jeder Aufruf potenziell OFF-Quota kostet.
- Worker setzt bei jedem OFF-Call einen festen `User-Agent: Ascent/<version> (<Kontakt-E-Mail>)`.

### 3.4 Offline-Verhalten

- **Tagebuch-Einträge (`food_entries`) funktionieren immer offline**, solange das referenzierte `foods`-Produkt bereits lokal gecacht ist (per Sync, wie globale `exercises`-Zeilen heute schon offline verfügbar sind). Wasser-Einträge brauchen nie Netz.
- **Neue Produktsuche/Barcode-Lookup ohne Netz:** schlägt sauber fehl ("Offline — Produkt kann erst online gesucht werden"), UI bietet direkt den manuellen Schnelleintrag an (`foodId = null`, `kcal`/Makros freihändig eingegeben) — dieselbe Fluchttür wie "eigene Übung anlegen" heute bei Übungen ohne Datenbank-Treffer.
- Kein Sonderfall nötig: der bestehende Sync-Pull bringt neu gecachte globale `foods`-Zeilen wie gewohnt aufs zweite Gerät, sobald es wieder online ist.

---

## 4. Barcode-Scanner (App, V1.1)

- **Paket:** `expo-camera` (`CameraView`-Komponente mit `barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}` und `onBarcodeScanned`-Callback). Der früher separate `expo-barcode-scanner` ist deprecated, die Funktion ist heute in `expo-camera` selbst eingebaut — kein zusätzliches Paket nötig.
- **Permission:** `useCameraPermissions()`-Hook aus `expo-camera`; Kamera-Nutzungsbeschreibung im `app.json`-Plugin-Eintrag (analog zum bestehenden `expo-font`-Plugin-Eintrag für Inter aus M6). Erstmaliger Aufruf zeigt den System-Dialog; bei Ablehnung bleibt die Text-Suche als vollwertiger Ersatz nutzbar (Scannen ist reiner Beschleuniger, kein Pflichtpfad).
- **Fallback:** kein Treffer/keine Permission/kein Netz → derselbe manuelle Schnelleintrag-Pfad wie in Abschnitt 3.4.
- Technisch nutzt der Scanner denselben `GET /foods/barcode/:code`-Endpunkt, der in V1 bereits existiert (Abschnitt 3.3) — V1.1 baut nur die Kamera-Oberfläche obendrauf, keine neue Server-Logik.

---

## 5. Entitlements

Lastenheft Abschnitt 3: Ernährung ist Post-MVP, die Free/Pro-Zuordnung ist **explizit offen**, wird "nach Testphase anhand von Nutzungsdaten" entschieden. Folglich: Flags jetzt anlegen, `required_tier` erstmal auf `free` seeden (Datensammlung ermöglichen), Umschaltung später ohne Code-Änderung über `feature_flags` (siehe `apps/api/seed/feature_flags.sql`, Muster wie `stats.web.basic` etc.):

| Key | Vorschlag `required_tier` (Start) | Gate für |
|---|---|---|
| `nutrition.tracking` | `free` | Tagebuch (Mahlzeiten-CRUD), OFF-Suche/Barcode-Lookup, Ziele-Verwaltung — das Kernmodul. |
| `nutrition.water_tracking` | `free` | Wasser-Widget separat schaltbar, falls sich das Kernmodul bewährt, Wasser-Tracking aber ungenutzt bleibt (unabhängig deaktivierbar, ohne das ganze Modul zu sperren). |
| `nutrition.stats.web` | `free` | Die kcal-Trend-Karte im Web-Dashboard (Abschnitt 7) — eigener Key statt Wiederverwendung von `stats.web.advanced`, weil das Lastenheft Ernährung als eigenständige, unabhängig zu entscheidende Post-MVP-Achse führt (nicht als Erweiterung der Kraft-Statistik). |

Für **In-App-Statistiken** (Android) gilt bereits der bestehende Key `stats.app` ("Statistiken in der App sind Abo-pflichtig", Lastenheft Abschnitt 3) — eine etwaige Ernährungs-Trend-Ansicht *in der App* wird an genau diesen bestehenden Key gehängt, keinen neuen Key dafür erfinden. Das reine Tagebuch-*Erfassen* in der App ist keine "Statistik" und bleibt unabhängig davon nutzbar (sonst wäre das Modul auf dem Handy — wo tatsächlich gegessen wird — nutzlos).

Clients gaten wie gehabt ausschliesslich über `useEntitlement('nutrition.tracking')` (Web) bzw. das mobile Äquivalent — nie über hartcodierte Bedingungen.

---

## 6. UI-Flächen

### App (Expo)

Neuer 5. Tab **"Ernährung"** neben Home/Pläne/Verlauf/Profil (`apps/mobile/app/(tabs)/`):

- **Tagesansicht** (Standard-Screen): Datums-Navigator (Pfeile vor/zurück, wie ein Mini-Kalenderstreifen), kcal-Summe vs. Ziel (Balken/Ring), drei kleine Makro-Balken (Protein/Kohlenhydrate/Fett), darunter Sektionen je `mealSlot` (Frühstück/Mittag/Abend/Snack) mit den jeweiligen Einträgen + "+ Hinzufügen"-Button.
- **Lebensmittel-Picker (Modal)**, geöffnet über "+ Hinzufügen": Suchfeld (debounced gegen `GET /foods?q=`), Barcode-Scan-Button (öffnet `CameraView`-Sheet, V1.1), zuletzt verwendete/häufige Lebensmittel oben, manuelles Schnelleintrag-Formular (Name + kcal/Makros frei) ganz unten als Fallback.
- **Wasser-Widget**: einfacher Stepper (+250 ml/-250 ml o. ä.) mit Tagesziel-Balken, kein eigener Screen nötig.
- **Ziele-Formular**: entweder eigener Screen im Ernährungs-Tab oder als Sektion in "Profil" (`(tabs)/profil.tsx`) — leichte Präferenz für einen Abschnitt im Ernährungs-Tab, weil die Ziele inhaltlich zum Modul gehören, nicht zum Konto.

### Web (Vite SPA)

Neue Seite **`/ernaehrung`** (deutsche Route, konsistent mit `/plaene`) statt Einbettung ins bestehende Dashboard — Begründung: Erfassung passiert primär am Handy (unterwegs beim Essen), Web ist wie bei Kraft/Körpergewicht vor allem Auswertungs-/Korrektur-Fläche, verdient aber wegen des eigenen Tagebuchs eine eigene Seite statt nur einer zusätzlichen Dashboard-Karte:

- Tagebuch-Tabelle (Tagesauswahl, Einträge nach `mealSlot` gruppiert, Bearbeiten/Löschen) — analog zur Listendarstellung in `HistoryPage.tsx`.
- kcal-/Makro-Trend-Chart (Abschnitt 7).
- Ziele-Formular (analog zum Gewichts-Erfassungsformular in `DashboardPage.tsx`).
- Zusätzlich: eine kompakte "kcal heute"-Karte direkt im bestehenden `DashboardPage.tsx` (wie die Körpergewicht-Karte), mit Link zur vollen `/ernaehrung`-Seite — hält das Dashboard als zentralen Einstiegspunkt konsistent.

---

## 7. Statistik-Anbindung

Analog zur Körpergewicht-Karte in `apps/web/src/pages/DashboardPage.tsx` (`bodyMetricsChartData`/`LineChart` mit den `CHART_*`-Farbkonstanten aus derselben Datei — für visuelle Konsistenz wiederverwenden, nicht neu erfinden):

- **kcal-Trend:** `food_entries` (nur `entryType: 'food'`) nach `loggedDate` gruppieren, `kcal` pro Tag summieren, als `LineChart`-Punkt pro Tag plotten. Ziel-Linie aus `nutritionGoals` (aktuellstes Ziel) als Recharts `ReferenceLine` einzeichnen.
- **Kein Regressions-/Trendlinien-Modell nötig** — anders als die Kraftsteigerung-Prognose (die laut Lastenheft/Technischem Konzept erst ab 3-5 Trainingseinheiten eine statistische Trendlinie zeigt), ist der kcal-"Trend" hier eine reine historische Aggregation, keine Vorhersage. Deutlich einfacher, `strengthTrend` aus `packages/shared/src/progression.ts` wird dafür nicht gebraucht.
- **Snapshot-Stabilität:** weil `food_entries.kcal`/Makros zum Erfassungszeitpunkt eingefroren sind (Abschnitt 2.2), bleibt die Statistik stabil, auch wenn sich ein `foods`-Cache-Eintrag später durch einen neuen OFF-Abgleich ändert.
- Makro-Aufteilung (Protein/Kohlenhydrate/Fett) als optionale zweite Karte (gestapelter Balken pro Tag) — für V1 nicht zwingend, kcal-Trend allein deckt die Muss-Anforderung aus Lastenheft 4.5 ("Dashboard mit Fortschrittscharts für … Ernährung") ab.

---

## 8. Etappen-Vorschlag

Vier Arbeitspakete mit striktem Verzeichnis-Eigentum (Muster wie M0-M6, passend zur im Projekt etablierten Arbeitsweise mit parallelen Subagenten). N1 → N2 zwingend sequenziell; N3 und N4 hängen beide nur von N1+N2 ab, nicht voneinander, und können **parallel** delegiert werden.

| # | Paket | Verzeichnis | Inhalt | Abhängigkeit |
|---|---|---|---|---|
| N1 | Schema & Validierung | `packages/shared` | `foods`/`food_entries`/`nutrition_goals` in `db/schema.ts`; Create-/Update-Zod-Schemas in `validation.ts`; `SYNC_TABLES`-Erweiterung + Row-/Push-/Pull-Schemas in `sync.ts`; `db:generate`-Migration für die API. | — |
| N2 | API | `apps/api` | `routes/foods.ts` (Suche+Barcode-Proxy+eigene-CRUD), `routes/food-entries.ts`, `routes/nutrition-goals.ts` (beide analog `body-metrics.ts`); Mount + `PROTECTED`-Erweiterung in `index.ts`; drei neue `apply*`-Funktionen + Push-Loop/Pull-Query-Erweiterung in `routes/sync.ts` (mechanisch, aber pro Tabelle von Hand — `sync.ts` ist nicht generisch); `feature_flags`-Seed um die drei neuen Keys erweitern; Tests analog `body-metrics.test.ts`/`exercises.test.ts`, OFF-Calls dabei gemockt (kein Live-Traffic in Tests — Rate-Limit/Erreichbarkeit sonst ein Test-Flakiness-Risiko). | N1 |
| N3 | Mobile (Sync + Screens) | `apps/mobile` | Lokale Migration (drizzle-kit `expo`) für die drei Tabellen; `src/db/sync.ts`-Anschluss (Push/Pull, analog M4); `src/data/nutrition.ts` (Foods-Suche/Barcode, Tagebuch-/Ziele-CRUD); neuer Tab "Ernährung" mit Tagesansicht, Picker-Modal, Wasser-Widget, Ziele-Formular; `expo-camera` als neue Abhängigkeit + Permission-Flow (Barcode-UI selbst kann als V1.1-Nachtrag *innerhalb* dieses Pakets separat markiert werden, siehe Abschnitt 4). Grösstes Paket. | N1, N2 |
| N4 | Web | `apps/web` | Neue Seite `/ernaehrung`; `lib/snapshot.ts`-Erweiterung um die drei Tabellen; kcal-Trend-Karte in `DashboardPage.tsx`; Ziele-Formular. | N1, N2 |

---

## 9. Offene Entscheidungen für den Nutzer

1. **Tier-Default der drei neuen Feature-Flags** — Vorschlag ist `free` für alle drei während der Testphase (siehe Abschnitt 5), aber die endgültige Zuordnung ist laut Lastenheft explizit dem Nutzer nach der Testphase vorbehalten.
2. **Barcode-Scanner-Timing** — kommt die Kamera-UI direkt in N3 mit (Abschnitt 4 als Unter-Task) oder erst als separate V1.1-Etappe, nachdem N3 sich am echten Gerät bewährt hat? Empfehlung: separat, da M3 noch nie gerätegetestet wurde und eine neue native Permission ein zusätzliches Erstrisiko ist.
3. **OFF-Attributionshinweis** — genaue Platzierung/Formulierung (Fusszeile im Ernährungs-Tab? Auf jeder Produktdetailseite? Beides?) ist eine inhaltliche, keine rein technische Entscheidung.
4. **Kontakt-E-Mail für den OFF-`User-Agent`-Header** — OFF verlangt eine erreichbare Kontaktadresse im Header-String; welche (z. B. eine dedizierte Adresse statt der privaten) ist zu klären.
5. **Historisierung der Ernährungsziele** — reicht "immer das neueste Ziel" für die V1-Statistik, oder soll rückwirkend das zum jeweiligen Tag gültige Ziel (`effectiveFrom`) berücksichtigt werden? Beeinflusst, ob diese Logik schon in N2 oder erst später gebaut wird.
6. **Rezepte/Mahlzeitenplanung** — bewusst komplett aus dem Etappenplan raus. Nur als Backlog-Idee vermerken oder ganz fallen lassen?
7. **Zusammenführung eigener Lebensmittel mit späteren OFF-Treffern** — falls ein Nutzer ein Produkt manuell anlegt, das später auch über OFF gefunden wird: für V1 bewusst getrennt lassen (keine Dedupe-Logik), zur Bestätigung.
