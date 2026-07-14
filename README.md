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

## Cloudflare-Deployment

D1-Datenbank (`ascent-db`, Region EEUR) und R2-Bucket (`ascent-media`) existieren; die `database_id` ist in `apps/api/wrangler.jsonc` eingetragen. Lokale Entwicklung braucht keinen Cloudflare-Login (wrangler simuliert D1/R2 lokal).

```sh
pnpm --filter @ascent/api db:migrate:remote   # Migrationen auf Remote-D1 anwenden
pnpm --filter @ascent/api deploy              # Worker deployen
```
