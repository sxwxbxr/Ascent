import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { foodEntries, foodEntryCreateSchema, foodEntryUpdateSchema } from '@ascent/shared';

import type { AuthEnv } from '../middleware/auth';
import { notFound, parseBody, parsePagination } from './helpers';

/**
 * Router für das Ernährungs-Tagebuch (Mahlzeiten + Wasser, docs/
 * KONZEPT_Ernaehrung.md Abschnitt 2.2). Einfaches CRUD mit eigener
 * userId-Spalte, analog zu `body-metrics.ts`. Wird ohne eigene Auth-
 * Middleware exportiert — der Orchestrator mountet `requireAuth` zentral
 * davor (siehe apps/api/src/index.ts).
 */
export const foodEntriesRouter = new Hono<AuthEnv>();

/** GET / — eigene Einträge, optional gefiltert auf loggedDate (from/to), neueste zuerst. */
foodEntriesRouter.get('/', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const { limit, offset } = parsePagination(c);

  const conditions = [eq(foodEntries.userId, user.id), eq(foodEntries.deleted, false)];

  // loggedDate ist ein ISO-Datum (YYYY-MM-DD) — lexikographischer Vergleich
  // funktioniert dafür wie ein Datumsvergleich, kein Date-Parsing nötig.
  const from = c.req.query('from');
  if (from) conditions.push(gte(foodEntries.loggedDate, from));

  const to = c.req.query('to');
  if (to) conditions.push(lte(foodEntries.loggedDate, to));

  const rows = await db
    .select()
    .from(foodEntries)
    .where(and(...conditions))
    .orderBy(desc(foodEntries.loggedDate), desc(foodEntries.loggedAt))
    .limit(limit)
    .offset(offset);

  return c.json(rows);
});

/** POST / — neuen Tagebuch-Eintrag anlegen (client-generierte id optional). */
foodEntriesRouter.post('/', async (c) => {
  const user = c.get('user');
  const parsed = await parseBody(c, foodEntryCreateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);
  const now = Date.now();
  const [row] = await db
    .insert(foodEntries)
    .values({
      id: parsed.data.id ?? crypto.randomUUID(),
      userId: user.id,
      entryType: parsed.data.entryType,
      foodId: parsed.data.foodId,
      loggedDate: parsed.data.loggedDate,
      mealSlot: parsed.data.mealSlot,
      amountG: parsed.data.amountG,
      amountMl: parsed.data.amountMl,
      kcal: parsed.data.kcal,
      proteinG: parsed.data.proteinG,
      carbsG: parsed.data.carbsG,
      fatG: parsed.data.fatG,
      loggedAt: parsed.data.loggedAt,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  return c.json(row, 201);
});

/** PUT /:id — partielles Update; id/userId/createdAt aus dem Body werden ignoriert. */
foodEntriesRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const parsed = await parseBody(c, foodEntryUpdateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);
  const [row] = await db
    .update(foodEntries)
    .set({
      entryType: parsed.data.entryType,
      foodId: parsed.data.foodId,
      loggedDate: parsed.data.loggedDate,
      mealSlot: parsed.data.mealSlot,
      amountG: parsed.data.amountG,
      amountMl: parsed.data.amountMl,
      kcal: parsed.data.kcal,
      proteinG: parsed.data.proteinG,
      carbsG: parsed.data.carbsG,
      fatG: parsed.data.fatG,
      loggedAt: parsed.data.loggedAt,
      updatedAt: Date.now(),
    })
    .where(and(eq(foodEntries.id, id), eq(foodEntries.userId, user.id), eq(foodEntries.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.json(row);
});

/** DELETE /:id — Soft-Delete. */
foodEntriesRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = drizzle(c.env.DB);

  const [row] = await db
    .update(foodEntries)
    .set({ deleted: true, updatedAt: Date.now() })
    .where(and(eq(foodEntries.id, id), eq(foodEntries.userId, user.id), eq(foodEntries.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.body(null, 204);
});
