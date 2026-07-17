# Projektstatus – Ascent
### Stand: 17.07.2026 — MVP KOMPLETT: M0–M5 implementiert, App+Web live, Beta-APK gebaut

**Nutzer-Ziel erreicht (vorbehaltlich Gerätetest):** Beta-APK liegt unter `beta/app-release.apk` (bzw. Actions-Artefakt "ascent-beta-apk"); Web-Dashboard live auf **https://ascent-api.sweber.workers.dev** (derselbe Worker serviert SPA + API same-origin). Es fehlt M6 (Release-Polish: eigener Keystore, APK-Download über die Web-App, version.json-Check).

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

## Nächster Schritt: Gerätetest der Beta, dann M6 (Release)

M6-Scope: eigener Signing-Keystore (einmalige Neuinstallation!), APK-Upload nach R2 + echter Download-Button + version.json-Update-Check, Passwort-Reset-UI, Mail-Versand (Resend), Notification-Channel-Tuning, i18n-Feinschliff (Inter-Font, deutsche Übungsnamen).

## Arbeitsweise (vom Nutzer vorgegeben)

Grössere, klar abgrenzbare Teilaufgaben an parallele Subagenten mit Modell "sonnet" delegieren (scharfe, verzeichnis-bezogene Spezifikationen mit striktem Datei-Eigentum; Agenten dürfen eigene Tests ausführen und iterieren; zentrale Integration/Verifikation im Hauptkontext). Hat sich in M0 und M1 bewährt.
