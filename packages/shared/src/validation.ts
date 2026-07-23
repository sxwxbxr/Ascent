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

// ---------------------------------------------------------------------------
// Ernährungs-Modul (docs/KONZEPT_Ernaehrung.md): Lebensmittel-Cache (OFF +
// eigene), Tagebuch (Mahlzeiten + Wasser), Ernährungsziele.
// ---------------------------------------------------------------------------

/** Lebensmittel (global aus OFF gecacht oder eigen): Name + kcal/100 sind Pflicht. */
const foodFieldsSchema = z.object({
  barcode: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  brand: z.string().max(120).optional(),
  // Nährwerte je 100 g/ml (OFF-Konvention). Obergrenze grosszügig, weil reine
  // Fette/Öle (z. B. Ghee) nahe an 900-1000 kcal/100g liegen können.
  kcalPer100: z.number().min(0).max(1000),
  proteinPer100: z.number().min(0).max(100).optional(),
  carbsPer100: z.number().min(0).max(100).optional(),
  fatPer100: z.number().min(0).max(100).optional(),
  servingSizeG: z.number().positive().max(5000).optional(),
});

export const foodCreateSchema = foodFieldsSchema.extend({ id: z.uuid().optional() });
export type FoodCreateInput = z.infer<typeof foodCreateSchema>;

export const foodUpdateSchema = foodFieldsSchema.partial();
export type FoodUpdateInput = z.infer<typeof foodUpdateSchema>;

/** Tagebuch-Eintrag: Mahlzeit ODER Wasser (entryType), loggedDate als ISO-Datum. */
const foodEntryFieldsSchema = z.object({
  entryType: z.enum(['food', 'water']).default('food'),
  foodId: z.uuid().optional(),
  /** ISO-Datum (YYYY-MM-DD) — der Tag, dem der Eintrag zugerechnet wird. */
  loggedDate: z.iso.date(),
  mealSlot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  amountG: z.number().positive().max(5000).optional(),
  amountMl: z.number().positive().max(10000).optional(),
  kcal: z.number().min(0).max(20000).optional(),
  proteinG: z.number().min(0).max(2000).optional(),
  carbsG: z.number().min(0).max(2000).optional(),
  fatG: z.number().min(0).max(2000).optional(),
  loggedAt: z.number().int().positive(),
});

/**
 * Formprüfung: Wasser-Einträge tragen keine Mahlzeit-spezifischen Felder
 * (mealSlot/amountG). Bei partiellen Updates ohne mitgeliefertes entryType
 * ist keine Aussage möglich — dann wird die Prüfung übersprungen.
 */
function foodEntryShapeIsValid(data: { entryType?: 'food' | 'water'; amountG?: number; mealSlot?: string }): boolean {
  if (data.entryType === undefined) return true;
  if (data.entryType === 'water') return data.amountG === undefined && data.mealSlot === undefined;
  return true;
}

const foodEntryShapeIssue: { message: string; path: PropertyKey[] } = {
  message: 'Wasser-Einträge dürfen kein mealSlot/amountG tragen',
  path: ['entryType'],
};

export const foodEntryCreateSchema = foodEntryFieldsSchema
  .extend({ id: z.uuid().optional() })
  .refine(foodEntryShapeIsValid, foodEntryShapeIssue);
export type FoodEntryCreateInput = z.infer<typeof foodEntryCreateSchema>;

export const foodEntryUpdateSchema = foodEntryFieldsSchema
  .partial()
  .refine(foodEntryShapeIsValid, foodEntryShapeIssue);
export type FoodEntryUpdateInput = z.infer<typeof foodEntryUpdateSchema>;

/** Ernährungsziel: kcal-Ziel ist Pflicht, Makro-/Wasser-Ziele optional. */
const nutritionGoalFieldsSchema = z.object({
  /** ISO-Datum (YYYY-MM-DD) — ab wann dieses Ziel gilt. */
  effectiveFrom: z.iso.date(),
  kcalTarget: z.number().int().min(0).max(20000),
  proteinTargetG: z.number().min(0).max(2000).optional(),
  carbsTargetG: z.number().min(0).max(2000).optional(),
  fatTargetG: z.number().min(0).max(2000).optional(),
  waterTargetMl: z.number().int().min(0).max(20000).optional(),
});

export const nutritionGoalCreateSchema = nutritionGoalFieldsSchema.extend({ id: z.uuid().optional() });
export type NutritionGoalCreateInput = z.infer<typeof nutritionGoalCreateSchema>;

export const nutritionGoalUpdateSchema = nutritionGoalFieldsSchema.partial();
export type NutritionGoalUpdateInput = z.infer<typeof nutritionGoalUpdateSchema>;
