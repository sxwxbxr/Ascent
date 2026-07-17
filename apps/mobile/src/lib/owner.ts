import { users } from '@ascent/shared';

import { db } from '../db/client';

/**
 * ID des lokalen Nutzers (FK-Grundlage für plans/workouts). Die lokale
 * users-Tabelle enthält genau eine Zeile: den beim Login gespiegelten
 * Session-Nutzer (siehe src/db/hydrate.ts) — funktioniert daher offline.
 */
export async function getOwnerUserId(): Promise<string | null> {
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows[0]?.id ?? null;
}
