import { z } from 'zod';

/**
 * Tabellen, die zwischen App und Backend synchronisiert werden (Technisches
 * Konzept, Abschnitt 3+4). Die Reihenfolge ist bewusst die Anwendungsreihen-
 * folge beim Push: Eltern vor Kindern, weil (a) D1 Fremdschlüssel erzwingt
 * und (b) `plan_exercises`/`workout_sets` keine eigene `user_id`-Spalte haben
 * — ihr Owner wird über die bereits verarbeitete Eltern-Zeile (`plans`/
 * `workouts`) aufgelöst (siehe apps/api/src/routes/sync.ts).
 */
export const SYNC_TABLES = [
  'exercises',
  'plans',
  'plan_exercises',
  'workouts',
  'workout_sets',
  'body_metrics',
  'foods', // neu — Eltern von food_entries (globaler OFF-Cache + eigene Lebensmittel)
  'food_entries', // neu — referenziert foods.id (nullable)
  'nutrition_goals', // neu — eigene userId-Spalte, keine Eltern-Auflösung nötig
] as const;

export type SyncTableName = (typeof SYNC_TABLES)[number];

/** Epoch-ms-Zeitstempel: positive Ganzzahl (Unix-Millisekunden). */
const epochMs = z.number().int().positive();

/**
 * Zeilenschemas je Sync-Tabelle. Bilden die volle Zeile wie im DB-Schema ab
 * (packages/shared/src/db/schema.ts). `userId` ist überall optional, weil der
 * Server ihn beim Push ohnehin mit dem authentifizierten Nutzer überschreibt
 * (siehe Push-Route); unbekannte Keys werden von Zod-Objects standardmässig
 * gestrippt.
 */
const exerciseRowSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable().optional(),
  name: z.string().min(1),
  nameDe: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  primaryMuscle: z.string().nullable().optional(),
  equipment: z.string().nullable().optional(),
  instructionsEn: z.string().nullable().optional(),
  instructionsDe: z.string().nullable().optional(),
  muscleGroup: z.string().nullable().optional(),
  secondaryMuscles: z.string().nullable().optional(),
  instructionStepsEn: z.string().nullable().optional(),
  instructionStepsDe: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  gifUrl: z.string().nullable().optional(),
  createdAt: epochMs,
  updatedAt: epochMs,
  deleted: z.boolean(),
});

const planRowSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  createdAt: epochMs,
  updatedAt: epochMs,
  deleted: z.boolean(),
});

const planExerciseRowSchema = z.object({
  id: z.uuid(),
  planId: z.uuid(),
  exerciseId: z.uuid(),
  position: z.number().int(),
  targetSets: z.number().int().positive(),
  targetRepsMin: z.number().int().nullable().optional(),
  targetRepsMax: z.number().int().nullable().optional(),
  restSeconds: z.number().int().nullable().optional(),
  createdAt: epochMs,
  updatedAt: epochMs,
  deleted: z.boolean(),
});

const workoutRowSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().optional(),
  planId: z.uuid().nullable().optional(),
  startedAt: epochMs,
  finishedAt: epochMs.nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: epochMs,
  updatedAt: epochMs,
  deleted: z.boolean(),
});

const workoutSetRowSchema = z.object({
  id: z.uuid(),
  workoutId: z.uuid(),
  exerciseId: z.uuid(),
  setNumber: z.number().int().positive(),
  // 0 kg zulässig (Körpergewichts-Übungen); nur negativ wäre ungültig — sonst
  // würden solche Sätze beim Sync-Push abgewiesen.
  weightKg: z.number().min(0),
  reps: z.number().int().positive(),
  completedAt: epochMs,
  createdAt: epochMs,
  updatedAt: epochMs,
  deleted: z.boolean(),
});

const bodyMetricRowSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().optional(),
  measuredAt: epochMs,
  weightKg: z.number().positive(),
  bodyFatPercent: z.number().nullable().optional(),
  createdAt: epochMs,
  updatedAt: epochMs,
  deleted: z.boolean(),
});

/**
 * Ernährungs-Modul (docs/KONZEPT_Ernaehrung.md, Abschnitt 2.4): `foods` folgt
 * dem `exercises`-Muster (global `userId = null` + eigene Zeilen teilen sich
 * die Tabelle).
 */
const foodRowSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable().optional(),
  barcode: z.string().nullable().optional(),
  name: z.string().min(1),
  brand: z.string().nullable().optional(),
  kcalPer100: z.number().min(0),
  proteinPer100: z.number().nullable().optional(),
  carbsPer100: z.number().nullable().optional(),
  fatPer100: z.number().nullable().optional(),
  servingSizeG: z.number().nullable().optional(),
  source: z.enum(['off', 'custom']),
  offLastFetchedAt: epochMs.nullable().optional(),
  createdAt: epochMs,
  updatedAt: epochMs,
  deleted: z.boolean(),
});

/** `food_entries` — eigene userId-Spalte, wie `body_metrics`; loggedDate ist ein ISO-Datum. */
const foodEntryRowSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().optional(),
  entryType: z.enum(['food', 'water']),
  foodId: z.uuid().nullable().optional(),
  loggedDate: z.iso.date(),
  mealSlot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).nullable().optional(),
  amountG: z.number().nullable().optional(),
  amountMl: z.number().nullable().optional(),
  kcal: z.number().nullable().optional(),
  proteinG: z.number().nullable().optional(),
  carbsG: z.number().nullable().optional(),
  fatG: z.number().nullable().optional(),
  loggedAt: epochMs,
  createdAt: epochMs,
  updatedAt: epochMs,
  deleted: z.boolean(),
});

/** `nutrition_goals` — eigene userId-Spalte, wie `body_metrics`; effectiveFrom ist ein ISO-Datum. */
const nutritionGoalRowSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().optional(),
  effectiveFrom: z.iso.date(),
  kcalTarget: z.number().int(),
  proteinTargetG: z.number().nullable().optional(),
  carbsTargetG: z.number().nullable().optional(),
  fatTargetG: z.number().nullable().optional(),
  waterTargetMl: z.number().int().nullable().optional(),
  createdAt: epochMs,
  updatedAt: epochMs,
  deleted: z.boolean(),
});

/** Zod-Zeilenschema je Sync-Tabelle. */
export const syncRowSchemas = {
  exercises: exerciseRowSchema,
  plans: planRowSchema,
  plan_exercises: planExerciseRowSchema,
  workouts: workoutRowSchema,
  workout_sets: workoutSetRowSchema,
  body_metrics: bodyMetricRowSchema,
  foods: foodRowSchema,
  food_entries: foodEntryRowSchema,
  nutrition_goals: nutritionGoalRowSchema,
} as const satisfies Record<SyncTableName, z.ZodTypeAny>;

/** Validierter Zeilentyp einer Sync-Tabelle (Push-Eingabe bzw. Pull-Ausgabe). */
export type SyncRow<T extends SyncTableName> = z.infer<(typeof syncRowSchemas)[T]>;

/** Obergrenze pro Tabelle und Push-Anfrage — grössere Batches liefern 400. */
export const MAX_SYNC_ROWS_PER_TABLE = 500;

/** POST /sync/push: Body-Schema. Max. 500 Zeilen pro Tabelle (sonst 400). */
export const syncPushRequestSchema = z.object({
  tables: z.object({
    exercises: z.array(exerciseRowSchema).max(MAX_SYNC_ROWS_PER_TABLE).optional(),
    plans: z.array(planRowSchema).max(MAX_SYNC_ROWS_PER_TABLE).optional(),
    plan_exercises: z.array(planExerciseRowSchema).max(MAX_SYNC_ROWS_PER_TABLE).optional(),
    workouts: z.array(workoutRowSchema).max(MAX_SYNC_ROWS_PER_TABLE).optional(),
    workout_sets: z.array(workoutSetRowSchema).max(MAX_SYNC_ROWS_PER_TABLE).optional(),
    body_metrics: z.array(bodyMetricRowSchema).max(MAX_SYNC_ROWS_PER_TABLE).optional(),
    foods: z.array(foodRowSchema).max(MAX_SYNC_ROWS_PER_TABLE).optional(),
    food_entries: z.array(foodEntryRowSchema).max(MAX_SYNC_ROWS_PER_TABLE).optional(),
    nutrition_goals: z.array(nutritionGoalRowSchema).max(MAX_SYNC_ROWS_PER_TABLE).optional(),
  }),
});

export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

/** POST /sync/pull: Body-Schema. Fehlender Cursor je Tabelle gilt als 0. */
export const syncPullRequestSchema = z.object({
  since: z
    .object({
      exercises: z.number().int().nonnegative().optional(),
      plans: z.number().int().nonnegative().optional(),
      plan_exercises: z.number().int().nonnegative().optional(),
      workouts: z.number().int().nonnegative().optional(),
      workout_sets: z.number().int().nonnegative().optional(),
      body_metrics: z.number().int().nonnegative().optional(),
      foods: z.number().int().nonnegative().optional(),
      food_entries: z.number().int().nonnegative().optional(),
      nutrition_goals: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type SyncPullRequest = z.infer<typeof syncPullRequestSchema>;

/** Zähler für eine Tabelle nach einem Push. */
export type SyncPushTableResult = { applied: number; skipped: number; rejected: number };

/** Antwort von POST /sync/push. */
export type SyncPushResult = {
  tables: Record<SyncTableName, SyncPushTableResult>;
};

/** Antwort von POST /sync/pull. */
export type SyncPullResult = {
  serverTime: number;
  tables: { [T in SyncTableName]: SyncRow<T>[] };
};
