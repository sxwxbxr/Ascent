import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { nutritionGoalCreateSchema, nutritionGoalUpdateSchema, nutritionGoals } from '@ascent/shared';

import type { AuthEnv } from '../middleware/auth';
import { notFound, parseBody, parsePagination } from './helpers';

/**
 * Router für Ernährungsziele (docs/KONZEPT_Ernaehrung.md Abschnitt 2.3):
 * anfügende History-Tabelle mit eigener userId-Spalte, analog zu
 * `body-metrics.ts`. Wird ohne eigene Auth-Middleware exportiert — der
 * Orchestrator mountet `requireAuth` zentral davor (siehe apps/api/src/index.ts).
 */
export const nutritionGoalsRouter = new Hono<AuthEnv>();

/** GET / — eigene Ziele, neuestes (effectiveFrom) zuerst. */
nutritionGoalsRouter.get('/', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const { limit, offset } = parsePagination(c);

  const rows = await db
    .select()
    .from(nutritionGoals)
    .where(and(eq(nutritionGoals.userId, user.id), eq(nutritionGoals.deleted, false)))
    .orderBy(desc(nutritionGoals.effectiveFrom), desc(nutritionGoals.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json(rows);
});

/** POST / — neues Ernährungsziel anlegen (client-generierte id optional, anfügend). */
nutritionGoalsRouter.post('/', async (c) => {
  const user = c.get('user');
  const parsed = await parseBody(c, nutritionGoalCreateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);
  const now = Date.now();
  const [row] = await db
    .insert(nutritionGoals)
    .values({
      id: parsed.data.id ?? crypto.randomUUID(),
      userId: user.id,
      effectiveFrom: parsed.data.effectiveFrom,
      kcalTarget: parsed.data.kcalTarget,
      proteinTargetG: parsed.data.proteinTargetG,
      carbsTargetG: parsed.data.carbsTargetG,
      fatTargetG: parsed.data.fatTargetG,
      waterTargetMl: parsed.data.waterTargetMl,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  return c.json(row, 201);
});

/** PUT /:id — partielles Update; id/userId/createdAt aus dem Body werden ignoriert. */
nutritionGoalsRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const parsed = await parseBody(c, nutritionGoalUpdateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);
  const [row] = await db
    .update(nutritionGoals)
    .set({
      effectiveFrom: parsed.data.effectiveFrom,
      kcalTarget: parsed.data.kcalTarget,
      proteinTargetG: parsed.data.proteinTargetG,
      carbsTargetG: parsed.data.carbsTargetG,
      fatTargetG: parsed.data.fatTargetG,
      waterTargetMl: parsed.data.waterTargetMl,
      updatedAt: Date.now(),
    })
    .where(and(eq(nutritionGoals.id, id), eq(nutritionGoals.userId, user.id), eq(nutritionGoals.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.json(row);
});

/** DELETE /:id — Soft-Delete. */
nutritionGoalsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = drizzle(c.env.DB);

  const [row] = await db
    .update(nutritionGoals)
    .set({ deleted: true, updatedAt: Date.now() })
    .where(and(eq(nutritionGoals.id, id), eq(nutritionGoals.userId, user.id), eq(nutritionGoals.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.body(null, 204);
});
