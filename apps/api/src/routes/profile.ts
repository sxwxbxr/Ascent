import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { profileUpdateSchema, users } from '@ascent/shared';
import type { User } from '@ascent/shared';

import type { AuthEnv } from '../middleware/auth';
import { notFound, parseBody } from './helpers';

/**
 * Router für das eigene Nutzerprofil (Better-Auth verwaltet email/tier
 * separat — diese Route liefert/aktualisiert nur die App-eigenen Felder).
 * Wird ohne eigene Auth-Middleware exportiert — der Orchestrator mountet
 * `requireAuth` zentral davor (siehe apps/api/src/index.ts).
 */
export const profileRouter = new Hono<AuthEnv>();

/** Serialisiert eine users-Zeile fürs JSON: createdAt/updatedAt als Epoch-ms. */
function serializeProfile(row: User) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    emailVerified: row.emailVerified,
    gender: row.gender,
    birthDate: row.birthDate,
    heightCm: row.heightCm,
    goal: row.goal,
    tier: row.tier,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** GET / — eigenes Profil. */
profileRouter.get('/', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);

  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const row = rows[0];
  if (!row) return notFound(c);

  return c.json(serializeProfile(row));
});

/**
 * PUT / — partielles Update von displayName/gender/birthDate/heightCm/goal.
 * email/tier sind hier bewusst nicht änderbar (nicht Teil von profileUpdateSchema).
 */
profileRouter.put('/', async (c) => {
  const user = c.get('user');
  const parsed = await parseBody(c, profileUpdateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);
  const rows = await db
    .update(users)
    .set({
      displayName: parsed.data.displayName,
      gender: parsed.data.gender,
      birthDate: parsed.data.birthDate,
      heightCm: parsed.data.heightCm,
      goal: parsed.data.goal,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning();

  const row = rows[0];
  if (!row) return notFound(c);

  return c.json(serializeProfile(row));
});
