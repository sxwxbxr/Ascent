import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Nutzer-Tarife (siehe Technisches Konzept, Abschnitt 5 "Entitlements/Feature-Flags").
 * Docken an Stripe/Rate-Limits an, die erst nach dem MVP kommen.
 */
export type Tier = 'free' | 'trial' | 'pro';

/**
 * Nutzer-Profil + Better-Auth-Identität. Better Auth verwaltet email,
 * emailVerified, image, createdAt/updatedAt sowie (auf displayName gemappt)
 * sein `name`-Feld; die übrigen Profilfelder gehören der App (/profile-Route).
 * Passwörter liegen NICHT hier, sondern in der accounts-Tabelle.
 *
 * createdAt/updatedAt: gespeichert weiterhin als INTEGER Epoch-ms
 * (Sync-Konvention bleibt auf DB-Ebene erhalten), aber via Drizzle-mode
 * 'timestamp_ms' als Date typisiert, weil Better Auth Date-Objekte schreibt.
 *
 * Kein `deleted`-Flag: Account-Löschung ist keine Sync-Operation, sondern
 * eine Auth-Angelegenheit (DSGVO-Löschung kommt als eigene Etappe).
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  gender: text('gender'),
  /** ISO-Datum (YYYY-MM-DD) */
  birthDate: text('birth_date'),
  heightCm: integer('height_cm'),
  goal: text('goal'),
  tier: text('tier', { enum: ['free', 'trial', 'pro'] }).notNull().default('free'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * Übungen: importierte, globale Übungen (userId = null) und nutzereigene Übungen
 * teilen sich dieselbe Tabelle. Medien (Thumbnail/GIF) liegen in R2, hier nur die URL.
 */
export const exercises = sqliteTable('exercises', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  name: text('name').notNull(),
  nameDe: text('name_de'),
  category: text('category'),
  primaryMuscle: text('primary_muscle'),
  equipment: text('equipment'),
  instructionsEn: text('instructions_en'),
  instructionsDe: text('instructions_de'),
  /** Synergist laut Datensatz (z. B. "hip flexors") */
  muscleGroup: text('muscle_group'),
  /** JSON-Array beteiligter Muskeln, z. B. '["hip flexors","lower back"]' */
  secondaryMuscles: text('secondary_muscles'),
  /** JSON-Array nummerierter Ausführungs-Schritte (EN) */
  instructionStepsEn: text('instruction_steps_en'),
  /** JSON-Array nummerierter Ausführungs-Schritte (DE) */
  instructionStepsDe: text('instruction_steps_de'),
  thumbnailUrl: text('thumbnail_url'),
  gifUrl: text('gif_url'),
  /** Epoch ms */
  createdAt: integer('created_at').notNull(),
  /** Epoch ms */
  updatedAt: integer('updated_at').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
});

export type Exercise = typeof exercises.$inferSelect;
export type NewExercise = typeof exercises.$inferInsert;

/** Trainingsplan eines Nutzers. */
export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  description: text('description'),
  /** Epoch ms */
  createdAt: integer('created_at').notNull(),
  /** Epoch ms */
  updatedAt: integer('updated_at').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
});

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;

/** Übung innerhalb eines Plans: Reihenfolge, Zielwerte, Pausenzeit. */
export const planExercises = sqliteTable('plan_exercises', {
  id: text('id').primaryKey(),
  planId: text('plan_id').notNull().references(() => plans.id),
  exerciseId: text('exercise_id').notNull().references(() => exercises.id),
  position: integer('position').notNull(),
  targetSets: integer('target_sets').notNull(),
  targetRepsMin: integer('target_reps_min'),
  targetRepsMax: integer('target_reps_max'),
  restSeconds: integer('rest_seconds'),
  /** Epoch ms */
  createdAt: integer('created_at').notNull(),
  /** Epoch ms */
  updatedAt: integer('updated_at').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
});

export type PlanExercise = typeof planExercises.$inferSelect;
export type NewPlanExercise = typeof planExercises.$inferInsert;

/** Trainingseinheit: optional an einen Plan gebunden, sonst frei erfasst. */
export const workouts = sqliteTable('workouts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  planId: text('plan_id').references(() => plans.id),
  /** Epoch ms */
  startedAt: integer('started_at').notNull(),
  /** Epoch ms */
  finishedAt: integer('finished_at'),
  notes: text('notes'),
  /** Epoch ms */
  createdAt: integer('created_at').notNull(),
  /** Epoch ms */
  updatedAt: integer('updated_at').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
});

export type Workout = typeof workouts.$inferSelect;
export type NewWorkout = typeof workouts.$inferInsert;

/**
 * Einzelner Satz innerhalb eines Workouts. Laut Sync-Konzept (Technisches Konzept,
 * Abschnitt 4) faktisch append-only — Konflikte sind hier praktisch ausgeschlossen.
 */
export const workoutSets = sqliteTable('workout_sets', {
  id: text('id').primaryKey(),
  workoutId: text('workout_id').notNull().references(() => workouts.id),
  exerciseId: text('exercise_id').notNull().references(() => exercises.id),
  setNumber: integer('set_number').notNull(),
  weightKg: real('weight_kg').notNull(),
  reps: integer('reps').notNull(),
  /** Epoch ms */
  completedAt: integer('completed_at').notNull(),
  /** Epoch ms */
  createdAt: integer('created_at').notNull(),
  /** Epoch ms */
  updatedAt: integer('updated_at').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
});

export type WorkoutSet = typeof workoutSets.$inferSelect;
export type NewWorkoutSet = typeof workoutSets.$inferInsert;

/** Körpermass-Verlauf (Gewicht/Körperfett) fürs Dashboard. */
export const bodyMetrics = sqliteTable('body_metrics', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  /** Epoch ms */
  measuredAt: integer('measured_at').notNull(),
  weightKg: real('weight_kg').notNull(),
  bodyFatPercent: real('body_fat_percent'),
  /** Epoch ms */
  createdAt: integer('created_at').notNull(),
  /** Epoch ms */
  updatedAt: integer('updated_at').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
});

export type BodyMetric = typeof bodyMetrics.$inferSelect;
export type NewBodyMetric = typeof bodyMetrics.$inferInsert;

/**
 * Zentrale Entitlement-Konfiguration (Technisches Konzept, Abschnitt 5). Reine
 * Server-Konfiguration ohne Gerätesynchronisation — daher keine Sync-Spalten
 * (kein `createdAt`, kein `deleted`), nur `updatedAt` zur Nachvollziehbarkeit.
 */
export const featureFlags = sqliteTable('feature_flags', {
  key: text('key').primaryKey(),
  requiredTier: text('required_tier', { enum: ['free', 'trial', 'pro'] })
    .notNull()
    .default('free'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  description: text('description'),
  /** Epoch ms */
  updatedAt: integer('updated_at').notNull(),
});

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;

/**
 * Ab hier: Better-Auth-interne Tabellen (Drizzle-Adapter, sqlite; siehe
 * apps/api/src/auth/auth.ts). Diese Tabellen gehören der Auth-Bibliothek,
 * nicht der App-Sync-Konvention: IDs erzeugt Better Auth selbst
 * (advanced.database.generateId), es gibt kein `deleted`-Flag. createdAt/
 * updatedAt/expiresAt bleiben als INTEGER Epoch-ms gespeichert, aber via
 * Drizzle-Mode 'timestamp_ms' als Date typisiert, weil Better Auth an diesen
 * Feldern Date-Objekte liest/schreibt (siehe Kommentar an `users` oben).
 */

/** Better-Auth-Session: ein aktiver Login (Cookie- oder Bearer-Token). */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

/**
 * Better-Auth-Account: eine verknüpfte Anmeldemethode. Für unser
 * Email/Passwort-Setup ein Datensatz pro Nutzer mit providerId 'credential'
 * und dem Passwort-Hash in `password`; das Schema ist bewusst generisch
 * gehalten (Better-Auth-Konvention), falls später Social-Login dazukommt.
 */
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

/** Better-Auth-Verification: Einmal-Tokens (Passwort-Reset, E-Mail-Verifizierung). */
export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;

/**
 * Better-Auth-Rate-Limit-Zähler (database storage). `count`/`lastRequest`
 * bleiben bewusst plain integer (kein timestamp_ms): Better Auth behandelt
 * `lastRequest` intern als Zahl (Epoch-ms), nicht als Date-Objekt.
 */
export const rateLimits = sqliteTable('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('last_request').notNull(),
});

export type RateLimit = typeof rateLimits.$inferSelect;
export type NewRateLimit = typeof rateLimits.$inferInsert;

/**
 * Einladungscodes für die geschlossene Registrierung (Lastenheft: privates
 * Produkt für 2-3 bekannte Nutzer, keine offene Registrierung — Ausnahme ist
 * der allererste Nutzer/Bootstrap, siehe apps/api/src/auth/auth.ts). Reine
 * Server-Tabelle ohne Sync-Konvention, daher plain-integer Epoch-ms statt
 * timestamp_ms (analog zu `feature_flags` oben).
 */
export const inviteCodes = sqliteTable('invite_codes', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  createdByUserId: text('created_by_user_id').references(() => users.id),
  usedByUserId: text('used_by_user_id').references(() => users.id),
  /** Epoch ms, null solange unbenutzt */
  usedAt: integer('used_at'),
  /** Epoch ms */
  expiresAt: integer('expires_at').notNull(),
  /** Epoch ms */
  createdAt: integer('created_at').notNull(),
});

export type InviteCode = typeof inviteCodes.$inferSelect;
export type NewInviteCode = typeof inviteCodes.$inferInsert;
