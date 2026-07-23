# Projektstatus – Ascent
### Stand: 23.07.2026 — Ernährungs-Modul gebaut & committet; Prod-Rollout OFFEN (morgen weiter)

**⚠️ MORGEN ZUERST — Ernährungs-Prod-Rollout abschliessen** (Code committet+gepusht bis `8935b5d`, aber NICHT deployed; Rollout wurde auf Nutzerwunsch pausiert):
1. `pnpm --filter @ascent/api db:migrate:remote` → wendet Migration **0004** an (legt `foods`/`food_entries`/`nutrition_goals` in der Remote-D1 an). **Aktuell fehlen diese Tabellen remote** — remote sind nur 0000–0003 verbucht, 0004 ist echt ausstehend (kein „falsch-markiert"-Problem, sauber nachholbar). Danach verifizieren, dass die 3 Tabellen existieren.
2. `pnpm --filter @ascent/web build` → dann `pnpm --filter @ascent/api run deploy` (Worker+SPA mit Ernährung live).
3. `/ernaehrung` live prüfen; neueste Ernährungs-APK aus GitHub Actions herunterladen (nach `beta/`) für den Gerätetest.

Resting State ist SICHER: der aktuell deployte Worker hat noch KEINE Ernährungs-Routen und läuft gesund; die 3 Ernährungs-Feature-Flags sind remote schon geseedet (harmlos); lokale D1 hat 0004 bereits. Nichts ist kaputt — nur der Rollout ist unvollständig.

**Ernährungs-Modul (23.07., gebaut, lokal verifiziert — typecheck/Build/Bundle grün, 121 API-Tests):** Schema `foods`/`food_entries`/`nutrition_goals` + Sync + Validierung (N1); API inkl. Open-Food-Facts-Worker-Proxy (Text-Suche + Barcode-Lookup, Cache in D1, User-Agent aus `OFF_USER_AGENT_CONTACT`-Var = Repo-URL, austauschbar) + Feature-Flags (N2); Mobile-Tab „Ernährung" (Tagesansicht, Picker, Wasser, Ziele; Barcode-Kamera bewusst V1.1) (N3); Web `/ernaehrung` + „kcal heute"-Karte + kcal-Trend (N4). Konzept: `docs/KONZEPT_Ernaehrung.md`. Gamification-Konzept liegt bereit (`docs/KONZEPT_Gamification.md`), noch nicht gebaut.

### Stand: 21.07.2026 — MVP live (App+Web); laufend Feature-Ausbau & Gerätetest-Fixes

**App+Web live** auf **https://ascent-api.sweber.workers.dev** (derselbe Worker serviert SPA + API same-origin), Beta-APK unter `beta/app-release.apk` (bzw. Actions-Artefakt "ascent-beta-apk").

**Seit dem 20./21.07. (nach Gerätetests) neu:**
- **Übungsnamen + Anleitungen komplett Deutsch/Englisch** (alle 1'324): DE-Namen kuratiert, EN-Namen orthografisch korrigiert, DE-Ausführungsschritte nummeriert (`instruction_steps_de`); Detailseiten (App+Web) bevorzugen Deutsch. Kuratiert in `scripts/data/*.i18n.json`, vom Import-Script gemergt, lokal+remote angewendet. Kommt per Sync ohne neue APK.
- **Web-Plandetailseite** (`/plaene/:planId`): Übungsliste, geschätzte Dauer, **Muskel-Karte vorne/hinten, männlich/weiblich (Profil)**, eingefärbt nach Intensität (`@mjcdev/react-body-highlighter`). Editor → `/plaene/:planId/bearbeiten`.
- **Web: Übung → Plan** (Spotify-Stil, `AddToPlanMenu`).
- **Standardplan-Vorlagen** (`packages/shared/templates.ts`, 8 bekannte Pläne): Mobile-Start-Picker hat ein „Vorlagen"-Dropdown (klont in eigenen Plan + startet).
- **Gerätetest-Fixes:** Picker-Race (eigene Pläne fehlten) behoben; **0 kg** für Körpergewichts-Übungen erlaubt (Validierung+Sync+Client); **Kaltstart-Crash** — Ursache war `PRAGMA journal_mode=WAL` beim Modul-Import (uncatchbar durch die ErrorBoundary); Fix: `journal_mode=DELETE` + selbstheilendes DB-Öffnen (löscht korrupte lokale DB und legt frisch an, statt abzustürzen). **Noch am Gerät zu bestätigen — bei erneutem Crash `adb logcat` nötig.**

**Noch offen:** M7-Release (eigener Signing-Keystore, APK-Download-Button + version.json-Check — Banner-UI existiert), Passwort-Reset-UI + Mail, Ernährungs-/Gamification-Konzepte (Agenten waren an früherem Session-Limit gestorben — neu zu starten).

Einstiegsdokument für die Weiterarbeit. Grundlagen: `Lastenheft_Fitnessapp_Brainstorming.md` (Anforderungen), `Technisches_Konzept_MVP.md` (Architektur & Etappenplan M0–M6), `CLAUDE.md` (Arbeitskonventionen, Kommandos).

---

## Was fertig ist

### M0 (Scaffolding + Cloud-Setup)
- Monorepo (pnpm, TS strict): `packages/shared`, `apps/api`, `apps/web`, `apps/mobile` + GitHub-Actions-CI
- Cloudflare live: Worker unter **https://ascent-api.sweber.workers.dev**, D1 `ascent-db` (EEUR), R2 `ascent-media`
- Web-SPA und Expo-App als gestylte Platzhalter (Design-Tokens aus `design/`)

### M1 (Backend: Auth, CRUD, Sync) — lokal komplett verifiziert
- **Auth (Better Auth)**: Email/Passwort-Login, Sessions (Cookie + Bearer-Plugin für Mobile), Passwort-Reset-Flow (Mail = Log-Stub in `apps/api/src/mail.ts`, Resend später einsteckbar). **Zugriffsschutz wie vom Nutzer entschieden**: Registrierung NUR mit Invite-Code (`POST /invites`, 14 Tage gültig, einmal verwendbar); Ausnahme: allererster Nutzer (Bootstrap). Rate-Limits (DB-Storage) auf sign-in/sign-up/reset. `tier`-Feld ist gegen Client-Manipulation geschützt (input:false, am Bibliotheks-Code verifiziert).
- **CRUD**: `/plans` (inkl. Plan-Übungen), `/workouts` (inkl. Sätze), `/exercises` (global + eigene), `/body-metrics`, `/profile` — überall Ownership-Checks (fremd → 404, kein Existenz-Leak), Soft-Delete, client-generierte UUIDs, partielle Updates.
- **Sync**: `POST /sync/push` + `POST /sync/pull` mit Last-Write-Wins auf `updatedAt`; Ownership auch für Kind-Tabellen über Eltern-Auflösung (plan_exercises/workout_sets); globale Übungen nie durch Clients überschreibbar; Löschungen propagieren als `deleted`-Upserts.
- **Entitlements**: `/entitlements` löst jetzt echt auf (anonym = free; Session → `users.tier`; Rang free < trial < pro). Feature-Gating bleibt zentral, nie hartcodiert.
- **Tests: 89 grün** (7 shared + 82 api auf echter lokaler D1 via vitest-pool-workers), Typecheck monorepo-weit sauber. E2E-Smoke-Test via REST komplett durchgespielt (Bootstrap → Invite → Registrierung → CRUD → Sync → Entitlements inkl. Pro-Tier).

### M2 (Übungsdatenbank) — live in Produktion
- 1'324 Übungen in Prod-D1 (deterministische UUIDv5-IDs → idempotente Re-Importe via `scripts/import-exercises.ts`), 2'648 Medien (GIFs+Thumbnails) in R2, ausgeliefert über `GET /media/*` (öffentlich, Immutable-Cache, ETag/304 — live verifiziert). Kein Deutsch im Datensatz: `nameDe`/`instructionsDe` NULL, UI fällt auf Englisch zurück. **Lizenz:** Metadaten MIT, Medien © Gymvisual (nur für Quell-Repo lizenziert) — vor Freemium-Start zwingend ersetzen.

### M3 (Android-Kern) — implementiert, Bundle-verifiziert, NICHT gerätegetestet
- **Fundament:** expo-router (Session-Guard via Stack.Protected), lokale SQLite mit Drizzle und dem shared Schema (Migrationen via drizzle-kit driver 'expo' + babel inline-import; PRAGMA foreign_keys/WAL), Better-Auth-Expo-Client (SecureStore; Offline-Start mit gecachter Session am Bibliotheks-Quellcode verifiziert), Übungs-Hydration über POST /sync/pull mit Cursor in SecureStore.
- **Screens:** Login/Registrierung (mit Invite-Code), Profil (Invite-Codes erstellen/teilen, Logout), Pläne (Liste/Editor mit Zielsätzen/Wdh/Pause, Reorder), Übungs-Browser (Suche, Kategorie-/Equipment-Filter, GIF-Detail, eigene Übungen), aktives Training (Satz-Logging mit Tap-to-Repeat-Prefill, persistenter Pausentimer mit lokaler Notification, Abschluss-Summary), Verlauf (Monatsgruppen, Detail mit Epley-1RM), Home (Start-CTA/Fortsetzen-Banner).
- **Verifikation:** `tsc --noEmit` + `expo export --platform android` (Metro-Bundle) grün. Auf einem echten Gerät lief die App noch NIE — erster Beta-Test steht aus.
- **APK-Pipeline:** `.github/workflows/android-apk.yml` baut bei Push (apps/mobile, packages/shared) eine Release-APK (Debug-signiert bis M6-Keystore) als Actions-Artefakt "ascent-beta-apk".

## Bekannte Stolperfallen (Kosten bereits bezahlt — nicht erneut hineinlaufen)

| Thema | Detail |
|---|---|
| pnpm `deploy` | `pnpm --filter @ascent/api run deploy` — ohne `run` greift pnpms eingebauter Befehl |
| `localhost` vs `127.0.0.1` | wrangler bindet nur IPv4; Vite-Proxy + alle Smoke-Tests auf 127.0.0.1:8787 |
| `nodejs_compat` | Better Auth braucht node:crypto/async_hooks → Flag in wrangler.jsonc, sonst startet der Worker nicht (Tests laufen trotzdem — der Vitest-Pool handhabt das selbst!) |
| vitest-pool-workers 0.18+ | Neue API: `cloudflareTest()`-Vite-Plugin statt `defineWorkersConfig`/`/config`-Subpath; Typen via `@cloudflare/vitest-pool-workers/types`; env-Typisierung global über `Cloudflare.Env`. **Keine Per-Test-Storage-Isolation mehr** (nur pro Datei) — Tests räumen selbst auf (DELETE in umgekehrter FK-Reihenfolge) oder nutzen eindeutige Daten |
| Lokaler D1-State | ist nach `database_id` verschlüsselt — ändert sich die ID in wrangler.jsonc, startet eine leere lokale DB (Migration + Seed erneut ausführen) |
| Better Auth basePath | `/auth` ist in `apps/api/src/auth/auth.ts` UND im Mount in index.ts verankert — bei Änderung beides nachziehen |
| users-Tabelle | createdAt/updatedAt sind Date-typisiert (mode 'timestamp_ms', Storage bleibt Epoch-ms) weil Better Auth Dates schreibt — alle anderen Tabellen plain Epoch-ms-Integer |
| Tailwind-Versionen | Web = v4 (CSS-first, kein Config-File); Mobile = 3.4.x (NativeWind) — absichtlich |
| `.npmrc` node-linker=hoisted | zwingend für Metro/RN — nicht entfernen |
| `useLiveQuery` (drizzle expo) | (1) re-subscribed nur bei explizitem deps-Array — parametrisierte Queries mit anfangs undefined-IDs brauchen deps, sonst bleiben sie leer; (2) Reaktivität NUR auf der FROM-Basistabelle, Joins lösen nichts aus — Basistabelle = die Tabelle, auf die geschrieben wird |
| Hermes | kein crypto.randomUUID — UUIDs via expo-crypto (src/lib/ids.ts) |
| drizzle `ilike` | rendert ILIKE (kennt SQLite nicht) — stattdessen like(lower(col), pattern) |
| workers.dev-Propagation | Nach Erst-Deploy kurz Edge-Fehler 1042/1104 — nach ~20 s stabil |

## Offene Punkte

1. **⚠️ Bootstrap-Registrierung des Owners steht aus**: Die allererste Registrierung (App-Registrierungsscreen oder REST) braucht KEINEN Invite-Code — der Owner sollte seinen Account zeitnah anlegen, damit dieses Fenster geschlossen ist.
2. **Erster Gerätetest der Beta-APK** (Actions-Artefakt "ascent-beta-apk" herunterladen, sideloaden): Login → Hydration (1'324 Übungen) → Plan anlegen → Workout im Flugmodus erfassen → Pausentimer/Notification. M3 ist nur Bundle-verifiziert!
3. **Passwort-Reset-UI fehlt** (Login-Link + Web-Reset-Seite; Server-Flow existiert, Mail = Log-Stub — Link via `wrangler tail` ablesbar)
4. **Eigener Signing-Keystore** (M6): bis dahin Debug-signiert — beim Umstieg einmalig Deinstallation nötig
5. **Altes Design-Zip** (3.5 MB) in Git-Historie; **Lizenz-Gate** Übungsmedien vor Abo-Aktivierung
6. Kleinere M3-Nachträge: Android-Notification-Channel (Heads-up im Hintergrund), AKTIV/ARCHIVIERT-Badge für Pläne (braucht Schema-Spalte), Mehrfachauswahl im Übungs-Picker

### M4 (Sync-Client) — implementiert
Push mit persistenten Per-Tabellen-Cursorn (SecureStore, chargenfest), Pull mit lokalem LWW (ungesyncte lokale Änderungen gewinnen lokal, gehen beim nächsten Push hoch), globale Übungen werden nie gepusht. Trigger: App-Start (nach upsertLocalUser verkettet), Workout-Ende, AppState-active (gedrosselt 1×/2 Min), manueller Button im Profil (mit Sync-Status/Fehleranzeige).

### M5 (Web-Dashboard) — implementiert und live
Login/Registrierung (Invite-Code) via Better-Auth-Web-Client (**Achtung: relative baseURL wird nicht unterstützt** — window.location.origin + basePath '/auth'). Datenquelle: EIN /sync/pull-Snapshot (Context mit reload()). Seiten: Dashboard (1RM-Chart mit Epley + strengthTrend-Trendlinie ab 3 Sessions, Körpergewicht-Chart+Erfassung, Stat-Kacheln, Pro-Teaser via useEntitlement), Verlauf (aufklappbar), Pläne (/plaene — bewusst deutsch, kollisionsfrei zu API /plans!), Einstellungen (Profil, Invites), Download (Interims-Anleitung). **Deployment: derselbe Worker serviert die SPA** (wrangler.jsonc "assets": ../web/dist, SPA-Fallback, API-Pfade via run_worker_first) — same-origin, kein CORS. CI baut Web VOR den API-Tests (der Vitest-Pool lädt wrangler.jsonc und braucht dist/).

## M6 — UX-Offensive & Live-Sync: implementiert & deployed (20.07.), Gerätetest 2 ausstehend

**Gerätetest-Befunde (Screenshots in docs/img):** (1) SafeArea-Top fehlt auf ALLEN Screens ohne Stack-Header — Titel/Beenden-Button überlappen die OS-Statusleiste, Beenden im Training kaum treffbar; (2) Training-Screen träge (Sekunden-Ticker re-rendert den ganzen Screen inkl. Inputs); (3) Tab-Icons kaputt (Platzhalter-Glyphen, kein Icon-Font); (4) Akzentfarben-Missbrauch überall (lime auf Namen/Werten/Sekundär-Buttons — nichts hat Priorität); (5) tote Eingabefelder ("kg"/"Wdh" als Placeholder, keine Prefills sichtbar, Wdh-Felder ohne Placeholder); (6) Pause-Chips ohne sichtbare Selektion, "frei"-Chip-Rendering defekt; (7) Übungszahl-Inkonsistenz Home-Modal vs. Pläne-Tab (useLiveQuery-Basistabellen-Falle im leftJoin-Count); (8) leere Screens ohne Hierarchie (Home 90% Void, Verlauf-Empty-State oben angeklatscht); (9) System-Font statt Inter, Zahlen nicht tabular; (10) englische Muskelnamen.

**M6-Scope:** (A) Fundament: SafeArea-Screen-Wrapper (src/ui/Screen.tsx), echte Ionicons-Tabs, Inter als native Font-Familie (app.json expo-font-Plugin, tailwind font-sans — RN vererbt nicht, jede Text-Komponente braucht die Klasse); (B) Screen-Rework nach Akzent-Diät (bg-primary NUR für den einen Haupt-CTA/aktive Zustände) inkl. Training-Header-Fix + Performance (isolierter Ticker, memoisierte Blöcke, unkontrollierte Inputs); (C) **Live-Sync**: App pusht debounced 4 s nach jeder Änderung (queueSyncPush in src/db/sync.ts, Aufrufe in allen src/data/*-Mutationen), Web pollt Deltas (10 s bei sichtbarem Tab + focus, Cursor-Merge in snapshot.ts) — Ende-zu-Ende-Latenz ~5-15 s ohne F5.

**Nachtrag 20.07.:** Alle 1'324 Übungsnamen zweisprachig (DE kuratiert via `scripts/data/exercise-names.i18n.json`, EN orthographisch korrigiert — Import-Script mergt beim `sql`-Generieren; Clients erhalten Namen via Sync, keine App-Änderung nötig). Übungs-Detailseiten mit Vollbild-Medien, Muskel-Infos (neue Spalten muscle_group/secondary_muscles/instruction_steps_en, Migrationen api 0002/mobile 0001), Schritt-Anleitungen und persönlicher Historie in Web (/uebungen) UND App.

**Update-Crash (20.07., Gerätetest 2) — Boot-Guard implementiert:** Update über die Vorversion crashte beim Öffnen; nur Deinstallation half. Ursache noch nicht per logcat bestätigt. Gegenmassnahme ist drin (`src/ui/ErrorBoundary.tsx` + `RecoveryScreen.tsx`, verdrahtet in `app/_layout.tsx`): scheitert die DB-Migration ODER wirft der Start einen Render-Fehler, erscheint statt Absturz ein Recovery-Screen mit "Lokale Daten zurücksetzen" (`resetLocalDatabase()` in db/client.ts löscht die SQLite-Datei, `resetSyncCursors()` in db/sync.ts die Pull-Cursor — danach Neustart, Server-Daten kommen per Sync zurück). Falls der Crash erneut auftritt: `adb logcat` sichern, um die eigentliche Ursache zu fixen. Zusätzlich: `UpdateBanner` (Versions-Check gegen /version, Lastenheft 4.11) zeigt bei neuerer Version einen Hinweis-Banner mit Link auf die Web-Download-Seite.

**Instructions-Übersetzung + Konzepte (21.07., IN ARBEIT — durch Session-Limit unterbrochen):** Schema um `instruction_steps_de` erweitert (Migrationen api 0003 / mobile 0002, lokal angewendet — remote steht noch aus). Übersetzungs-Batches liegen unter `scripts/.cache/instr-batches/batch-01..08.json`, Glossar in `GLOSSAR.txt`. Die 8 Übersetzungs-Agenten UND die 2 Konzept-Agenten (Ernährung, Gamification → sollten `docs/KONZEPT_Ernaehrung.md` / `docs/KONZEPT_Gamification.md` erzeugen) sind am Session-Limit gestorben, bevor sie schrieben — **erneut starten, sobald das Limit zurückgesetzt ist**. Danach: Merge nach `scripts/data/exercise-instructions.i18n.json`, Import-Script um Instructions-Merge erweitern (analog Namen), Detailseiten (App + Web) sollen `instructionStepsDe` bevorzugt rendern, re-import lokal+remote.

**Danach M7 (Release):** eigener Signing-Keystore (einmalige Neuinstallation!), APK-Upload nach R2 + echter Download-Button + version.json-Update-Check, Passwort-Reset-UI, Mail-Versand (Resend), Notification-Channel-Tuning, deutsche Übungsnamen-Übersetzung.

## Arbeitsweise (vom Nutzer vorgegeben)

Grössere, klar abgrenzbare Teilaufgaben an parallele Subagenten mit Modell "sonnet" delegieren (scharfe, verzeichnis-bezogene Spezifikationen mit striktem Datei-Eigentum; Agenten dürfen eigene Tests ausführen und iterieren; zentrale Integration/Verifikation im Hauptkontext). Hat sich in M0 und M1 bewährt.
