import { and, asc, eq, isNull, like, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { exerciseCreateSchema, exerciseUpdateSchema, exercises } from '@ascent/shared';

import type { AuthEnv } from '../middleware/auth';
import { notFound, parseBody, parsePagination } from './helpers';

/**
 * Router für die Übungsdatenbank (global importierte + nutzereigene Übungen
 * teilen sich dieselbe Tabelle). Wird ohne eigene Auth-Middleware exportiert
 * — der Orchestrator mountet `requireAuth` zentral davor (siehe
 * apps/api/src/index.ts). Zugriff auf den Nutzer: c.get('user').
 */
export const exercisesRouter = new Hono<AuthEnv>();

/** GET / — sichtbare Übungen (global + eigene), mit optionaler Suche/Filterung. */
exercisesRouter.get('/', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const { limit, offset } = parsePagination(c);

  const conditions = [eq(exercises.deleted, false), or(isNull(exercises.userId), eq(exercises.userId, user.id))];

  // Case-insensitive Suche in name UND nameDe (explizit über lower(), statt
  // uns auf SQLites Default-LIKE-Verhalten für Nicht-ASCII-Zeichen zu verlassen).
  const q = c.req.query('q');
  if (q) {
    const pattern = `%${q.toLowerCase()}%`;
    conditions.push(or(like(sql`lower(${exercises.name})`, pattern), like(sql`lower(${exercises.nameDe})`, pattern)));
  }

  const muscle = c.req.query('muscle');
  if (muscle) conditions.push(eq(exercises.primaryMuscle, muscle));

  const category = c.req.query('category');
  if (category) conditions.push(eq(exercises.category, category));

  const equipment = c.req.query('equipment');
  if (equipment) conditions.push(eq(exercises.equipment, equipment));

  const rows = await db
    .select()
    .from(exercises)
    .where(and(...conditions))
    .orderBy(asc(exercises.name))
    .limit(limit)
    .offset(offset);

  return c.json(rows);
});

/** POST / — eigene Übung anlegen (client-generierte id optional). */
exercisesRouter.post('/', async (c) => {
  const user = c.get('user');
  const parsed = await parseBody(c, exerciseCreateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);
  const now = Date.now();
  const [row] = await db
    .insert(exercises)
    .values({
      id: parsed.data.id ?? crypto.randomUUID(),
      userId: user.id,
      name: parsed.data.name,
      nameDe: parsed.data.nameDe,
      category: parsed.data.category,
      primaryMuscle: parsed.data.primaryMuscle,
      equipment: parsed.data.equipment,
      instructionsEn: parsed.data.instructionsEn,
      instructionsDe: parsed.data.instructionsDe,
      thumbnailUrl: parsed.data.thumbnailUrl,
      gifUrl: parsed.data.gifUrl,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  return c.json(row, 201);
});

/**
 * PUT /:id — nur für eigene Übungen (userId = null bei globalen Übungen
 * matcht die Ownership-Bedingung nie, daher 404 statt 403 — kein Existenz-Leak).
 */
exercisesRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const parsed = await parseBody(c, exerciseUpdateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);
  const [row] = await db
    .update(exercises)
    .set({
      name: parsed.data.name,
      nameDe: parsed.data.nameDe,
      category: parsed.data.category,
      primaryMuscle: parsed.data.primaryMuscle,
      equipment: parsed.data.equipment,
      instructionsEn: parsed.data.instructionsEn,
      instructionsDe: parsed.data.instructionsDe,
      thumbnailUrl: parsed.data.thumbnailUrl,
      gifUrl: parsed.data.gifUrl,
      updatedAt: Date.now(),
    })
    .where(and(eq(exercises.id, id), eq(exercises.userId, user.id), eq(exercises.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.json(row);
});

/** DELETE /:id — Soft-Delete, nur für eigene Übungen (global -> 404). */
exercisesRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = drizzle(c.env.DB);

  const [row] = await db
    .update(exercises)
    .set({ deleted: true, updatedAt: Date.now() })
    .where(and(eq(exercises.id, id), eq(exercises.userId, user.id), eq(exercises.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.body(null, 204);
});
