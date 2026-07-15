import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import {
  plans,
  workoutCreateSchema,
  workoutSetCreateSchema,
  workoutSetUpdateSchema,
  workoutSets,
  workoutUpdateSchema,
  workouts,
} from '@ascent/shared';

import type { AuthEnv } from '../middleware/auth';
import {
  invalidReference,
  isVisibleExercise,
  notFound,
  parseBody,
  parseOptionalNumberQuery,
  parsePagination,
} from './helpers';

/**
 * Router für Workouts + verschachtelte Sätze. Wird ohne eigene Auth-
 * Middleware exportiert — der Orchestrator mountet `requireAuth` zentral
 * davor (siehe apps/api/src/index.ts). Zugriff auf den Nutzer: c.get('user').
 */
export const workoutsRouter = new Hono<AuthEnv>();

/** Prüft, ob planId ein eigener, nicht gelöschter Plan ist. */
async function isOwnPlan(db: DrizzleD1Database, planId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.userId, userId), eq(plans.deleted, false)))
    .limit(1);
  return rows.length > 0;
}

/** Lädt ein eigenes, nicht gelöschtes Workout oder gibt undefined zurück. */
async function loadOwnWorkout(db: DrizzleD1Database, userId: string, id: string) {
  const rows = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.userId, userId), eq(workouts.deleted, false)))
    .limit(1);
  return rows[0];
}

/** Lädt einen Satz, der zum übergebenen (bereits geprüften) Workout gehört. */
async function loadOwnSet(db: DrizzleD1Database, workoutId: string, id: string) {
  const rows = await db
    .select()
    .from(workoutSets)
    .where(and(eq(workoutSets.id, id), eq(workoutSets.workoutId, workoutId), eq(workoutSets.deleted, false)))
    .limit(1);
  return rows[0];
}

/** GET / — eigene Workouts, optional gefiltert auf startedAt (from/to), neueste zuerst. */
workoutsRouter.get('/', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const { limit, offset } = parsePagination(c);

  const conditions = [eq(workouts.userId, user.id), eq(workouts.deleted, false)];

  const from = parseOptionalNumberQuery(c, 'from');
  if (from !== undefined) conditions.push(gte(workouts.startedAt, from));

  const to = parseOptionalNumberQuery(c, 'to');
  if (to !== undefined) conditions.push(lte(workouts.startedAt, to));

  const rows = await db
    .select()
    .from(workouts)
    .where(and(...conditions))
    .orderBy(desc(workouts.startedAt))
    .limit(limit)
    .offset(offset);

  return c.json(rows);
});

/** POST / — neues Workout; optionaler planId muss ein eigener Plan sein. */
workoutsRouter.post('/', async (c) => {
  const user = c.get('user');
  const parsed = await parseBody(c, workoutCreateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);

  if (parsed.data.planId !== undefined && !(await isOwnPlan(db, parsed.data.planId, user.id))) {
    return invalidReference(c, 'planId', 'Plan existiert nicht oder gehört nicht dir');
  }

  const now = Date.now();
  const [row] = await db
    .insert(workouts)
    .values({
      id: parsed.data.id ?? crypto.randomUUID(),
      userId: user.id,
      planId: parsed.data.planId,
      startedAt: parsed.data.startedAt,
      finishedAt: parsed.data.finishedAt,
      notes: parsed.data.notes,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  return c.json(row, 201);
});

/** GET /:id — Workout inkl. Sätze (sortiert nach setNumber, ohne gelöschte). */
workoutsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const workout = await loadOwnWorkout(db, user.id, c.req.param('id'));
  if (!workout) return notFound(c);

  const sets = await db
    .select()
    .from(workoutSets)
    .where(and(eq(workoutSets.workoutId, workout.id), eq(workoutSets.deleted, false)))
    .orderBy(asc(workoutSets.setNumber));

  return c.json({ ...workout, sets });
});

/** PUT /:id — partielles Update; id/userId/createdAt aus dem Body werden ignoriert. */
workoutsRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const parsed = await parseBody(c, workoutUpdateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);

  if (parsed.data.planId !== undefined && !(await isOwnPlan(db, parsed.data.planId, user.id))) {
    return invalidReference(c, 'planId', 'Plan existiert nicht oder gehört nicht dir');
  }

  const [row] = await db
    .update(workouts)
    .set({
      planId: parsed.data.planId,
      startedAt: parsed.data.startedAt,
      finishedAt: parsed.data.finishedAt,
      notes: parsed.data.notes,
      updatedAt: Date.now(),
    })
    .where(and(eq(workouts.id, id), eq(workouts.userId, user.id), eq(workouts.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.json(row);
});

/** DELETE /:id — Soft-Delete. */
workoutsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = drizzle(c.env.DB);

  const [row] = await db
    .update(workouts)
    .set({ deleted: true, updatedAt: Date.now() })
    .where(and(eq(workouts.id, id), eq(workouts.userId, user.id), eq(workouts.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.body(null, 204);
});

/** POST /:workoutId/sets — Satz zu einem eigenen Workout hinzufügen. */
workoutsRouter.post('/:workoutId/sets', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const workout = await loadOwnWorkout(db, user.id, c.req.param('workoutId'));
  if (!workout) return notFound(c);

  const parsed = await parseBody(c, workoutSetCreateSchema);
  if ('error' in parsed) return parsed.error;

  if (!(await isVisibleExercise(db, parsed.data.exerciseId, user.id))) {
    return invalidReference(c, 'exerciseId', 'Übung existiert nicht oder ist nicht sichtbar');
  }

  const now = Date.now();
  const [row] = await db
    .insert(workoutSets)
    .values({
      id: parsed.data.id ?? crypto.randomUUID(),
      workoutId: workout.id,
      exerciseId: parsed.data.exerciseId,
      setNumber: parsed.data.setNumber,
      weightKg: parsed.data.weightKg,
      reps: parsed.data.reps,
      completedAt: parsed.data.completedAt,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  return c.json(row, 201);
});

/** PUT /:workoutId/sets/:id — partielles Update eines Satzes. */
workoutsRouter.put('/:workoutId/sets/:id', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const workout = await loadOwnWorkout(db, user.id, c.req.param('workoutId'));
  if (!workout) return notFound(c);

  const existing = await loadOwnSet(db, workout.id, c.req.param('id'));
  if (!existing) return notFound(c);

  const parsed = await parseBody(c, workoutSetUpdateSchema);
  if ('error' in parsed) return parsed.error;

  if (parsed.data.exerciseId !== undefined && !(await isVisibleExercise(db, parsed.data.exerciseId, user.id))) {
    return invalidReference(c, 'exerciseId', 'Übung existiert nicht oder ist nicht sichtbar');
  }

  const [row] = await db
    .update(workoutSets)
    .set({
      exerciseId: parsed.data.exerciseId,
      setNumber: parsed.data.setNumber,
      weightKg: parsed.data.weightKg,
      reps: parsed.data.reps,
      completedAt: parsed.data.completedAt,
      updatedAt: Date.now(),
    })
    .where(eq(workoutSets.id, existing.id))
    .returning();

  return c.json(row);
});

/** DELETE /:workoutId/sets/:id — Soft-Delete eines Satzes. */
workoutsRouter.delete('/:workoutId/sets/:id', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const workout = await loadOwnWorkout(db, user.id, c.req.param('workoutId'));
  if (!workout) return notFound(c);

  const existing = await loadOwnSet(db, workout.id, c.req.param('id'));
  if (!existing) return notFound(c);

  await db.update(workoutSets).set({ deleted: true, updatedAt: Date.now() }).where(eq(workoutSets.id, existing.id));

  return c.body(null, 204);
});
