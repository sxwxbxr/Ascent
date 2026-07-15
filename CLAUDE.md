# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Ascent is an Android-based gym/fitness app with a browser dashboard, built as a private project for 2-3 users (the owner plus 1-2 training partners). **M0 (scaffolding + Cloudflare) and M1 (backend: auth, CRUD, sync) are implemented**; M1 still needs the production rollout (remote migration, auth secret, deploy). Next milestone: M2 (exercise-database import). **Read `PROJEKTSTATUS.md` first** — it holds the current state, known pitfalls, and open points for continuing work.

Authoritative documents:

1. **`Lastenheft_Fitnessapp_Brainstorming.md`** — the requirements specification (in German). This is the source of truth for scope, priorities (Muss/Soll/Kann), and architectural constraints. Read it before making any product or architecture decisions.
2. **`Technisches_Konzept_MVP.md`** — the technical concept for the MVP (in German): stack rationale, data model, offline-sync design, and the milestone plan M0–M6. Follow it when implementing.
3. **`design/`** — Stitch UI design export: one folder per screen (mobile + web) with `code.html` and `screen.png`, plus `design/ascent_design_system/DESIGN.md` containing the full design system (color tokens, typography, spacing, component specs).

## Architecture

pnpm monorepo (TypeScript everywhere). `.npmrc` sets `node-linker=hoisted` — required for Metro/React Native; don't remove it.

- **`packages/shared`** — source-only package (no build step; consumers bundle `src/index.ts` directly): Drizzle SQLite schema (single source of truth for the DB), progression math (Epley 1RM, trendline), Zod validation. Synced tables use client-generated UUID text PKs, epoch-ms integer timestamps, and a `deleted` soft-delete flag — this convention carries the offline sync (M4); don't introduce autoincrement IDs or server-generated timestamps on synced tables.
- **`apps/api`** — Cloudflare Worker (Hono), bindings `DB` (D1) and `MEDIA` (R2) defined in `wrangler.jsonc` (`nodejs_compat` flag is required by Better Auth — don't remove). Migrations are generated from the shared schema via drizzle-kit into `apps/api/drizzle/`. Auth is Better Auth (`src/auth/auth.ts`, mounted at `/auth/*`): invite-code-only registration (bootstrap exception for the very first user), cookie + bearer sessions, DB-backed rate limits; `requireAuth` guards all data routes centrally in `index.ts` — routers never mount auth themselves (tests inject a fake user). Secrets: `BETTER_AUTH_SECRET` via `.dev.vars` locally / `wrangler secret put` in prod. Feature flags live in the `feature_flags` table (seed: `seed/feature_flags.sql`); `/entitlements` resolves them per tier (anonymous = free, session = `users.tier`) — features must never be gated by hardcoded conditions. API tests run on a real local D1 via `@cloudflare/vitest-pool-workers`; storage isolates per test FILE, not per test — clean up in `beforeEach`.
- **`apps/web`** — Vite React SPA, Tailwind v4 (CSS-first config via `@theme` in `src/styles/index.css` — there is deliberately no `tailwind.config.js`), react-router **v7** (not v8). Dev server proxies `/api/*` to the Worker on `127.0.0.1:8787` (not `localhost` — wrangler binds IPv4 only).
- **`apps/mobile`** — Expo (SDK 57) + NativeWind v4, which requires **Tailwind 3.4.x** (not v4 — the two apps intentionally differ). Entry is a custom `index.js` with `registerRootComponent` (monorepo-safe). `metro.config.js` contains the monorepo watch-folder setup. No expo-router yet (navigation comes in M3). Note: `react-native-reanimated` 4 needs `react-native-worklets`; already a dependency, and its babel plugin must be added when Reanimated is first used.

## Commands

```sh
pnpm install                                  # setup (Node >= 22, pnpm 10)
pnpm dev                                      # all apps in parallel (API on 8787, Vite, Expo)
pnpm typecheck / pnpm test                    # all packages (tests are Vitest)
pnpm --filter @ascent/shared test             # single package; single test: vitest run <file>
pnpm --filter @ascent/api db:generate         # regenerate migration after schema changes in shared
pnpm --filter @ascent/api db:migrate:local    # apply migrations to local D1
pnpm --filter @ascent/api db:seed:local       # seed feature flags
pnpm --filter @ascent/web build               # production build (CI runs typecheck, test, build)
```

Cloudflare deploy is not yet set up: `wrangler d1 create ascent-db` / `wrangler r2 bucket create ascent-media` must be run once and the `database_id` entered in `apps/api/wrangler.jsonc`. Local dev works without (wrangler simulates D1/R2).

TypeScript is v7 (the native compiler) in shared/api/web; mobile pins the Expo-template version. Strict base config in `tsconfig.base.json` includes `verbatimModuleSyntax` — type imports must use `import type`.

## Key Decisions from the Lastenheft

- **MVP scope (V1):** strength-training tracker only — email/password login with multi-device sync, workout plans, workout log (weight/reps), exercise database with execution GIFs, statistical strength-progression trendline, and a browser statistics dashboard. Endurance, nutrition, social, and AI features are later expansion stages.
- **Platforms:** Android app (active tracking, offline-capable with sync-on-reconnect) + web browser app (login, statistics, administration). No iOS, no app stores — the APK is distributed via sideloading from the web app, with a custom signing certificate and a JSON-based version check for updates.
- **Monetization architecture requirement:** freemium (5 CHF/month, 50 CHF/year, 14-day trial with strict AI rate limits). Every feature must be switchable between free and subscription tiers via **feature flags/entitlements in central configuration — never hardcoded**.
- **Strength-progression forecast is deliberately statistical** (linear regression over estimated 1RM or volume, needs 3-5 sessions minimum), **not AI** — it stays in the free tier. All AI features are subscription-only.
- **Tech stack (decided, see Technisches_Konzept_MVP.md):** Expo/React Native for Android, Vite React SPA for web, Cloudflare Workers + Hono + D1 + R2 backend, Better Auth for authentication (planned for M1).
- **Exercise database:** imported from the `hasaneyldrm/exercises-dataset` GitHub repo (~1,300 exercises as JSON with GIFs). **License caveat:** that dataset is non-commercial only — fine for the private MVP, but must be replaced (e.g. ExerciseDB.io commercial license or own media) before enabling paid subscriptions.
- **Explicitly out of scope for V1:** iOS, app stores, public registration, leaderboards/public feeds, live coaching, plan marketplace, wearable hardware.

## Design System (from design/ascent_design_system/DESIGN.md)

"Dark Performance" aesthetic: deep anthracite backgrounds (#121212 base, #1E1E1E cards, #2C2C2C modals — tonal layering instead of shadows), a single lime-green accent (#B4FF39 / primary-container #aef831) reserved for CTAs, progress, and active states, Inter typography with heavy weights (700-800) and tabular figures for numeric data (kg/reps/timers). 4px baseline grid, 48dp minimum touch targets, 8px standard corner radius. Dark mode is a hard requirement (usability with gym gloves/sweaty fingers).

## Language Conventions

Documentation and UI text are in German (Swiss conventions: "ss" instead of "ß", CHF pricing). German is the minimum required app language; English is optional. German words are long ("Wiederholungen", "Trainingseinheit") — UI containers need flexible widths.
