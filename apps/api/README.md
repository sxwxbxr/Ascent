# @ascent/api

Cloudflare Worker (Hono) für die Ascent-Fitness-App. Stellt die REST-API für App und Web-Dashboard bereit: Health-Check, Versions-Check (App-Update) und Entitlements. Auth sowie CRUD-Routen für Pläne/Workouts folgen in M1.

## Setup

Bevor der Worker gegen eine echte D1-Instanz läuft, einmalig:

```
wrangler d1 create ascent-db
```

Die zurückgegebene `database_id` in `wrangler.jsonc` unter `d1_databases[0].database_id` eintragen (ersetzt den `TODO-...`-Platzhalter). Für die lokale Entwicklung (`pnpm dev`) ist das nicht zwingend nötig, da `wrangler dev` D1 lokal simuliert.

Zusätzlich muss der R2-Bucket einmalig angelegt werden:

```
wrangler r2 bucket create ascent-media
```

## Kommandos

| Kommando | Zweck |
|---|---|
| `pnpm dev` | Startet den Worker lokal (`wrangler dev`) |
| `pnpm deploy` | Deployt den Worker via Wrangler |
| `pnpm typecheck` | TypeScript-Check ohne Build (`tsc --noEmit`) |
| `pnpm test` | Führt die Vitest-Tests aus |
| `pnpm db:generate` | Generiert SQL-Migrationen aus dem Drizzle-Schema in `@ascent/shared` |
| `pnpm db:migrate:local` | Wendet Migrationen auf die lokale D1-Instanz an |
| `pnpm db:migrate:remote` | Wendet Migrationen auf die produktive D1-Instanz an |
| `pnpm db:seed:local` | Befüllt die lokale D1-Instanz mit den MVP-Feature-Flags (`seed/feature_flags.sql`) |

## Schema-Änderungen

Das Drizzle-Schema liegt zentral in `packages/shared/src/db/schema.ts` (Paket `@ascent/shared`), nicht in diesem Paket. Nach jeder Schema-Änderung dort:

```
pnpm db:generate
```

ausführen, um eine neue Migration in `apps/api/drizzle/` zu erzeugen, und anschliessend mit `pnpm db:migrate:local` (bzw. `:remote`) anwenden.

## Endpunkte (Stand M0)

- `GET /health` – Liveness-Check
- `GET /version` – Stub für den App-Update-Check (Lastenheft 4.11); liefert aktuell fixe Werte, wird später aus KV/Config gespeist
- `GET /entitlements` – Liefert die aufgelöste Feature-Map. M0-Stub: Alle Aufrufer gelten als Tier `free`, da noch keine Auth existiert; die echte Tier-Auflösung kommt mit Auth in M1
