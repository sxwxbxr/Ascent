import { and, eq, isNull, or } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { Context } from 'hono';
import { exercises } from '@ascent/shared';
import type { ZodError, ZodType } from 'zod';

import type { AuthEnv } from '../middleware/auth';

/** Kompakte, clienttaugliche Zod-Fehlerdetails (kein voller Stacktrace). */
function formatZodIssues(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

/** Ergebnis von {@link parseBody}: entweder die validierten Daten oder eine fertige 400-Response. */
export type ParseResult<T> = { data: T } | { error: Response };

/**
 * Liest den JSON-Body und validiert ihn gegen das übergebene Zod-Schema.
 * Bei kaputtem JSON oder Validierungsfehlern liefert dies direkt eine fertige
 * 400-Response ({ error, details }), die der Aufrufer nur durchreichen muss:
 *
 * ```ts
 * const parsed = await parseBody(c, someSchema);
 * if ('error' in parsed) return parsed.error;
 * // parsed.data ist ab hier validiert und typisiert
 * ```
 */
export async function parseBody<T>(c: Context<AuthEnv>, schema: ZodType<T>): Promise<ParseResult<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    json = undefined;
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return { error: c.json({ error: 'Ungültige Eingabe', details: formatZodIssues(result.error) }, 400) };
  }
  return { data: result.data };
}

/** Einheitliche 404-Antwort: Ressource existiert nicht ODER gehört jemand anderem (kein Existenz-Leak). */
export function notFound(c: Context<AuthEnv>): Response {
  return c.json({ error: 'Nicht gefunden' }, 404);
}

export type Pagination = { limit: number; offset: number };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Liest ?limit/?offset aus der Query (Default 50, Maximum 200, Minimum 0). */
export function parsePagination(c: Context<AuthEnv>): Pagination {
  const rawLimit = Number(c.req.query('limit'));
  const rawOffset = Number(c.req.query('offset'));

  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.trunc(rawOffset) : 0;

  return { limit, offset };
}

/** Liest einen optionalen Zahl-Query-Parameter (z. B. from/to); ungültige Werte werden ignoriert. */
export function parseOptionalNumberQuery(c: Context<AuthEnv>, key: string): number | undefined {
  const raw = c.req.query(key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Prüft, ob eine Übung für den Nutzer sichtbar ist: global (userId null) oder
 * eigene, jeweils nicht gelöscht. Wird für exerciseId-Referenzen in Plan-
 * Übungen und Workout-Sätzen gebraucht.
 */
export async function isVisibleExercise(
  db: DrizzleD1Database,
  exerciseId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(
      and(
        eq(exercises.id, exerciseId),
        eq(exercises.deleted, false),
        or(isNull(exercises.userId), eq(exercises.userId, userId)),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/** Fertige 400-Antwort für eine ungültige Fremdschlüssel-Referenz (z. B. exerciseId/planId). */
export function invalidReference(c: Context<AuthEnv>, path: string, message: string): Response {
  return c.json({ error: 'Ungültige Eingabe', details: [{ path: [path], message }] }, 400);
}
