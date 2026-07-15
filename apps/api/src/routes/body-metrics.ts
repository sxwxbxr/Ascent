import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { bodyMetricCreateSchema, bodyMetricUpdateSchema, bodyMetrics } from '@ascent/shared';

import type { AuthEnv } from '../middleware/auth';
import { notFound, parseBody, parseOptionalNumberQuery, parsePagination } from './helpers';

/**
 * Router für Körpermass-Einträge. Wird ohne eigene Auth-Middleware
 * exportiert — der Orchestrator mountet `requireAuth` zentral davor (siehe
 * apps/api/src/index.ts). Zugriff auf den Nutzer: c.get('user').
 */
export const bodyMetricsRouter = new Hono<AuthEnv>();

/** GET / — eigene Einträge, optional gefiltert auf measuredAt (from/to), neueste zuerst. */
bodyMetricsRouter.get('/', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const { limit, offset } = parsePagination(c);

  const conditions = [eq(bodyMetrics.userId, user.id), eq(bodyMetrics.deleted, false)];

  const from = parseOptionalNumberQuery(c, 'from');
  if (from !== undefined) conditions.push(gte(bodyMetrics.measuredAt, from));

  const to = parseOptionalNumberQuery(c, 'to');
  if (to !== undefined) conditions.push(lte(bodyMetrics.measuredAt, to));

  const rows = await db
    .select()
    .from(bodyMetrics)
    .where(and(...conditions))
    .orderBy(desc(bodyMetrics.measuredAt))
    .limit(limit)
    .offset(offset);

  return c.json(rows);
});

/** POST / — neuen Körpermass-Eintrag anlegen (client-generierte id optional). */
bodyMetricsRouter.post('/', async (c) => {
  const user = c.get('user');
  const parsed = await parseBody(c, bodyMetricCreateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);
  const now = Date.now();
  const [row] = await db
    .insert(bodyMetrics)
    .values({
      id: parsed.data.id ?? crypto.randomUUID(),
      userId: user.id,
      measuredAt: parsed.data.measuredAt,
      weightKg: parsed.data.weightKg,
      bodyFatPercent: parsed.data.bodyFatPercent,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  return c.json(row, 201);
});

/** PUT /:id — partielles Update; id/userId/createdAt aus dem Body werden ignoriert. */
bodyMetricsRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const parsed = await parseBody(c, bodyMetricUpdateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);
  const [row] = await db
    .update(bodyMetrics)
    .set({
      measuredAt: parsed.data.measuredAt,
      weightKg: parsed.data.weightKg,
      bodyFatPercent: parsed.data.bodyFatPercent,
      updatedAt: Date.now(),
    })
    .where(and(eq(bodyMetrics.id, id), eq(bodyMetrics.userId, user.id), eq(bodyMetrics.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.json(row);
});

/** DELETE /:id — Soft-Delete. */
bodyMetricsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = drizzle(c.env.DB);

  const [row] = await db
    .update(bodyMetrics)
    .set({ deleted: true, updatedAt: Date.now() })
    .where(and(eq(bodyMetrics.id, id), eq(bodyMetrics.userId, user.id), eq(bodyMetrics.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.body(null, 204);
});
