import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { exercises, planExercises, plans, workoutSets, workouts } from '@ascent/shared';

import { db } from '../db/client';
import { newId } from '../lib/ids';
import { getOwnerUserId } from '../lib/owner';
import { setCachedActiveWorkoutId } from '../lib/active-workout';

/**
 * Schreib-/Lese-Zugriff auf Trainingseinheiten (workouts) und Sätze
 * (workout_sets) — Grundlage für Home, "Aktives Training" und Verlauf.
 * Alles läuft rein lokal gegen die Offline-SQLite (src/db/client.ts);
 * kein Netzwerk-Code hier (Sync ist ein späteres Arbeitspaket).
 *
 * Konventionen (siehe CLAUDE.md): client-generierte UUIDs (newId), Epoch-ms
 * als number (Date.now()), Soft-Delete über `deleted`. Lese-Queries filtern
 * konsequent `deleted = false`.
 */

async function requireOwnerUserId(): Promise<string> {
  const userId = await getOwnerUserId();
  if (!userId) {
    throw new Error('Kein angemeldeter Nutzer gefunden — Login erforderlich.');
  }
  return userId;
}

/** Startet eine neue Trainingseinheit (optional an einen Plan gebunden) und gibt ihre ID zurück. */
export async function startWorkout(planId?: string): Promise<string> {
  const userId = await requireOwnerUserId();
  const id = newId();
  const now = Date.now();

  await db.insert(workouts).values({
    id,
    userId,
    planId: planId ?? null,
    startedAt: now,
    finishedAt: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  });

  setCachedActiveWorkoutId(id);
  return id;
}

/**
 * Aktuell laufendes Workout (finishedAt IS NULL, deleted=false), inkl. Planname.
 * Gibt den Drizzle-Query-Builder zurück — sowohl direkt awaitbar (Resume-Check
 * beim App-Start) als auch an useLiveQuery() reichbar (reaktives Home-Banner).
 */
export function getActiveWorkout() {
  return db
    .select({
      id: workouts.id,
      planId: workouts.planId,
      planName: plans.name,
      startedAt: workouts.startedAt,
    })
    .from(workouts)
    .leftJoin(plans, eq(workouts.planId, plans.id))
    .where(and(isNull(workouts.finishedAt), eq(workouts.deleted, false)))
    .orderBy(desc(workouts.startedAt))
    .limit(1);
}

/** Workout inkl. Planname für Header/Detail-Ansichten (aktiv oder abgeschlossen). */
export function getWorkoutWithPlan(workoutId: string) {
  return db
    .select({
      id: workouts.id,
      planId: workouts.planId,
      planName: plans.name,
      startedAt: workouts.startedAt,
      finishedAt: workouts.finishedAt,
      notes: workouts.notes,
    })
    .from(workouts)
    .leftJoin(plans, eq(workouts.planId, plans.id))
    .where(and(eq(workouts.id, workoutId), eq(workouts.deleted, false)))
    .limit(1);
}

/** Markiert ein Workout als abgeschlossen (finishedAt=now). */
export async function finishWorkout(id: string): Promise<void> {
  const now = Date.now();
  await db.update(workouts).set({ finishedAt: now, updatedAt: now }).where(eq(workouts.id, id));
  setCachedActiveWorkoutId(null);
}

/** Soft-Delete eines Workouts — für "Training verwerfen" (aktiv, 0 Sätze) und "Training löschen" (Verlauf). */
export async function cancelWorkout(id: string): Promise<void> {
  const now = Date.now();
  await db.update(workouts).set({ deleted: true, updatedAt: now }).where(eq(workouts.id, id));
  setCachedActiveWorkoutId(null);
}

/** Speichert/aktualisiert die Notiz eines Workouts (Verlauf-Detail). */
export async function updateWorkoutNotes(id: string, notes: string | null): Promise<void> {
  const now = Date.now();
  await db.update(workouts).set({ notes, updatedAt: now }).where(eq(workouts.id, id));
}

/** Erfasst einen Satz (completedAt=now) und gibt seine ID zurück. */
export async function addSet(input: {
  workoutId: string;
  exerciseId: string;
  setNumber: number;
  weightKg: number;
  reps: number;
}): Promise<string> {
  const id = newId();
  const now = Date.now();

  await db.insert(workoutSets).values({
    id,
    workoutId: input.workoutId,
    exerciseId: input.exerciseId,
    setNumber: input.setNumber,
    weightKg: input.weightKg,
    reps: input.reps,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  });

  return id;
}

/** Aktualisiert Gewicht/Wiederholungen/Satznummer eines erfassten Satzes. */
export async function updateSet(
  id: string,
  patch: Partial<{ weightKg: number; reps: number; setNumber: number }>,
): Promise<void> {
  await db
    .update(workoutSets)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(workoutSets.id, id));
}

/** Soft-Delete eines einzelnen Satzes. */
export async function deleteSet(id: string): Promise<void> {
  await db.update(workoutSets).set({ deleted: true, updatedAt: Date.now() }).where(eq(workoutSets.id, id));
}

/**
 * Alle erfassten Sätze eines Workouts inkl. Übungsname, sortiert nach Satznummer.
 * Dient sowohl dem aktiven Training (Gruppierung nach Übung, reaktiv über
 * useLiveQuery) als auch dem Verlauf-Detail (readonly).
 */
export function getWorkoutSetsWithExercise(workoutId: string) {
  return db
    .select({
      id: workoutSets.id,
      exerciseId: workoutSets.exerciseId,
      exerciseName: exercises.name,
      exerciseNameDe: exercises.nameDe,
      setNumber: workoutSets.setNumber,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      completedAt: workoutSets.completedAt,
    })
    .from(workoutSets)
    .innerJoin(exercises, eq(workoutSets.exerciseId, exercises.id))
    .where(and(eq(workoutSets.workoutId, workoutId), eq(workoutSets.deleted, false)))
    .orderBy(asc(workoutSets.setNumber));
}

/** Übungsblöcke eines Plans (Name, Zielwerte, Pausenzeit), sortiert nach Position. */
export function getPlanExerciseBlocks(planId: string) {
  return db
    .select({
      id: planExercises.id,
      exerciseId: planExercises.exerciseId,
      exerciseName: exercises.name,
      exerciseNameDe: exercises.nameDe,
      position: planExercises.position,
      targetSets: planExercises.targetSets,
      targetRepsMin: planExercises.targetRepsMin,
      targetRepsMax: planExercises.targetRepsMax,
      restSeconds: planExercises.restSeconds,
    })
    .from(planExercises)
    .innerJoin(exercises, eq(planExercises.exerciseId, exercises.id))
    .where(and(eq(planExercises.planId, planId), eq(planExercises.deleted, false)))
    .orderBy(asc(planExercises.position));
}

/**
 * Sätze der jeweiligen Satznummer aus dem letzten ABGESCHLOSSENEN Workout mit
 * dieser Übung (Prefill-Grundlage) — schliesst `vorWorkoutId` (das gerade
 * laufende Workout) explizit aus, damit nicht die eigenen, in dieser Sitzung
 * bereits erfassten Sätze als "letztes Mal" erscheinen.
 */
export async function getLastSetsForExercise(
  exerciseId: string,
  vorWorkoutId: string,
): Promise<Array<{ setNumber: number; weightKg: number; reps: number }>> {
  const lastWorkoutRows = await db
    .select({ workoutId: workoutSets.workoutId })
    .from(workoutSets)
    .innerJoin(workouts, eq(workoutSets.workoutId, workouts.id))
    .where(
      and(
        eq(workoutSets.exerciseId, exerciseId),
        eq(workoutSets.deleted, false),
        eq(workouts.deleted, false),
        isNotNull(workouts.finishedAt),
        ne(workouts.id, vorWorkoutId),
      ),
    )
    .orderBy(desc(workouts.finishedAt))
    .limit(1);

  const lastWorkoutId = lastWorkoutRows[0]?.workoutId;
  if (!lastWorkoutId) {
    return [];
  }

  return db
    .select({
      setNumber: workoutSets.setNumber,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
    })
    .from(workoutSets)
    .where(
      and(
        eq(workoutSets.workoutId, lastWorkoutId),
        eq(workoutSets.exerciseId, exerciseId),
        eq(workoutSets.deleted, false),
      ),
    )
    .orderBy(asc(workoutSets.setNumber));
}

/** Trainingsvolumen (Summe Gewicht × Wiederholungen) einer Satzliste. */
export function sumVolume(sets: ReadonlyArray<{ weightKg: number; reps: number }>): number {
  return sets.reduce((total, set) => total + set.weightKg * set.reps, 0);
}

/**
 * Zusammenfassungen abgeschlossener Workouts (Planname, Anzahl Übungen/Sätze,
 * Volumen), neueste zuerst — Grundlage für Home ("Letzte Trainings", limit=3)
 * und Verlauf (alle, limit=undefined). Reaktiv über die `workouts`-Tabelle
 * (useLiveQuery hört nur auf die FROM-Tabelle; das deckt Start/Abschluss/
 * Löschung ab, s. Kommentar in getActiveWorkout).
 */
export function getFinishedWorkoutSummaries(limit?: number) {
  const query = db
    .select({
      id: workouts.id,
      planId: workouts.planId,
      planName: plans.name,
      startedAt: workouts.startedAt,
      finishedAt: workouts.finishedAt,
      setCount: sql<number>`count(${workoutSets.id})`.as('set_count'),
      exerciseCount: sql<number>`count(distinct ${workoutSets.exerciseId})`.as('exercise_count'),
      volumeKg: sql<number>`coalesce(sum(${workoutSets.weightKg} * ${workoutSets.reps}), 0)`.as('volume_kg'),
    })
    .from(workouts)
    .leftJoin(plans, eq(workouts.planId, plans.id))
    .leftJoin(workoutSets, and(eq(workoutSets.workoutId, workouts.id), eq(workoutSets.deleted, false)))
    .where(and(isNotNull(workouts.finishedAt), eq(workouts.deleted, false)))
    .groupBy(workouts.id)
    .orderBy(desc(workouts.finishedAt));

  return limit === undefined ? query : query.limit(limit);
}
