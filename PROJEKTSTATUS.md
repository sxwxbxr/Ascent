# Projektstatus – Ascent
### Stand: 14.07.2026 — M0 abgeschlossen, nächster Schritt M1

Einstiegsdokument für die Weiterarbeit. Grundlagen: `Lastenheft_Fitnessapp_Brainstorming.md` (Anforderungen), `Technisches_Konzept_MVP.md` (Architektur & Etappenplan M0–M6), `CLAUDE.md` (Arbeitskonventionen, Kommandos).

---

## Was fertig ist (M0: Scaffolding + Cloud-Setup)

- **Monorepo** (pnpm, TypeScript strict): `packages/shared`, `apps/api`, `apps/web`, `apps/mobile` + GitHub-Actions-CI (Typecheck → Tests → Web-Build)
- **`packages/shared`**: Drizzle-Schema (8 Tabellen mit Sync-Konventionen: UUID-Text-PKs, Epoch-ms-Timestamps, `deleted`-Flag), Epley-1RM + Trendlinien-Regression (7 Tests grün), Zod-v4-Validierung
- **`apps/api`**: Hono-Worker mit `/health`, `/version` (Update-Check-Stub), `/entitlements` (liest `feature_flags` aus D1); Migrations- und Seed-Scripts
- **`apps/web`**: Vite-React-SPA, Tailwind v4 mit Ascent-Design-Tokens, Seiten Login/Dashboard/Download (reine UI-Platzhalter), Proxy `/api` → Worker
- **`apps/mobile`**: Expo SDK 57 + NativeWind, Monorepo-Metro-Konfiguration, dunkler Login-Platzhalter (kein Router — kommt in M3)
- **Cloudflare live**: Worker deployed unter **https://ascent-api.sweber.workers.dev**, D1 `ascent-db` (EEUR) migriert + geseedet, R2-Bucket `ascent-media` angelegt, `database_id` in `wrangler.jsonc` eingetragen
- **Verifiziert**: Typecheck alle Pakete, 9/9 Tests, Web-Build, alle 3 Endpoints lokal UND live inkl. korrekter Entitlement-Auflösung

## Bekannte Stolperfallen (Kosten bereits bezahlt — nicht erneut hineinlaufen)

| Thema | Detail |
|---|---|
| pnpm `deploy` | `pnpm --filter @ascent/api run deploy` — ohne `run` greift pnpms eingebauter deploy-Befehl |
| `localhost` vs `127.0.0.1` | wrangler dev bindet nur IPv4; auf dieser Maschine löst localhost zu ::1 → Timeouts. Vite-Proxy zeigt deshalb auf 127.0.0.1:8787 |
| Tailwind-Versionen | Web = Tailwind v4 (CSS-first via `@theme`, KEIN tailwind.config.js); Mobile = Tailwind 3.4.x (NativeWind-v4-Zwang). Absichtlich unterschiedlich |
| TypeScript | shared/api/web auf TS 7 (nativer Compiler, npm `latest`); mobile auf Expo-Template-Version ~6.0.3 |
| `.npmrc` node-linker=hoisted | Zwingend für Metro/RN im pnpm-Monorepo — nicht entfernen |
| Reanimated 4 | braucht `react-native-worklets` (ist als Dependency drin); bei erster Reanimated-Nutzung (M3, Pausentimer) ggf. Babel-Plugin ergänzen |
| workers.dev-Propagation | Direkt nach Erst-Deploy kurz Edge-Fehler 1042/1104 — nach ~20 s stabil, kein Bug |

## Offene Punkte

1. **`git push` ausstehend** — die M0-Commits (ab `8a932cc`) liegen nur lokal; nach Push zeigt sich, ob die CI auf GitHub Actions grün ist
2. **Mobile-Runtime ungetestet** — Typecheck grün, aber Expo-App nie auf Gerät/Emulator gestartet; beim ersten `pnpm --filter @ascent/mobile dev` Metro-Monorepo-Setup prüfen
3. **Altes Design-Zip** (`stitch_ascent_fitness_ui_system.zip`, 3.5 MB) ist seit dem Ur-Commit getrackt; Inhalt liegt entpackt in `design/` — bei Gelegenheit `git rm`
4. **Lizenz-Gate Übungsdatenbank**: exercises-dataset ist nur nicht-kommerziell — Blocker vor Aktivierung des Abo-Modells (Details: Technisches Konzept, Abschnitt 6)

## Nächster Schritt: M1 (Backend-Kern)

Scope laut Etappenplan: Better-Auth-Integration (Registrierung, Login, Passwort-Reset), CRUD-Routen für Pläne/Workouts, Sync-Endpoints (Pull/Push), Entitlements an echte Nutzer-Tiers koppeln.

**⚠️ Zuerst zu klären (vom Nutzer explizit gewünscht): Zugriffsschutz.** Die API ist öffentlich erreichbar und trägt ab M1 echte Trainingsdaten. Vor der Implementierung entscheiden:
- Registrierung nur auf Einladung (Invite-Codes oder Email-Allowlist) — öffentliche Registrierung ist laut Lastenheft explizit NICHT im Scope (privates Produkt, 2-3 bekannte Nutzer)
- Auth-Pflicht auf allen Datenrouten, Rate-Limiting auf Auth-Endpoints
- Optional Cloudflare-seitiger Schutz der workers.dev-URL

## Arbeitsweise (vom Nutzer vorgegeben)

Grössere, klar abgrenzbare Teilaufgaben an parallele Subagenten mit Modell "sonnet" delegieren (scharfe, verzeichnis-bezogene Spezifikationen; keine Installs in Agenten — zentral installieren/verifizieren). Hat sich in M0 bewährt.
