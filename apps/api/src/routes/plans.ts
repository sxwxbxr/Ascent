import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import {
  planCreateSchema,
  planExerciseCreateSchema,
  planExerciseUpdateSchema,
  planExercises,
  planUpdateSchema,
  plans,
} from '@ascent/shared';

import type { AuthEnv } from '../middleware/auth';
import { invalidReference, isVisibleExercise, notFound, parseBody, parsePagination } from './helpers';

/**
 * Router für Trainingspläne + verschachtelte Plan-Übungen. Wird ohne eigene
 * Auth-Middleware exportiert — der Orchestrator mountet `requireAuth` zentral
 * davor (siehe apps/api/src/index.ts). Zugriff auf den Nutzer: c.get('user').
 */
export const plansRouter = new Hono<AuthEnv>();

/** Lädt einen eigenen, nicht gelöschten Plan oder gibt undefined zurück. */
async function loadOwnPlan(db: DrizzleD1Database, userId: string, id: string) {
  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, id), eq(plans.userId, userId), eq(plans.deleted, false)))
    .limit(1);
  return rows[0];
}

/** Lädt eine Plan-Übung, die zum übergebenen (bereits geprüften) Plan gehört. */
async function loadOwnPlanExercise(db: DrizzleD1Database, planId: string, id: string) {
  const rows = await db
    .select()
    .from(planExercises)
    .where(and(eq(planExercises.id, id), eq(planExercises.planId, planId), eq(planExercises.deleted, false)))
    .limit(1);
  return rows[0];
}

/** GET / — eigene, nicht gelöschte Pläne, alphabetisch nach Name. */
plansRouter.get('/', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const { limit, offset } = parsePagination(c);

  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, user.id), eq(plans.deleted, false)))
    .orderBy(asc(plans.name))
    .limit(limit)
    .offset(offset);

  return c.json(rows);
});

/** POST / — neuen Plan anlegen (client-generierte id optional). */
plansRouter.post('/', async (c) => {
  const user = c.get('user');
  const parsed = await parseBody(c, planCreateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);
  const now = Date.now();
  const [row] = await db
    .insert(plans)
    .values({
      id: parsed.data.id ?? crypto.randomUUID(),
      userId: user.id,
      name: parsed.data.name,
      description: parsed.data.description,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  return c.json(row, 201);
});

/** GET /:id — Plan inkl. zugehöriger Plan-Übungen (sortiert nach position, ohne gelöschte). */
plansRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const plan = await loadOwnPlan(db, user.id, c.req.param('id'));
  if (!plan) return notFound(c);

  const exerciseRows = await db
    .select()
    .from(planExercises)
    .where(and(eq(planExercises.planId, plan.id), eq(planExercises.deleted, false)))
    .orderBy(asc(planExercises.position));

  return c.json({ ...plan, planExercises: exerciseRows });
});

/** PUT /:id — partielles Update; id/userId/createdAt aus dem Body werden ignoriert. */
plansRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const parsed = await parseBody(c, planUpdateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);
  const [row] = await db
    .update(plans)
    .set({ name: parsed.data.name, description: parsed.data.description, updatedAt: Date.now() })
    .where(and(eq(plans.id, id), eq(plans.userId, user.id), eq(plans.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.json(row);
});

/** DELETE /:id — Soft-Delete. */
plansRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = drizzle(c.env.DB);

  const [row] = await db
    .update(plans)
    .set({ deleted: true, updatedAt: Date.now() })
    .where(and(eq(plans.id, id), eq(plans.userId, user.id), eq(plans.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.body(null, 204);
});

/** POST /:planId/exercises — Übung zu einem eigenen Plan hinzufügen. */
plansRouter.post('/:planId/exercises', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const plan = await loadOwnPlan(db, user.id, c.req.param('planId'));
  if (!plan) return notFound(c);

  const parsed = await parseBody(c, planExerciseCreateSchema);
  if ('error' in parsed) return parsed.error;

  if (!(await isVisibleExercise(db, parsed.data.exerciseId, user.id))) {
    return invalidReference(c, 'exerciseId', 'Übung existiert nicht oder ist nicht sichtbar');
  }

  const now = Date.now();
  const [row] = await db
    .insert(planExercises)
    .values({
      id: parsed.data.id ?? crypto.randomUUID(),
      planId: plan.id,
      exerciseId: parsed.data.exerciseId,
      position: parsed.data.position,
      targetSets: parsed.data.targetSets,
      targetRepsMin: parsed.data.targetRepsMin,
      targetRepsMax: parsed.data.targetRepsMax,
      restSeconds: parsed.data.restSeconds,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  return c.json(row, 201);
});

/** PUT /:planId/exercises/:id — partielles Update einer Plan-Übung. */
plansRouter.put('/:planId/exercises/:id', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const plan = await loadOwnPlan(db, user.id, c.req.param('planId'));
  if (!plan) return notFound(c);

  const existing = await loadOwnPlanExercise(db, plan.id, c.req.param('id'));
  if (!existing) return notFound(c);

  const parsed = await parseBody(c, planExerciseUpdateSchema);
  if ('error' in parsed) return parsed.error;

  if (parsed.data.exerciseId !== undefined && !(await isVisibleExercise(db, parsed.data.exerciseId, user.id))) {
    return invalidReference(c, 'exerciseId', 'Übung existiert nicht oder ist nicht sichtbar');
  }

  const [row] = await db
    .update(planExercises)
    .set({
      exerciseId: parsed.data.exerciseId,
      position: parsed.data.position,
      targetSets: parsed.data.targetSets,
      targetRepsMin: parsed.data.targetRepsMin,
      targetRepsMax: parsed.data.targetRepsMax,
      restSeconds: parsed.data.restSeconds,
      updatedAt: Date.now(),
    })
    .where(eq(planExercises.id, existing.id))
    .returning();

  return c.json(row);
});

/** DELETE /:planId/exercises/:id — Soft-Delete einer Plan-Übung. */
plansRouter.delete('/:planId/exercises/:id', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const plan = await loadOwnPlan(db, user.id, c.req.param('planId'));
  if (!plan) return notFound(c);

  const existing = await loadOwnPlanExercise(db, plan.id, c.req.param('id'));
  if (!existing) return notFound(c);

  await db
    .update(planExercises)
    .set({ deleted: true, updatedAt: Date.now() })
    .where(eq(planExercises.id, existing.id));

  return c.body(null, 204);
});
