import { users } from '@ascent/shared';
import type { Tier } from '@ascent/shared';

import { db } from './client';

/**
 * Spiegelt den eingeloggten Session-Nutzer in die lokale `users`-Tabelle
 * (Drizzle, onConflictDoUpdate auf `id`). Grundlage für die FK `userId` auf
 * plans/workouts (siehe src/lib/owner.ts) — funktioniert dadurch auch rein
 * offline, weil die lokale Zeile bereits beim letzten Online-Login geschrieben
 * wurde. createdAt/updatedAt sind hier laut Schema-Konvention (packages/
 * shared/src/db/schema.ts, users-Tabelle) Date-Objekte (mode 'timestamp_ms'),
 * nicht Epoch-ms-Zahlen wie bei den übrigen Sync-Tabellen.
 *
 * Der eigentliche Übungs-/Daten-Sync (vormals `hydrateExercises` hier in
 * dieser Datei) lebt jetzt generalisiert für ALLE Sync-Tabellen in
 * src/db/sync.ts (runSync) — diese Datei bleibt bewusst schlank, weil
 * upsertLocalUser kein Sync-Tabellen-Datensatz ist (keine `deleted`-Spalte,
 * kein Cursor, läuft unabhängig von Push/Pull).
 */
export async function upsertLocalUser(user: {
  id: string;
  email: string;
  name: string;
  tier?: Tier;
}): Promise<void> {
  const now = new Date();
  const tier: Tier = user.tier ?? 'free';

  await db
    .insert(users)
    .values({
      id: user.id,
      email: user.email,
      displayName: user.name,
      tier,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: user.email,
        displayName: user.name,
        tier,
        updatedAt: now,
      },
    });
}
