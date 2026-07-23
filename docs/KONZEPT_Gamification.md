# Konzept – Gamification & Motivation
### Entwurf, Stand: 23.07.2026

Grundlage: `Lastenheft_Fitnessapp_Brainstorming.md` Abschnitt 4.6 (Gamification & Motivation), 4.8 (Benachrichtigungen) und 3 (Monetarisierung); `Technisches_Konzept_MVP.md` Abschnitt 3–5 (Datenmodell, Sync, Entitlements) und 7 (Kraftsteigerung-Prognose als Vorbild für „reine Funktion, kein Server-Compute"); `packages/shared/src/db/schema.ts`, `packages/shared/src/progression.ts`, `apps/mobile/src/lib/rest-timer.ts`, `PROJEKTSTATUS.md`.

Dieses Dokument ist ein technisches Konzept, kein Umsetzungscode. Es dockt bewusst eng an die bestehende Architektur an (Shared-Package mit reinen Funktionen, Sync-Konvention, Entitlements, lokale Notifications) statt neue Muster einzuführen.

---

## 1. Scope nach Priorität

Aus dem Lastenheft (Abschnitt 4.6):

| Feature | Priorität | Empfehlung 1. Ausbaustufe |
|---|---|---|
| Erinnerungen/Reminders | Soll | **Ja** – Paket 2 |
| Streak-Tracking (bis zu 4 Restdays) | Soll | **Ja** – Paket 1 |
| Achievements/Badges | Kann | **Ja** – Paket 3 |
| Challenges (vorgegeben, z. B. 30-Tage) | Kann | Nein, zurückgestellt |
| Eigene Challenges erstellen | Kann | Nein, zurückgestellt |

**Begründung der Empfehlung:** Reminders und Streak sind explizit „Soll" und damit für die erste Ausbaustufe gesetzt. Achievements sind zwar nur „Kann", aber – wie Abschnitt 3 zeigt – **rein client-seitig aus bereits vorhandenen Daten ableitbar**, brauchen keine neue Infrastruktur (keinen Server-Endpoint, kein Cron) und liefern für sehr geringen Zusatzaufwand einen hohen Motivationswert; sie werden daher mitgenommen. Challenges (vorgegeben wie eigene) brauchen dagegen ein eigenes Datenmodell für Definition **und** Fortschritt pro Nutzer, eine Vorstellung von „Community"/Vorlagen-Verwaltung und – bei eigenen Challenges mit Freunden – eine Anbindung an das noch unspezifizierte Social-Feature (Lastenheft 4.7, „Soll"/„Kann", selbst noch nicht konzipiert). Das ist ein eigenständiges, grösseres Arbeitspaket und wird bewusst auf eine spätere Ausbaustufe verschoben (siehe Abschnitt 8).

---

## 2. Streak-Logik im Detail

Das ist der anspruchsvollste Teil dieses Konzepts – der Lastenheft-Satz *„Streak bleibt mit bis zu 4 Restdays erhalten, damit auch Nutzer mit 1× Training/Woche eine Streak aufbauen können"* enthält zwei Aussagen, die unter der naheliegendsten Lesart **nicht beide gleichzeitig gelten** (siehe 2.3). Dieser Abschnitt macht die Regel zuerst präzise, rechnet sie dann an Beispielen durch und benennt den Zielkonflikt explizit, statt ihn zu verstecken.

### 2.1 Grundbegriffe

- **Aktiver Tag:** ein Kalendertag, an dem der Nutzer mindestens ein Workout mit `finishedAt IS NOT NULL` abgeschlossen hat (`workouts`-Tabelle, siehe `packages/shared/src/db/schema.ts`). Nur begonnene, nie abgeschlossene Workouts zählen nicht.
- **Restday:** ein Kalendertag zwischen zwei aktiven Tagen, an dem kein Workout abgeschlossen wurde.
- **Kalendertag/Zeitzone:** `finishedAt` ist ein Epoch-ms-Zeitstempel (Sync-Konvention); „welcher Kalendertag" das ist, hängt von einer Zeitzone ab. Da Client und Server **identisch** rechnen müssen (siehe 2.5), wird die Zeitzone **explizit als Parameter** übergeben statt implizit aus der Server- oder Geräteumgebung gelesen. Für den MVP (Nutzerkreis: Schweiz) ist ein fixer Default `Europe/Zurich` ausreichend; ein späteres Profil-Feld für die Zeitzone ist ein triviales Upgrade, ohne die Kernlogik anzufassen (siehe Abschnitt 9).

### 2.2 Formale Regel (rollierend, Tag-genau)

**Entscheidung: rollierend (Tag-Differenz), nicht wochenbasiert.** Begründung:

1. Nur eine Tag-genaue Regel implementiert die im Lastenheft **konkret genannte Zahl** „bis zu 4 Restdays" direkt. Eine Wochen-Variante bräuchte eine andere Formel und würde vom Wortlaut abweichen.
2. Eine Wochen-Variante müsste zusätzlich Wochengrenzen definieren (ISO-Woche? Mo–So? So–Sa?) und an Wochenübergängen Spezialfälle behandeln – zusätzliche Komplexität ohne Gegenwert.
3. Tag-genau verhält sich wie bekannte Streak-Mechaniken (Duolingo, GitHub-Contribution-Streak) und lässt sich in der UI granular kommunizieren („noch 1 Tag Zeit" statt „diese Woche noch nicht trainiert").
4. Es ist einfacher korrekt zu testen (siehe die durchgerechneten Beispiele in 2.4) und als reine Funktion zu verifizieren.

Für zwei aufeinanderfolgende aktive Tage mit Kalendertag-Differenz `Δ = nächsterAktiverTag − vorherigerAktiverTag` (in ganzen Tagen) gilt:

> **Restdays zwischen den beiden aktiven Tagen = Δ − 1.**
> **Die Kette (Streak) läuft weiter ⟺ Δ − 1 ≤ maxRestDays (Default 4), also Δ ≤ 5.**
> Andernfalls bricht die Kette am nächsten aktiven Tag ab und beginnt dort neu bei 1.

Für den **Live-Status "heute"** (Nutzer hat heute noch nicht trainiert, z. B. für die „Streak in Gefahr"-Notification, Abschnitt 5) gilt mit `Δ = heute − letzterAktiverTag`:

| Δ | Status |
|---|---|
| 0 | Heute bereits aktiv – Streak frisch bestätigt |
| 1–4 | Streak lebt, Restday-Budget wird genutzt, aber nicht ausgeschöpft |
| **5** | **`isAtRisk = true`** – letzter möglicher Tag: heute trainieren hält die Streak (Restdays wären dann genau 4), sonst bricht sie über Nacht |
| ≥ 6 | **`isBroken = true`** – Streak ist bereits gebrochen, rein durch Zeitablauf, ganz ohne dass ein neues Workout nötig wäre, um das festzustellen. `currentStreak` fällt auf 0; das nächste Workout beginnt eine neue Kette bei 1 |

Wichtig: **Restdays sind kein separat verwaltetes/gespeichertes Guthaben** (kein `rest_days_remaining`-Feld, kein „Streak-Freeze"-Kontingent wie z. B. bei Duolingo). Sie werden bei jeder Berechnung frisch aus der Lücke zwischen zwei aktiven Tagen abgeleitet. Das hält die Funktion zustandslos, sync-konform (identisches Ergebnis auf Client und Server ohne Extra-Tabelle) und robust gegenüber nachträglich gelöschten/bearbeiteten Workouts – ein gespeicherter Zähler würde in diesem Fall sofort veralten, eine berechnete Zahl ist immer korrekt.

### 2.3 Zielkonflikt: „4 Restdays" vs. „1× Training/Woche"

Die Lastenheft-Formulierung suggeriert, dass ein Nutzer, der exakt 1×/Woche trainiert, dauerhaft eine Streak halten kann. Durchgerechnet mit der Regel aus 2.2 stimmt das **nur bedingt**:

- Trainiert ein Nutzer **immer am selben Wochentag** (z. B. jeden Montag, Δ = 7 zwischen zwei Einheiten), sind das 7 − 1 = **6 Restdays** zwischen den Einheiten – das überschreitet den Cap von 4 **jede einzelne Woche**. Die Streak bricht dann bei jedem Zyklus und bleibt dauerhaft bei 1 stehen. Die wörtliche „bis zu 4 Restdays"-Regel unterstützt also **keinen strikt wöchentlichen Rhythmus mit fixem Wochentag**.
- Die Regel unterstützt tatsächlich: **mindestens alle 5 Kalendertage** ein Workout (Δ ≤ 5), das entspricht eher „etwas häufiger als 1×/Woche" (~1,4×/Woche) als „genau 1×/Woche".
- Ein unregelmässiges Muster, das im Schnitt bei „ca. 1×/Woche" liegt, aber nie mehr als 5 Tage Lücke lässt (z. B. Mo → Sa → Do → Di → So → …), hält die Streak dagegen unbegrenzt.

Das ist ein echter Zielkonflikt im Lastenheft, kein Rechenfehler – er wird in Abschnitt 9 als offene Entscheidung mit konkreten Optionen vorgelegt. Für dieses Konzept wird **die explizite Zahl (4 Restdays) als massgeblich** behandelt, weil sie die einzige konkrete Grösse im Anforderungstext ist; die weichere Formulierung „1×/Woche" wird als ungefähre Zielbeschreibung interpretiert, die mit „mindestens alle 5 Tage" nur näherungsweise erfüllt ist. `maxRestDays` ist als benannte Konstante/Parameter implementiert (nicht magisch verstreut), ein späteres Hochsetzen auf z. B. 6 (Δ ≤ 7, deckt echtes 1×/Woche exakt ab) ist dann eine Ein-Zeilen-Änderung.

### 2.4 Durchgerechnete Beispiele

Referenz: letzter aktiver Tag = **Montag** (Tag 0). `maxRestDays = 4`.

| # | Szenario | Δ | Restdays dazwischen | Ergebnis |
|---|---|---|---|---|
| 1 | Nächstes Workout **Freitag** (Tag 4) | 4 | 3 | Hält – Streak +1 |
| 2 | Nächstes Workout **Samstag** (Tag 5) | 5 | 4 | **Hält, genau an der Grenze** – „bis zu 4 Restdays" wörtlich ausgeschöpft, Streak +1 |
| 3 | **Aufgabenbeispiel:** Montag trainiert, dann 5 volle Restdays (Di–Sa), Auswertung **Sonntag** (Tag 6) ohne neues Workout | 6 | 5 | **Bricht.** `isBroken = true`, `currentStreak` fällt auf 0 – und zwar bereits am Sonntagmorgen, unabhängig davon, ob an diesem Sonntag noch trainiert wird. Trainiert der Nutzer am Sonntag doch noch, beginnt dort eine **neue** Kette bei 1 (Δ − 1 = 5 > 4, keine Fortsetzung der alten Kette) |
| 4 | Status-Abfrage am **Samstag** (Tag 5), noch nicht trainiert | 5 | – (live) | `isAtRisk = true` – letzte Chance, heute ist der Tag für die „Streak in Gefahr"-Notification (Abschnitt 5) |
| 5 | Striktes „1×/Woche, immer Montag": Mo → Mo → Mo → Mo (je Δ = 7) | 7 | 6 | **Bricht jede Woche neu.** `currentStreak` bleibt dauerhaft bei 1 – das ist der in 2.3 beschriebene Zielkonflikt, konkret durchgerechnet |
| 6 | Unregelmässig, aber nie > 5 Tage Lücke: Mo → Sa (Δ5) → Do (Δ5) → Di (Δ5) → … | immer ≤ 5 | immer ≤ 4 | Hält unbegrenzt, Streak wächst kontinuierlich |

### 2.5 Pseudocode

Zweistufig aufgebaut, analog zu `progression.ts` (generischer `linearRegression`-Kern + domänenspezifischer `strengthTrend`-Wrapper):

```text
// Generischer Kern – reine Funktion, testbar ohne DB/Zeitzone.
// activeDays: aufsteigend sortierte, eindeutige Kalendertage (Tagesnummern, z. B. Epoch-Tage)
// today: heutiger Kalendertag (gleiche Zeitzone wie activeDays!)
function streakFromActiveDays(activeDays, today, maxRestDays = 4):
  if activeDays.isEmpty():
    return { currentStreak: 0, longestStreak: 0, lastActiveDay: null,
             isAtRisk: false, isBroken: false }

  chain = 1
  longest = 1
  for i in 1..activeDays.length-1:
    gap = activeDays[i] - activeDays[i-1] - 1      // Restdays zwischen zwei aktiven Tagen
    chain = (gap <= maxRestDays) ? chain + 1 : 1     // Fortsetzen oder Kette neu bei 1
    longest = max(longest, chain)

  lastActive = activeDays[last]
  delta = today - lastActive

  currentStreak =
    (delta <= maxRestDays + 1) ? chain : 0           // Δ ≤ 5 lebt (ggf. in Gefahr), Δ ≥ 6 gebrochen

  return {
    currentStreak,
    longestStreak: longest,
    lastActiveDay: lastActive,
    isAtRisk: delta == maxRestDays + 1,
    isBroken: delta >= maxRestDays + 2,
  }

// Domänen-Wrapper – kapselt Zeitzone/Datenzugriff, analog strengthTrend(),
// das linearRegression() kapselt. Läuft identisch in App (lokale SQLite,
// Offline-fähig) und Web (Sync-Pull-Snapshot).
function computeWorkoutStreak(workouts, nowMs, timeZone = 'Europe/Zurich', maxRestDays = 4):
  activeDays = distinct( toCalendarDay(w.finishedAt, timeZone) for w in workouts if w.finishedAt != null )
  today = toCalendarDay(nowMs, timeZone)
  return streakFromActiveDays(sort(activeDays), today, maxRestDays)
```

`streakFromActiveDays` wäre der in `packages/shared` getestete, reine Baustein (Unit-Tests direkt für die Beispiele aus 2.4, analog zu `progression.test.ts`); `computeWorkoutStreak` das dünne, praxisnahe API, das App und Web tatsächlich aufrufen.

---

## 3. Datenmodell: berechnen vs. speichern

Zwei unterschiedliche Antworten für zwei unterschiedliche Fälle – beide ausdrücklich **ohne serverseitige KI/Cron**, alle Logik bleibt clientseitig ausführbare, reine Funktion in `packages/shared`.

### 3.1 Streak: berechnet, keine neue Tabelle

**Empfehlung: kein State.** Der Streak-Wert wird bei Bedarf live aus `workouts` berechnet (Abschnitt 2), exakt wie `strengthTrend` aus `workouts`/`workout_sets` berechnet wird – kein Server-Compute, kein Cron, kein zusätzlicher Sync-Aufwand.

Begründung:
- Trivial aus bereits synchronisierten Daten (`workouts.finishedAt`) ableitbar – nichts Neues zu synchronisieren.
- Ein gespeicherter Zähler wäre eine zweite Wahrheitsquelle, die bei jeder rückwirkenden Änderung (Workout gelöscht/Datum korrigiert) sofort invalidiert werden müsste. Eine berechnete Zahl ist per Definition immer konsistent mit dem aktuellen Datenstand.
- Folgt exakt der im Auftrag vorgegebenen Leitplanke: reine Funktion, client+server identisch, aus `workouts` ableitbar.

### 3.2 Achievements: als Sync-Tabelle mit `unlockedAt`

**Empfehlung: eigene, kleine Sync-Tabelle**, im Gegensatz zur Streak. Begründung:

- Der **Freischalt-Zeitpunkt** ist selbst eine sinnvolle, anzeigbare Information („errungen am 12.03.2026") – rein rechnerisch bei jedem Aufruf neu ableitbar wäre nur, *ob* eine Bedingung aktuell erfüllt ist, nicht *wann* sie zum ersten Mal erfüllt wurde.
- Für ein einmaliges „Achievement freigeschaltet!"-Toast/Notification muss zwingend unterschieden werden zwischen „war schon immer erfüllt" und „gerade neu erfüllt" – das erfordert einen Vergleich mit einem vorherigen Zustand, also zwangsläufig irgendeine Form von Persistenz.
- Passt nahtlos in die bestehende Sync-Architektur (Technisches Konzept Abschnitt 3+4): eine weitere schmale Tabelle mit denselben Konventionen wie `workouts`/`plans`, synchronisiert über die bereits vorhandenen `/sync/push`/`/sync/pull`-Endpunkte – ein auf Android freigeschaltetes Achievement erscheint automatisch im Web, ohne eigene Serverlogik.

**Wichtig:** Die *Auswertung* der Katalog-Bedingungen (Abschnitt 4) bleibt trotzdem eine reine Funktion in `packages/shared`, die auf bereits synchronisierten Basisdaten (`workouts`, `workout_sets`, Streak-Berechnung) läuft. Ausgeführt wird sie **clientseitig** – auf Mobile nach Workout-Abschluss/Sync, im Web nach dem Laden eines frischen `/sync/pull`-Snapshots (genau die Trigger-Punkte, die für Sync ohnehin schon existieren, siehe PROJEKTSTATUS M4/M6) – nicht auf dem Server per Cron. Erkennt ein Client eine neu erfüllte Bedingung, legt er lokal eine neue `achievements`-Zeile an, die beim nächsten Push synchronisiert wird wie jede andere Zeile auch. Ein Unique-Constraint auf `(userId, achievementKey)` verhindert doppelte Freischaltungen, falls zwei Geräte dieselbe Bedingung fast gleichzeitig erkennen (bei 2-3 Nutzern ein vernachlässigbar seltener Fall). Da das Produkt für einen kleinen, vertrauenswürdigen Nutzerkreis gebaut ist (wie bereits bei Workouts/Sätzen), ist keine serverseitige Anti-Cheat-Validierung vorgesehen – Client-geschriebene Zeilen werden wie überall sonst im Projekt vertraut.

### 3.3 Schema-Snippet (Drizzle, Sync-Stil)

Illustrativ, folgt den Konventionen aus `packages/shared/src/db/schema.ts` (client-generierte UUID-PK, Epoch-ms-Integer, `deleted`-Soft-Delete):

```ts
/**
 * Freigeschaltete Achievements (siehe docs/KONZEPT_Gamification.md, Abschnitt 4
 * für den Katalog). Faktisch append-only wie workout_sets: einmal freigeschaltet,
 * wird eine Zeile praktisch nie mehr verändert oder gelöscht – updatedAt/deleted
 * bleiben trotzdem für Konsistenz mit der Sync-Konvention vorhanden.
 */
export const achievements = sqliteTable(
  'achievements',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    /** Stabiler Katalog-Schlüssel (z. B. 'streak_30') — siehe ACHIEVEMENTS in packages/shared. */
    achievementKey: text('achievement_key').notNull(),
    /** Epoch ms — Zeitpunkt, an dem die Bedingung lokal als erfüllt erkannt wurde. */
    unlockedAt: integer('unlocked_at').notNull(),
    /** Epoch ms */
    createdAt: integer('created_at').notNull(),
    /** Epoch ms */
    updatedAt: integer('updated_at').notNull(),
    deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => ({
    // Verhindert doppelte Freischaltung derselben Achievement für denselben Nutzer.
    uniqueUnlock: unique().on(table.userId, table.achievementKey),
  }),
);

export type Achievement = typeof achievements.$inferSelect;
export type NewAchievement = typeof achievements.$inferInsert;
```

Begleitende Anpassungen (nicht Teil dieses Dokuments, nur benannt für die Umsetzung):
- `'achievements'` zur `SYNC_TABLES`-Liste in `packages/shared/src/sync.ts` hinzufügen + passendes Zod-Zeilenschema (analog zu `exerciseRowSchema` etc.).
- Migration generieren: `pnpm --filter @ascent/api db:generate` sowie `pnpm --filter @ascent/mobile db:generate` (shared Schema 1:1, wie im CLAUDE.md beschrieben).
- Ownership-Auflösung in der Sync-Route wie bei den anderen `userId`-tragenden Tabellen (kein Eltern-Umweg nötig wie bei `plan_exercises`/`workout_sets`).

---

## 4. Achievement-Katalog

Statischer Daten-Katalog, analog zu `PLAN_TEMPLATES` in `packages/shared/src/templates.ts` – eine Konstante in `packages/shared`, **kein** Code, der die Bedingungen selbst auswertet (das ist separate Auswertungslogik, die auf diesem Katalog + den Basisdaten läuft).

```ts
/** Analog zu PlanTemplate in packages/shared/src/templates.ts. */
export type AchievementCategory = 'einstieg' | 'konsistenz' | 'kraft' | 'vielfalt';

export type AchievementDefinition = {
  /** Stabiler Schlüssel — wird als achievementKey persistiert, NIE umbenennen. */
  key: string;
  category: AchievementCategory;
  titleDe: string;
  descriptionDe: string;
};
```

| Key | Kategorie | Titel | Bedingung (Datenquelle) |
|---|---|---|---|
| `first_workout` | Einstieg | Erster Schritt | Erstes Workout mit `finishedAt IS NOT NULL` abgeschlossen (`workouts` ≥ 1) |
| `plan_created` | Einstieg | Eigener Fahrplan | Erster eigener Trainingsplan erstellt (`plans` ≥ 1) |
| `body_metric_logged` | Einstieg | Standortbestimmung | Erster Körpermass-Eintrag erfasst (`body_metrics` ≥ 1) |
| `ten_workouts` | Konsistenz | Zehn Einheiten | 10 abgeschlossene Workouts insgesamt |
| `fifty_workouts` | Konsistenz | Halbes Hundert | 50 abgeschlossene Workouts insgesamt |
| `streak_7` | Konsistenz | Eine Woche dran | `longestStreak` (aus `computeWorkoutStreak`, Abschnitt 2) ≥ 7 |
| `streak_30` | Konsistenz | Ein Monat dran | `longestStreak` ≥ 30 |
| `streak_100` | Konsistenz | Hundert Tage | `longestStreak` ≥ 100 |
| `pr_10_percent` | Kraft | Erster Kraftschub | Für irgendeine Übung: bestes Einheiten-1RM (Epley, `progression.ts`) ≥ 110 % des 1RM der ersten dokumentierten Einheit derselben Übung |
| `volume_10000` | Kraft | 10 Tonnen bewegt | Σ (`weightKg × reps`) über alle `workout_sets` ≥ 10'000 kg |
| `volume_100000` | Kraft | 100 Tonnen bewegt | Σ (`weightKg × reps`) über alle `workout_sets` ≥ 100'000 kg |
| `exercise_variety_15` | Vielfalt | Allrounder | ≥ 15 verschiedene `exerciseId` jemals in `workout_sets` geloggt |

12 Einträge über vier Kategorien (Einstieg/Onboarding, Konsistenz, Kraft/Leistung, Vielfalt) – bewusst alle aus bereits vorhandenen Tabellen und `progression.ts` ableitbar, ohne neue Datenerfassung. `pr_10_percent` deckt implizit die im Lastenheft (4.5, „Soll") separat gewünschte „Persönliche Rekorde automatisch erkennen"-Funktion in Achievement-Form ab, ersetzt eine eigenständige PR-Erkennungs-UI aber nicht.

---

## 5. Reminders/Notifications

Dockt an das bestehende `apps/mobile/src/lib/rest-timer.ts`-Muster an: modul-globaler Zustand statt React-State (überlebt Screen-Wechsel), `Notifications.setNotificationHandler` (bereits global gesetzt – nicht doppelt registrieren), Permission einmal pro Sitzung anfragen, `scheduleNotificationAsync`/`cancelScheduledNotificationAsync`-Paar zum Setzen/Widerrufen. **Kein Server-Push nötig** – wie im Auftrag gefordert, rein lokale Notifications, funktionieren auch offline (konsistent mit der Offline-First-Architektur).

Neues Modul, z. B. `apps/mobile/src/lib/reminders.ts`, mit zwei Notification-Arten:

**(a) Trainingserinnerung** (tägliche, konfigurierbare Uhrzeit, Default z. B. 18:00): Bei jedem der bestehenden Sync-Trigger-Punkte (App-Start, `AppState`-active gedrosselt, Workout-Abschluss – siehe PROJEKTSTATUS M4/M6, dieselben Punkte, keine neuen Listener nötig) wird abgeglichen: Wurde heute bereits ein Workout abgeschlossen? Wenn ja → geplante „Heute"-Notification stornieren, „Morgen"-Notification einplanen. Wenn nein → sicherstellen, dass eine Notification für heute zur konfigurierten Uhrzeit geplant ist (falls noch keine existiert). Exakt dasselbe Schedule/Cancel-Paar wie in `rest-timer.ts`, nur auf Kalendertag- statt Sekunden-Granularität.

**(b) Streak in Gefahr:** ausgelöst durch `computeWorkoutStreak(...).isAtRisk` (Δ = `maxRestDays + 1`, siehe 2.2), ausgewertet an denselben Trigger-Punkten. Ist `isAtRisk === true` und noch keine entsprechende Notification für heute geplant → lokale Notification einplanen („Deine Serie von N Tagen ist in Gefahr – heute nochmal ran!"). Wird danach doch noch ein Workout abgeschlossen, storniert derselbe Workout-Abschluss-Trigger die Notification (wie `cancelScheduledNotification` in `rest-timer.ts`).

**Bekannte Grenze (MVP, akzeptiert):** Ohne Background-Task/Cron (kein EAS-Background-Fetch im Scope) hängt das *Nachplanen* der jeweils nächsten Notification vom nächsten App-Öffnen ab – dieselbe Einschränkung gilt bereits für den bestehenden Sync-Trigger „AppState-active gedrosselt". Die bereits eingeplante Notification selbst feuert zuverlässig über das Betriebssystem, auch bei geschlossener App.

**Empfehlung:** Die Permission-Anfrage-Logik (`ensurePermissionGranted`-Äquivalent) aus `rest-timer.ts` in einen kleinen gemeinsamen Helfer auslagern statt in `reminders.ts` zu duplizieren – reine Code-Hygiene, keine fachliche Notwendigkeit. Ausserdem bündeln mit dem bereits offenen M3-Nachtrag „Android-Notification-Channel (Heads-up im Hintergrund)" aus PROJEKTSTATUS – beide brauchen dieselbe saubere Channel-Konfiguration für zuverlässige Zustellung bei geschlossener/hintergründiger App.

---

## 6. Entitlements

Neue Feature-Flag-Keys, analog zur bestehenden Namenskonvention (`stats.web.basic`, `ai.suggestions`, siehe `apps/api/seed/feature_flags.sql`):

```sql
-- Illustrativ, nicht eingespielt – Ergänzung zu apps/api/seed/feature_flags.sql
INSERT OR REPLACE INTO feature_flags (key, required_tier, enabled, description, updated_at) VALUES
  ('gamification.reminders', 'free', 1, 'Lokale Trainings-/Streak-Erinnerungen', 0),
  ('gamification.streak', 'free', 1, 'Streak-Tracking (Home-Header, Dashboard-Kachel)', 0),
  ('gamification.achievements', 'free', 1, 'Achievements/Badges', 0),
  ('gamification.challenges', 'pro', 0, 'Challenges, vorgegeben + eigene (noch nicht gebaut)', 0);
```

**Empfehlung: Reminders, Streak und Achievements zunächst `free`.** Begründung: alle drei sind reine Client-Berechnung ohne laufende Server-/KI-Kosten – die Freemium-Logik aus Lastenheft Abschnitt 3 soll Features mit echtem Backend-/KI-Aufwand oder hochwertigem Zusatzcontent (erweiterte Statistik, Export) monetarisieren, nicht eine kostenlose Nebenmotivation. `gamification.challenges` bleibt als deaktivierter Platzhalter analog zu `ai.suggestions` stehen (noch nicht gebaut, Tier-Zuordnung offen).

**Ausdrücklich zu bestätigen:** Lastenheft Abschnitt 8 legt fest, dass die Feature-zu-Tier-Zuordnung für Post-MVP-Funktionen (inkl. Gamification) *erst nach einer Testphase mit echten Nutzungsdaten* entschieden wird. Diese Empfehlung ist ein sinnvoller Startpunkt, kein endgültiger Entscheid (siehe Abschnitt 9). Gating passiert wie überall im Projekt ausschliesslich über `useEntitlement('gamification.streak')` bzw. das mobile Äquivalent – nie über hartcodierte Bedingungen.

---

## 7. UI-Flächen

| Fläche | App (Mobile) | Web |
|---|---|---|
| **Streak** | Kleiner Header/Chip auf dem Home-Screen (Flammen-Icon + Zahl), direkt neben dem bestehenden Start-/Fortsetzen-CTA. Füllt zugleich einen Teil der in PROJEKTSTATUS M6 notierten Leerfläche „Home 90 % Void" | Neue Stat-Kachel im bestehenden Dashboard (`DashboardPage.tsx`), neben den vorhandenen Basis-Statistik-Kacheln – da `free`, ohne Pro-Teaser |
| **Achievements** | Eigener Screen, erreichbar über das Profil (kein neuer Bottom-Tab – Tab-Leiste ist knapp, Achievements sind niedrigere Priorität als die Kern-Tabs) | Neue Route `/erfolge`, analog zur bestehenden Namenskonvention (`/plaene`, `/uebungen`, `/verlauf`) |

Beide Achievement-Flächen zeigen den vollen Katalog (Abschnitt 4) als Grid/Liste, freigeschaltete Einträge mit Freischalt-Datum (`unlockedAt`), gesperrte Einträge ausgegraut mit Bedingungstext.

---

## 8. Etappen-Vorschlag

| # | Paket | Inhalt | Fertig wenn… |
|---|---|---|---|
| 1 | Streak-Kern | `streakFromActiveDays`/`computeWorkoutStreak` in `packages/shared` + Unit-Tests (Beispiele aus 2.4), Home-Header (App), Dashboard-Kachel (Web), Feature-Flag `gamification.streak` | Streak-Zahl auf beiden Plattformen korrekt, Tests grün |
| 2 | Reminders | `apps/mobile/src/lib/reminders.ts` (Trainingserinnerung + Streak-in-Gefahr), Notification-Channel-Tuning (bündelt den offenen M3-Nachtrag), Feature-Flag `gamification.reminders` | Beide Notification-Arten lösen an den bestehenden Sync-Trigger-Punkten korrekt aus/storniert |
| 3 | Achievements | `achievements`-Tabelle + Migration (API+Mobile), Sync-Integration (`SYNC_TABLES`, Zod-Schema), Katalog-Konstante in `packages/shared`, lokale Auswertungslogik nach Workout-Abschluss/Sync, Achievements-Screen (App) + `/erfolge` (Web), Feature-Flag `gamification.achievements` | Alle 12 Katalog-Einträge korrekt herleitbar, Freischaltung synchronisiert zwischen Geräten |

Challenges (vorgegeben + eigene) bewusst **nicht** als Paket 4 in dieser ersten Ausbaustufe – eigenes Konzept-Dokument bei Bedarf (siehe Abschnitt 9).

---

## 9. Offene Entscheidungen

1. **Zielkonflikt „4 Restdays" vs. „1×/Woche" (Abschnitt 2.3):** `maxRestDays = 4` wörtlich übernehmen (empfohlen, mit angepasster In-App-Formulierung „mindestens alle 5 Tage" statt „1×/Woche") – oder den Cap auf 6 anheben, um einen strikt wöchentlichen Rhythmus mit fixem Wochentag exakt abzudecken? Da `maxRestDays` als Parameter implementiert ist, ist das später eine Ein-Zeilen-Änderung – die Entscheidung kann auch nach ersten echten Nutzungsdaten (2-3 Personen) nachgezogen werden.
2. **Zeitzone für „Kalendertag" (Abschnitt 2.1):** fixer Default `Europe/Zurich` für den MVP akzeptabel, oder soll gleich ein Zeitzone-Feld im Nutzerprofil ergänzt werden?
3. **Freemium-Zuordnung der Gamification-Flags (Abschnitt 6):** Empfehlung „alle drei free" ist ein Vorschlag, keine Festlegung – Lastenheft Abschnitt 8 sieht die endgültige Zuordnung erst nach einer Testphase vor.
4. **Achievements-Backfill:** Sollen beim Rollout rückwirkend alle bereits erfüllten Bedingungen aus der kompletten bisherigen Historie ausgewertet werden (einmaliger Backfill beim ersten App-Start nach Update), oder zählt nur, was ab Rollout-Datum neu passiert? Da die Auswertung rein aus vorhandenen Daten läuft, ist Backfill ohne Mehraufwand möglich – empfohlen, aber zu bestätigen (sonst wirkt es unfair, wenn ein Nutzer mit 50 Alt-Workouts bei 0 Achievements startet).
5. **Challenges (Abschnitt 1/8):** bewusst nicht in dieser Konzeptstufe spezifiziert (Kann-Priorität, höherer Aufwand). Bei Bedarf als eigenes Konzept-Dokument nachziehen, sobald Streak/Reminders/Achievements in Nutzung sind und die Social-Anbindung (Lastenheft 4.7) klarer ist.
6. **Social-Anbindung:** Sollen Streaks/Achievements später auch für die 1-2 Trainingspartner sichtbar sein (kleiner „Freunde"-Feed, Lastenheft 4.7)? Nicht Teil dieses Konzepts, aber ein naheliegender Anknüpfungspunkt für eine spätere Ausbaustufe.
7. **Lokale Notifications vs. Server-Push:** Für den MVP rein lokal (wie in Abschnitt 5 begründet) – soll das bewusst so bleiben, auch wenn später echte Server-Push-Anwendungsfälle dazukommen (z. B. „dein Trainingspartner hat gerade eine Serie gestartet"), die zwingend serverseitig ausgelöst werden müssten?
