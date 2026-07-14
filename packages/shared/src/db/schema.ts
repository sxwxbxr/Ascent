import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Nutzer-Tarife (siehe Technisches Konzept, Abschnitt 5 "Entitlements/Feature-Flags").
 * Docken an Stripe/Rate-Limits an, die erst nach dem MVP kommen.
 */
export type Tier = 'free' | 'trial' | 'pro';

/**
 * Nutzer-Profil. Bewusst OHNE Passwort-Feld — Auth-Tabellen (Sessions, Credentials)
 * kommen erst in M1 via Better Auth dazu und leben in eigenen Tabellen.
 *
 * Kein `deleted`-Flag: Account-Löschung ist (noch) keine Sync-Operation, sondern
 * eine Auth-Angelegenheit, die erst mit M1 spezifiziert wird.
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  gender: text('gender'),
  /** ISO-Datum (YYYY-MM-DD) */
  birthDate: text('birth_date'),
  heightCm: integer('height_cm'),
  goal: text('goal'),
  tier: text('tier', { enum: ['free', 'trial', 'pro'] }).notNull().default('free'),
  /** Epoch ms */
  createdAt: integer('created_at').notNull(),
  /** Epoch ms */
  updatedAt: integer('updated_at').notNull(),
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
