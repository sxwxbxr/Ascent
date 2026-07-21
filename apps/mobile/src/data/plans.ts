import { and, asc, eq } from 'drizzle-orm';
import {
  exercises,
  planCreateSchema,
  planExerciseUpdateSchema,
  planExercises,
  planUpdateSchema,
  plans,
} from '@ascent/shared';
import type { Plan, PlanExercise, PlanTemplate } from '@ascent/shared';

import { db } from '../db/client';
import { newId } from '../lib/ids';
import { getOwnerUserId } from '../lib/owner';
import { queueSyncPush } from '../db/sync';

/**
 * Alle Schreiboperationen brauchen den lokalen Besitzer (FK-Grundlage,
 * Sync-Konvention). Sollte praktisch nie fehlschlagen (die lokale
 * users-Tabelle wird beim Login gespiegelt, siehe src/lib/owner.ts) —
 * ein fehlender Nutzer ist ein Programmierfehler, kein erwarteter Zustand.
 */
async function requireOwnerUserId(): Promise<string> {
  const userId = await getOwnerUserId();
  if (!userId) {
    throw new Error('Kein lokaler Nutzer gefunden — bitte neu anmelden.');
  }
  return userId;
}

// ---------------------------------------------------------------------------
// Lese-Queries (Query-Builder, NICHT ausgeführt) — zur Verwendung mit
// useLiveQuery in den Screens. Wichtig für die Reaktivität: drizzles
// useLiveQuery (drizzle-orm/expo-sqlite, Version 0.45) registriert den
// Change-Listener ausschliesslich auf der Basistabelle der Query
// (query.config.table, siehe node_modules/drizzle-orm/expo-sqlite/query.js) —
// Joins/Subqueries lösen KEINE Reaktivität aus. Das bestimmt die Query-Form
// unten bewusst (siehe Datenreport im Abschlussbericht).
// ---------------------------------------------------------------------------

/** Eigene, nicht gelöschte Pläne, alphabetisch — Basistabelle `plans` (reaktiv auf Plan-CRUD). */
export function buildPlansQuery(ownerUserId: string) {
  return db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, ownerUserId), eq(plans.deleted, false)))
    .orderBy(asc(plans.name));
}

/**
 * planId je nicht gelöschter Plan-Übung, über ALLE Pläne. Bewusst ohne Join
 * auf `plans` (Basistabelle bleibt `plan_exercises`, damit die Query auf
 * Hinzufügen/Entfernen von Übungen reagiert). Für die Anzahl-Anzeige in der
 * Planliste client-seitig nach planId gruppieren (die lokale DB enthält ohnehin
 * nur die Pläne des einen angemeldeten Nutzers).
 */
export function buildPlanExerciseCountsQuery() {
  return db.select({ planId: planExercises.planId }).from(planExercises).where(eq(planExercises.deleted, false));
}

/** Einzelner Plan (Editor-Kopf: Name/Beschreibung) — Basistabelle `plans`. */
export function buildPlanQuery(id: string) {
  return db
    .select()
    .from(plans)
    .where(and(eq(plans.id, id), eq(plans.deleted, false)))
    .limit(1);
}

/** Zeile einer Plan-Übung inkl. der zur Anzeige nötigen Übungsfelder (Join-Projektion). */
export type PlanExerciseRow = {
  id: string;
  planId: string;
  exerciseId: string;
  position: number;
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  restSeconds: number | null;
  exerciseName: string | null;
  exerciseNameDe: string | null;
  exerciseThumbnailUrl: string | null;
};

/**
 * Plan-Übungen eines Plans, sortiert nach Position, inkl. Namen/Thumbnail der
 * verknüpften Übung. Basistabelle bleibt `plan_exercises` (siehe Kommentar
 * oben) — Hinzufügen/Entfernen/Verschieben/Editieren von Plan-Übungen lösen
 * damit einen Live-Refresh aus; Änderungen an der verknüpften Übung selbst
 * (selten, nur bei eigenen Übungen) nicht — akzeptierter Kompromiss.
 */
export function buildPlanExercisesQuery(planId: string) {
  return db
    .select({
      id: planExercises.id,
      planId: planExercises.planId,
      exerciseId: planExercises.exerciseId,
      position: planExercises.position,
      targetSets: planExercises.targetSets,
      targetRepsMin: planExercises.targetRepsMin,
      targetRepsMax: planExercises.targetRepsMax,
      restSeconds: planExercises.restSeconds,
      exerciseName: exercises.name,
      exerciseNameDe: exercises.nameDe,
      exerciseThumbnailUrl: exercises.thumbnailUrl,
    })
    .from(planExercises)
    .leftJoin(exercises, eq(exercises.id, planExercises.exerciseId))
    .where(and(eq(planExercises.planId, planId), eq(planExercises.deleted, false)))
    .orderBy(asc(planExercises.position));
}

// ---------------------------------------------------------------------------
// Schreiboperationen
// ---------------------------------------------------------------------------

/** Neuen Plan anlegen (Name Pflicht, Beschreibung folgt später über updatePlan). */
export async function createPlan(name: string): Promise<Plan> {
  const userId = await requireOwnerUserId();
  const parsed = planCreateSchema.parse({ name });
  const now = Date.now();

  const [row] = await db
    .insert(plans)
    .values({
      id: newId(),
      userId,
      name: parsed.name,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  queueSyncPush();
  return row;
}

/**
 * Erstellt aus einer Vorlage (PLAN_TEMPLATES aus @ascent/shared) einen
 * eigenen, bearbeitbaren Plan samt Übungen. Der neue Plan gehört dem Nutzer
 * und ist danach wie jeder andere editier- und synchronisierbar — die
 * Vorlage selbst bleibt unverändert (reiner Katalog). Setzt voraus, dass die
 * referenzierten globalen Übungen lokal vorhanden sind (Hydration beim Login,
 * siehe src/db/sync.ts) — die lokale FK-Prüfung (PRAGMA foreign_keys) würde
 * sonst greifen; in der Praxis ist die Hydration beim Öffnen des Pickers längst
 * durch.
 */
export async function instantiateTemplate(template: PlanTemplate): Promise<Plan> {
  const userId = await requireOwnerUserId();
  const now = Date.now();
  const planId = newId();

  const [plan] = await db
    .insert(plans)
    .values({
      id: planId,
      userId,
      name: template.name,
      description: template.goal,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  if (template.exercises.length > 0) {
    await db.insert(planExercises).values(
      template.exercises.map((ex, index) => ({
        id: newId(),
        planId,
        exerciseId: ex.exerciseId,
        position: index,
        targetSets: ex.targetSets,
        targetRepsMin: ex.targetRepsMin,
        targetRepsMax: ex.targetRepsMax,
        restSeconds: ex.restSeconds,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      })),
    );
  }

  queueSyncPush();
  return plan;
}

/**
 * Partielles Update (Name/Beschreibung). Undefinierte Felder bleiben
 * unangetastet (drizzles `.set()` filtert `undefined` heraus) — echtes
 * Leeren eines Felds über `null`/leeren String ist hier bewusst nicht
 * vorgesehen (spiegelt die Server-Validierung, siehe planUpdateSchema).
 */
export type PlanPatch = { name?: string; description?: string };

export async function updatePlan(id: string, patch: PlanPatch): Promise<Plan | undefined> {
  const parsed = planUpdateSchema.parse(patch);
  const [row] = await db
    .update(plans)
    .set({ name: parsed.name, description: parsed.description, updatedAt: Date.now() })
    .where(and(eq(plans.id, id), eq(plans.deleted, false)))
    .returning();
  queueSyncPush();
  return row;
}

/** Soft-Delete des Plans INKLUSIVE aller zugehörigen (nicht bereits gelöschten) Plan-Übungen. */
export async function softDeletePlan(id: string): Promise<void> {
  const now = Date.now();
  await db.update(plans).set({ deleted: true, updatedAt: now }).where(and(eq(plans.id, id), eq(plans.deleted, false)));
  await db
    .update(planExercises)
    .set({ deleted: true, updatedAt: now })
    .where(and(eq(planExercises.planId, id), eq(planExercises.deleted, false)));
  queueSyncPush();
}

/** Übung an einen Plan anhängen: Position = aktuelles Maximum + 1, Defaults 3 Sätze / 90 s Pause. */
export async function addExerciseToPlan(planId: string, exerciseId: string): Promise<PlanExercise> {
  const siblings = await db
    .select({ position: planExercises.position })
    .from(planExercises)
    .where(and(eq(planExercises.planId, planId), eq(planExercises.deleted, false)));

  const nextPosition = siblings.reduce((max, row) => Math.max(max, row.position), -1) + 1;
  const now = Date.now();

  const [row] = await db
    .insert(planExercises)
    .values({
      id: newId(),
      planId,
      exerciseId,
      position: nextPosition,
      targetSets: 3,
      restSeconds: 90,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  queueSyncPush();
  return row;
}

/**
 * Partielles Update einer Plan-Übung (Zielwerte). `exerciseId`/`position`
 * werden hier bewusst nicht angeboten (Austausch der Übung = entfernen +
 * neu hinzufügen; Position wird über movePlanExercise gesteuert).
 * Die Min≤Max-Prüfung übernimmt planExerciseUpdateSchema (gleiche Regel wie
 * am Server) — sie greift nur, wenn beide Werte im selben Patch enthalten
 * sind; die UI übergibt deshalb beim Editieren stets beide Wdh.-Felder zusammen.
 */
export type PlanExercisePatch = {
  targetSets?: number;
  targetRepsMin?: number;
  targetRepsMax?: number;
  restSeconds?: number;
};

export async function updatePlanExercise(id: string, patch: PlanExercisePatch): Promise<PlanExercise | undefined> {
  const parsed = planExerciseUpdateSchema.parse(patch);
  const [row] = await db
    .update(planExercises)
    .set({
      targetSets: parsed.targetSets,
      targetRepsMin: parsed.targetRepsMin,
      targetRepsMax: parsed.targetRepsMax,
      restSeconds: parsed.restSeconds,
      updatedAt: Date.now(),
    })
    .where(eq(planExercises.id, id))
    .returning();
  queueSyncPush();
  return row;
}

/** Plan-Übung entfernen (Soft-Delete, keine Bestätigung — analog zum Design). */
export async function removePlanExercise(id: string): Promise<void> {
  await db.update(planExercises).set({ deleted: true, updatedAt: Date.now() }).where(eq(planExercises.id, id));
  queueSyncPush();
}

export type MoveDirection = 'hoch' | 'runter';

/**
 * Vertauscht die Position mit dem Nachbarn in der aktuellen Reihenfolge
 * (nicht arithmetisch über `position ± 1` — Positionen können nach Löschungen
 * Lücken haben). Kein Transaktions-Wrapper: zwei sequentielle Updates sind für
 * den Einzelnutzer-Offline-Fall ausreichend robust (siehe Abschlussbericht).
 */
export async function movePlanExercise(id: string, richtung: MoveDirection): Promise<void> {
  const [current] = await db.select().from(planExercises).where(eq(planExercises.id, id)).limit(1);
  if (!current) return;

  const siblings = await db
    .select()
    .from(planExercises)
    .where(and(eq(planExercises.planId, current.planId), eq(planExercises.deleted, false)))
    .orderBy(asc(planExercises.position));

  const index = siblings.findIndex((row) => row.id === id);
  if (index === -1) return;

  const neighborIndex = richtung === 'hoch' ? index - 1 : index + 1;
  const neighbor = siblings[neighborIndex];
  if (!neighbor) return; // schon am Anfang/Ende

  const now = Date.now();
  await db.update(planExercises).set({ position: neighbor.position, updatedAt: now }).where(eq(planExercises.id, current.id));
  await db.update(planExercises).set({ position: current.position, updatedAt: now }).where(eq(planExercises.id, neighbor.id));
  queueSyncPush();
}
