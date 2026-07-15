# Projektstatus – Ascent
### Stand: 15.07.2026 — M1 (Backend-Kern) fertig und live deployed

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
- **Tests: 84 grün** (7 shared + 77 api auf echter lokaler D1 via vitest-pool-workers), Typecheck monorepo-weit sauber. E2E-Smoke-Test via REST komplett durchgespielt (Bootstrap → Invite → Registrierung → CRUD → Sync → Entitlements inkl. Pro-Tier).

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
| workers.dev-Propagation | Nach Erst-Deploy kurz Edge-Fehler 1042/1104 — nach ~20 s stabil |

## Offene Punkte

1. **⚠️ Bootstrap-Registrierung des Owners steht aus**: Die allererste Registrierung auf https://ascent-api.sweber.workers.dev braucht KEINEN Invite-Code — der Owner sollte seinen Account zeitnah anlegen, damit dieses Fenster geschlossen ist. (Prod-Migration 0001, BETTER_AUTH_SECRET und Deploy sind erledigt, Live-Smoke-Test grün: Auth-Stack antwortet, Datenrouten 401, Entitlements korrekt.)
2. **`git push`** der M1-Commits + CI-Kontrolle (README-Überarbeitung des Nutzers ist noch uncommittet)
3. **Mobile-Runtime ungetestet** (Expo nie auf Gerät gestartet; Metro-Monorepo-Setup beim ersten `pnpm --filter @ascent/mobile dev` prüfen)
4. **Mail-Versand** ist Log-Stub — Passwort-Reset-Links werden im Worker-Log ausgegeben und manuell weitergegeben (bewusste M1-Entscheidung); Resend + eigene Domain später
5. **Altes Design-Zip** (3.5 MB) weiterhin in Git-Historie; Inhalt liegt in `design/`
6. **Lizenz-Gate Übungsdatenbank** vor Abo-Aktivierung (Technisches Konzept, Abschnitt 6)

## Nächster Schritt: M2 (Übungsdatenbank-Import)

Scope laut Etappenplan: Import-Script (`scripts/import-exercises.ts`) für das exercises-dataset (~1'300 Übungen als JSON), GIFs/Thumbnails nach R2, Übungs-API existiert bereits (M1) — es fehlt nur die Befüllung plus ggf. ein Medien-Serving-Endpoint (R2 → Response). Danach M3 (Android-Kern).

## Arbeitsweise (vom Nutzer vorgegeben)

Grössere, klar abgrenzbare Teilaufgaben an parallele Subagenten mit Modell "sonnet" delegieren (scharfe, verzeichnis-bezogene Spezifikationen mit striktem Datei-Eigentum; Agenten dürfen eigene Tests ausführen und iterieren; zentrale Integration/Verifikation im Hauptkontext). Hat sich in M0 und M1 bewährt.
