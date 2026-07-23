import { desc, eq } from 'drizzle-orm';
import { bodyMetrics } from '@ascent/shared';

import { db } from '../db/client';
import { queueSyncPush } from '../db/sync';
import { newId } from '../lib/ids';
import { getOwnerUserId } from '../lib/owner';

/**
 * Schreib-/Lese-Zugriff auf Körpermass-Verlauf (body_metrics) — aktuell nur
 * das optionale Körpergewicht beim Trainingsabschluss (app/workout/active.tsx).
 * Muster wie src/data/workouts.ts: client-generierte UUIDs (newId), Epoch-ms
 * (Date.now()), Soft-Delete über `deleted`.
 */

async function requireOwnerUserId(): Promise<string> {
  const userId = await getOwnerUserId();
  if (!userId) {
    throw new Error('Kein angemeldeter Nutzer gefunden — Login erforderlich.');
  }
  return userId;
}

/**
 * Körpergewicht ist NICHT wie ein Satz-Gewicht (dort ist 0 kg für
 * Körpergewichts-Übungen zulässig) — ein Körpergewicht von 0 ist unsinnig.
 * Gültig: endlich, > 0, <= 500 kg.
 */
function isValidWeightKg(weightKg: number): boolean {
  return Number.isFinite(weightKg) && weightKg > 0 && weightKg <= 500;
}

/** Erfasst einen Körpergewichts-Eintrag (optional Körperfett-%, optional Messzeitpunkt). */
export async function createBodyMetric(input: {
  weightKg: number;
  bodyFatPercent?: number;
  measuredAt?: number;
}): Promise<void> {
  if (!isValidWeightKg(input.weightKg)) {
    throw new Error('Ungültiges Körpergewicht — muss grösser als 0 und höchstens 500 kg sein.');
  }

  const userId = await requireOwnerUserId();
  const id = newId();
  const now = Date.now();

  await db.insert(bodyMetrics).values({
    id,
    userId,
    measuredAt: input.measuredAt ?? now,
    weightKg: input.weightKg,
    bodyFatPercent: input.bodyFatPercent ?? null,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  });

  queueSyncPush();
}

/** Jüngstes erfasstes Körpergewicht (nicht gelöscht) — Prefill/Placeholder beim Trainingsabschluss. */
export async function getLatestBodyMetricWeight(): Promise<number | null> {
  const rows = await db
    .select({ weightKg: bodyMetrics.weightKg })
    .from(bodyMetrics)
    .where(eq(bodyMetrics.deleted, false))
    .orderBy(desc(bodyMetrics.measuredAt))
    .limit(1);

  return rows[0]?.weightKg ?? null;
}
