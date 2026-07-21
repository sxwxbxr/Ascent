import { users } from '@ascent/shared';

import { db } from '../db/client';
import { authClient } from '../auth/client';

/**
 * In-Memory-Owner-Id, gesetzt vom Auth-Gate (app/_layout.tsx), sobald die
 * Session bekannt ist. Beseitigt die Race Condition beim App-Start: die
 * lokale users-Zeile wird erst asynchron via upsertLocalUser geschrieben,
 * der Home-Screen (Landing nach Login) las die Owner-Id aber sofort — und
 * bekam null, solange die Zeile noch fehlte (→ "keine eigenen Pläne" im
 * Training-starten-Picker, obwohl der Pläne-Tab sie später zeigte).
 */
let cachedOwnerUserId: string | null = null;

/** Vom Auth-Gate synchron gesetzt, sobald die Session-User-Id feststeht. */
export function setOwnerUserId(id: string | null): void {
  cachedOwnerUserId = id;
}

/**
 * ID des lokalen Nutzers (FK-Grundlage für plans/workouts), für die
 * nicht-reaktive Datenschicht (src/data/*). Bevorzugt die in-memory gesetzte
 * Session-Id; fällt nur beim Kaltstart (vor dem Auth-Gate) auf die lokale
 * users-Tabelle zurück.
 */
export async function getOwnerUserId(): Promise<string | null> {
  if (cachedOwnerUserId) return cachedOwnerUserId;
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Reaktive Owner-Id für Screens: kommt direkt aus der (auch offline synchron
 * gecachten) Better-Auth-Session — sofort beim ersten Render verfügbar, kein
 * DB-Read, keine Race Condition. Die Owner-Id ist per Definition die
 * Session-User-Id: sowohl serverseitig synchronisierte Pläne (userId =
 * Session-User) als auch app-seitig angelegte (getOwnerUserId = dieselbe Id)
 * tragen sie.
 */
export function useOwnerUserId(): string | null {
  const { data } = authClient.useSession();
  return data?.user?.id ?? null;
}
