# Ascent

Private Fitness-App: Android-App (Training tracken) + Browser-Dashboard (Statistik, Verwaltung, APK-Download). Siehe `Lastenheft_Fitnessapp_Brainstorming.md` (Anforderungen) und `Technisches_Konzept_MVP.md` (Architektur & Etappenplan).

## Struktur

```
apps/
  mobile/   Expo/React Native (Android)
  web/      React SPA (Vite) — Dashboard
  api/      Cloudflare Worker (Hono) + D1 + R2
packages/
  shared/   Typen, DB-Schema (Drizzle), Progression-Logik, Validierung
design/     Stitch-Design-Export (Screens + Design-System)
```

## Entwicklung

Voraussetzungen: Node ≥ 22, pnpm 10.

```sh
pnpm install                              # einmalig
pnpm --filter @ascent/api db:migrate:local   # lokale D1-Migration
pnpm --filter @ascent/api db:seed:local      # Feature-Flags seeden
pnpm dev                                  # startet API (Port 8787), Web (Vite) und Expo parallel
```

Einzeln: `pnpm --filter @ascent/api dev`, `pnpm --filter @ascent/web dev`, `pnpm --filter @ascent/mobile dev`.

Qualität: `pnpm typecheck`, `pnpm test`, `pnpm --filter @ascent/web build` (läuft auch als CI auf GitHub Actions).

## Cloudflare-Deployment (noch nicht eingerichtet)

Vor dem ersten Deploy: `wrangler d1 create ascent-db` und `wrangler r2 bucket create ascent-media` ausführen, dann `database_id` in `apps/api/wrangler.jsonc` eintragen. Lokale Entwicklung funktioniert ohne (wrangler simuliert D1/R2 lokal).
