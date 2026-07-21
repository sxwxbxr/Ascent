import { z } from 'zod';

/** Registrierung: E-Mail, Passwort (mind. 8 Zeichen) und Anzeigename. */
export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/** Login: E-Mail und Passwort. */
export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Profil-Update: nur der Anzeigename ist Pflicht, der Rest ist optional. */
export const profileSchema = z.object({
  displayName: z.string().min(1),
  gender: z.enum(['m', 'w', 'd']).optional(),
  /** ISO-Datum (YYYY-MM-DD) */
  birthDate: z.iso.date().optional(),
  heightCm: z.number().int().min(100).max(250).optional(),
  goal: z.string().optional(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

/** Satz-Logging während eines Workouts: Gewicht (kg) und Wiederholungen. */
export const workoutSetSchema = z.object({
  // 0 kg ist zulässig: Körpergewichts-Übungen (Klimmzüge, Liegestütze) ohne
  // Zusatzgewicht. Nur negatives Gewicht ist ungültig.
  weightKg: z.number().min(0).max(1000),
  reps: z.number().int().min(1).max(100),
});

export type WorkoutSetInput = z.infer<typeof workoutSetSchema>;

/** Profil-Update (PUT /profile): partielle Änderung, daher alle Felder optional. */
export const profileUpdateSchema = profileSchema.partial();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

// ---------------------------------------------------------------------------
// M1 CRUD-Routen: Pläne, Plan-Übungen, Workouts, Sätze, Körpermasse, Übungen.
// Create-Schemas akzeptieren ein optionales, client-generiertes `id` (Sync-
// Konvention); Update-Schemas sind bewusst partiell (PATCH-Semantik via PUT).
// ---------------------------------------------------------------------------

/** Trainingsplan: Name (Pflicht) und optionale Beschreibung. */
const planFieldsSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

export const planCreateSchema = planFieldsSchema.extend({ id: z.uuid().optional() });
export type PlanCreateInput = z.infer<typeof planCreateSchema>;

export const planUpdateSchema = planFieldsSchema.partial();
export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;

/** Übung innerhalb eines Plans: Zielwerte für Sätze/Wiederholungen/Pause. */
const planExerciseFieldsSchema = z.object({
  exerciseId: z.string().min(1),
  position: z.number().int().min(0).max(1000),
  targetSets: z.number().int().min(1).max(20),
  targetRepsMin: z.number().int().min(1).max(100).optional(),
  targetRepsMax: z.number().int().min(1).max(100).optional(),
  restSeconds: z.number().int().min(0).max(600).optional(),
});

/** targetRepsMin darf targetRepsMax nicht überschreiten (nur wenn beide gesetzt sind). */
function targetRepsRangeIsValid(data: { targetRepsMin?: number; targetRepsMax?: number }): boolean {
  return (
    data.targetRepsMin === undefined || data.targetRepsMax === undefined || data.targetRepsMin <= data.targetRepsMax
  );
}

const targetRepsRangeIssue: { message: string; path: PropertyKey[] } = {
  message: 'targetRepsMin darf targetRepsMax nicht überschreiten',
  path: ['targetRepsMin'],
};

export const planExerciseCreateSchema = planExerciseFieldsSchema
  .extend({ id: z.uuid().optional() })
  .refine(targetRepsRangeIsValid, targetRepsRangeIssue);
export type PlanExerciseCreateInput = z.infer<typeof planExerciseCreateSchema>;

export const planExerciseUpdateSchema = planExerciseFieldsSchema.partial().refine(targetRepsRangeIsValid, targetRepsRangeIssue);
export type PlanExerciseUpdateInput = z.infer<typeof planExerciseUpdateSchema>;

/** Trainingseinheit: optional an einen Plan gebunden, sonst frei erfasst. */
const workoutFieldsSchema = z.object({
  planId: z.string().min(1).optional(),
  startedAt: z.number().int().positive(),
  finishedAt: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
});

/** finishedAt darf nicht vor startedAt liegen (nur wenn beide gesetzt sind). */
function workoutTimesAreValid(data: { startedAt?: number; finishedAt?: number }): boolean {
  return data.startedAt === undefined || data.finishedAt === undefined || data.finishedAt >= data.startedAt;
}

const workoutTimesIssue: { message: string; path: PropertyKey[] } = {
  message: 'finishedAt darf nicht vor startedAt liegen',
  path: ['finishedAt'],
};

export const workoutCreateSchema = workoutFieldsSchema
  .extend({ id: z.uuid().optional() })
  .refine(workoutTimesAreValid, workoutTimesIssue);
export type WorkoutCreateInput = z.infer<typeof workoutCreateSchema>;

export const workoutUpdateSchema = workoutFieldsSchema.partial().refine(workoutTimesAreValid, workoutTimesIssue);
export type WorkoutUpdateInput = z.infer<typeof workoutUpdateSchema>;

/**
 * Einzelner Satz innerhalb eines Workouts (neues, vollständiges Schema für
 * die CRUD-Route; das bestehende `workoutSetSchema` bleibt unverändert).
 */
const workoutSetFieldsSchema = z.object({
  exerciseId: z.string().min(1),
  setNumber: z.number().int().min(1).max(50),
  // 0 kg zulässig (Körpergewichts-Übungen ohne Zusatzgewicht).
  weightKg: z.number().min(0).max(1000),
  reps: z.number().int().min(1).max(100),
  completedAt: z.number().int().positive(),
});

export const workoutSetCreateSchema = workoutSetFieldsSchema.extend({ id: z.uuid().optional() });
export type WorkoutSetCreateInput = z.infer<typeof workoutSetCreateSchema>;

export const workoutSetUpdateSchema = workoutSetFieldsSchema.partial();
export type WorkoutSetUpdateInput = z.infer<typeof workoutSetUpdateSchema>;

/** Körpermass-Eintrag: Gewicht (Pflicht) und optionaler Körperfettanteil. */
const bodyMetricFieldsSchema = z.object({
  measuredAt: z.number().int().positive(),
  weightKg: z.number().positive().max(500),
  bodyFatPercent: z.number().min(0).max(100).optional(),
});

export const bodyMetricCreateSchema = bodyMetricFieldsSchema.extend({ id: z.uuid().optional() });
export type BodyMetricCreateInput = z.infer<typeof bodyMetricCreateSchema>;

export const bodyMetricUpdateSchema = bodyMetricFieldsSchema.partial();
export type BodyMetricUpdateInput = z.infer<typeof bodyMetricUpdateSchema>;

/** Übung (global oder nutzereigen): Name ist Pflicht, der Rest optional. */
const exerciseFieldsSchema = z.object({
  name: z.string().min(1).max(120),
  nameDe: z.string().min(1).max(120).optional(),
  category: z.string().max(60).optional(),
  primaryMuscle: z.string().max(60).optional(),
  equipment: z.string().max(60).optional(),
  instructionsEn: z.string().max(5000).optional(),
  instructionsDe: z.string().max(5000).optional(),
  thumbnailUrl: z.string().max(500).optional(),
  gifUrl: z.string().max(500).optional(),
});

export const exerciseCreateSchema = exerciseFieldsSchema.extend({ id: z.uuid().optional() });
export type ExerciseCreateInput = z.infer<typeof exerciseCreateSchema>;

export const exerciseUpdateSchema = exerciseFieldsSchema.partial();
export type ExerciseUpdateInput = z.infer<typeof exerciseUpdateSchema>;
