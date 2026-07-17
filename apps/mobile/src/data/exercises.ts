import { and, asc, eq, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { exerciseCreateSchema, exerciseUpdateSchema, exercises } from '@ascent/shared';
import type { Exercise } from '@ascent/shared';

import { db } from '../db/client';
import { newId } from '../lib/ids';
import { getOwnerUserId } from '../lib/owner';

async function requireOwnerUserId(): Promise<string> {
  const userId = await getOwnerUserId();
  if (!userId) {
    throw new Error('Kein lokaler Nutzer gefunden — bitte neu anmelden.');
  }
  return userId;
}

/**
 * Die 10 Kategoriewerte aus der Übungsdatenbank (englisch in der DB, siehe
 * Import-Datenlage) mit deutschem Anzeigelabel für Filter-Chips/Detailseite.
 */
export const EXERCISE_CATEGORIES: ReadonlyArray<{ value: string; labelDe: string }> = [
  { value: 'back', labelDe: 'Rücken' },
  { value: 'cardio', labelDe: 'Cardio' },
  { value: 'chest', labelDe: 'Brust' },
  { value: 'lower arms', labelDe: 'Unterarme' },
  { value: 'lower legs', labelDe: 'Unterschenkel' },
  { value: 'neck', labelDe: 'Nacken' },
  { value: 'shoulders', labelDe: 'Schultern' },
  { value: 'upper arms', labelDe: 'Oberarme' },
  { value: 'upper legs', labelDe: 'Oberschenkel' },
  { value: 'waist', labelDe: 'Rumpf' },
];

/** Deutsches Label für einen Kategoriewert; Fallback auf den Rohwert (z. B. bei künftigen/unbekannten Werten). */
export function categoryLabelDe(category: string | null | undefined): string | null {
  if (!category) return null;
  return EXERCISE_CATEGORIES.find((c) => c.value === category)?.labelDe ?? category;
}

// ---------------------------------------------------------------------------
// Lese-Queries (Query-Builder, NICHT ausgeführt) — für useLiveQuery in den
// Screens. Basistabelle ist überall `exercises` selbst (kein Join), damit
// drizzles useLiveQuery (reagiert nur auf die FROM-Basistabelle, siehe
// Kommentar in src/data/plans.ts) korrekt auf Anlegen/Ändern/Löschen von
// (eigenen) Übungen reagiert.
// ---------------------------------------------------------------------------

export type ExerciseListFilter = {
  /** Lokaler Besitzer — bestimmt, welche eigenen Übungen zusätzlich zu den globalen sichtbar sind. */
  ownerUserId: string;
  /** Suchtext, case-insensitive gegen name UND nameDe (siehe Begründung bei buildExerciseListQuery). */
  search?: string;
  /** Exakter Kategoriewert (einer der EXERCISE_CATEGORIES-Werte). */
  category?: string;
  /** Exakter Equipment-Wert (siehe buildDistinctEquipmentQuery). */
  equipment?: string;
  /** Chip "Eigene": nur nutzereigene Übungen statt global+eigene. */
  onlyOwn?: boolean;
  limit: number;
};

/**
 * Übungsliste global (userId null) + eigene, mit Suche/Filtern, eigene zuerst.
 *
 * Case-insensitive Suche bewusst über `like(lower(spalte), ...)` statt
 * drizzles `ilike` — `ilike` rendert das SQL-Schlüsselwort `ILIKE`, das SQLite
 * nicht kennt (siehe node_modules/drizzle-orm/sql/expressions/conditions.js);
 * das ist exakt das Muster, das der Server bereits nutzt
 * (apps/api/src/routes/exercises.ts) — hier bewusst gespiegelt.
 */
export function buildExerciseListQuery(filter: ExerciseListFilter) {
  const conditions: (SQL | undefined)[] = [eq(exercises.deleted, false)];

  conditions.push(
    filter.onlyOwn ? eq(exercises.userId, filter.ownerUserId) : or(isNull(exercises.userId), eq(exercises.userId, filter.ownerUserId)),
  );

  const search = filter.search?.trim();
  if (search) {
    const pattern = `%${search.toLowerCase()}%`;
    conditions.push(or(like(sql`lower(${exercises.name})`, pattern), like(sql`lower(${exercises.nameDe})`, pattern)));
  }

  if (filter.category) conditions.push(eq(exercises.category, filter.category));
  if (filter.equipment) conditions.push(eq(exercises.equipment, filter.equipment));

  return db
    .select()
    .from(exercises)
    .where(and(...conditions))
    .orderBy(asc(sql`(${exercises.userId} is null)`), asc(exercises.name))
    .limit(filter.limit);
}

/** Einzelne Übung nach id (Detailscreen). */
export function buildExerciseByIdQuery(id: string) {
  return db.select().from(exercises).where(and(eq(exercises.id, id), eq(exercises.deleted, false))).limit(1);
}

/** Distinct Equipment-Werte (englisch belassen) für die Equipment-Filter-Chips. */
export function buildDistinctEquipmentQuery() {
  return db
    .selectDistinct({ equipment: exercises.equipment })
    .from(exercises)
    .where(and(eq(exercises.deleted, false), isNotNull(exercises.equipment)))
    .orderBy(asc(exercises.equipment));
}

// ---------------------------------------------------------------------------
// Schreiboperationen — ausschliesslich für eigene Übungen (userId gesetzt).
// Globale, importierte Übungen sind vom Client nie schreibbar (Ownership-
// Bedingung unten schliesst userId = null implizit aus, analog zum Server).
// ---------------------------------------------------------------------------

export type OwnExerciseInput = {
  name: string;
  category?: string;
  primaryMuscle?: string;
  equipment?: string;
  instructionsDe?: string;
};

/** Eigene Übung anlegen. Eigene Übungen haben nie Medien (thumbnailUrl/gifUrl bleiben NULL). */
export async function createOwnExercise(input: OwnExerciseInput): Promise<Exercise> {
  const userId = await requireOwnerUserId();
  const parsed = exerciseCreateSchema.parse(input);
  const now = Date.now();

  const [row] = await db
    .insert(exercises)
    .values({
      id: newId(),
      userId,
      name: parsed.name,
      category: parsed.category,
      primaryMuscle: parsed.primaryMuscle,
      equipment: parsed.equipment,
      instructionsDe: parsed.instructionsDe,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  return row;
}

export type OwnExercisePatch = Partial<OwnExerciseInput>;

/** Update — betrifft nur Übungen, deren userId dem aktuellen Besitzer entspricht (No-Op sonst, kein Fehler). */
export async function updateOwnExercise(id: string, patch: OwnExercisePatch): Promise<Exercise | undefined> {
  const userId = await requireOwnerUserId();
  const parsed = exerciseUpdateSchema.parse(patch);

  const [row] = await db
    .update(exercises)
    .set({
      name: parsed.name,
      category: parsed.category,
      primaryMuscle: parsed.primaryMuscle,
      equipment: parsed.equipment,
      instructionsDe: parsed.instructionsDe,
      updatedAt: Date.now(),
    })
    .where(and(eq(exercises.id, id), eq(exercises.userId, userId), eq(exercises.deleted, false)))
    .returning();

  return row;
}

/** Soft-Delete — nur wenn userId gesetzt UND dem aktuellen Besitzer entspricht (globale Übungen bleiben unantastbar). */
export async function softDeleteOwnExercise(id: string): Promise<void> {
  const userId = await requireOwnerUserId();
  await db
    .update(exercises)
    .set({ deleted: true, updatedAt: Date.now() })
    .where(and(eq(exercises.id, id), eq(exercises.userId, userId), eq(exercises.deleted, false)));
}
