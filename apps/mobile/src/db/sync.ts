import { useSyncExternalStore } from 'react';
import { and, eq, gt } from 'drizzle-orm';
import * as SecureStore from 'expo-secure-store';
import {
  bodyMetrics,
  exercises,
  planExercises,
  plans,
  workoutSets,
  workouts,
  MAX_SYNC_ROWS_PER_TABLE,
  SYNC_TABLES,
} from '@ascent/shared';
import type { SyncPullResult, SyncPushRequest, SyncPushResult, SyncRow, SyncTableName } from '@ascent/shared';

import { API_URL } from '../config';
import { authClient } from '../auth/client';
import { db } from './client';
import { getOwnerUserId } from '../lib/owner';

/**
 * Offline-Sync-Client (M4, Technisches Konzept Abschnitt 4): spiegelt die
 * Push-/Pull-Semantik von apps/api/src/routes/sync.ts. Ersetzt die frühere,
 * exercises-only `hydrateExercises` (vormals hier in db/hydrate.ts) durch
 * einen generischen Lauf über ALLE SYNC_TABLES (packages/shared/src/sync.ts),
 * erst Push dann Pull, mit eigenen Cursorn pro Richtung UND pro Tabelle.
 * `upsertLocalUser` bleibt bewusst in db/hydrate.ts (Login-Spiegelung, kein
 * Sync-Tabellen-Datensatz).
 */

// ---------------------------------------------------------------------------
// Cursor-Persistenz (SecureStore) — je Richtung ein JSON Record<Tabelle, ms>.
// ---------------------------------------------------------------------------

const PUSH_CURSORS_KEY = 'ascent.sync.push.cursors';
const PULL_CURSORS_KEY = 'ascent.sync.pull.cursors';
const LAST_SYNC_AT_KEY = 'ascent.sync.lastSyncAt';

/** Alter Einzel-Cursor aus der Vor-M4-`hydrateExercises` (nur exercises, nur Pull). */
const LEGACY_EXERCISES_PULL_CURSOR_KEY = 'ascent.sync.exercises.since';

type SyncCursors = Partial<Record<SyncTableName, number>>;

function readCursors(key: string): SyncCursors {
  const raw = SecureStore.getItem(key);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as SyncCursors;
    }
  } catch (err) {
    console.log(`[sync] Cursor "${key}" konnte nicht gelesen werden (wird zurückgesetzt):`, err);
  }
  return {};
}

function writeCursors(key: string, cursors: SyncCursors): void {
  SecureStore.setItem(key, JSON.stringify(cursors));
}

/**
 * Einmalige Migration: existiert der alte, exercises-only Pull-Cursor aus der
 * Vor-M4-`hydrateExercises` noch, wird sein Wert (falls noch kein neuer
 * Pull-Cursor für exercises gesetzt ist) übernommen und der alte Schlüssel
 * gelöscht. Idempotent — ab dem ersten erfolgreichen Lauf ist der alte
 * Schlüssel weg und die Funktion ein No-Op.
 */
async function migrateLegacyExercisesCursor(pullCursors: SyncCursors): Promise<SyncCursors> {
  const legacyRaw = SecureStore.getItem(LEGACY_EXERCISES_PULL_CURSOR_KEY);
  if (legacyRaw === null) return pullCursors;

  const legacyMs = Number(legacyRaw);
  const migrated: SyncCursors =
    pullCursors.exercises === undefined && Number.isFinite(legacyMs)
      ? { ...pullCursors, exercises: legacyMs }
      : pullCursors;

  try {
    await SecureStore.deleteItemAsync(LEGACY_EXERCISES_PULL_CURSOR_KEY);
  } catch (err) {
    console.log('[sync] Alter Cursor-Schlüssel konnte nicht gelöscht werden:', err);
  }

  return migrated;
}

// ---------------------------------------------------------------------------
// Sync-Status (für die UI, siehe app/(tabs)/profil.tsx) — Modul-Store mit
// Subscribe-Pattern, analog zu src/lib/active-workout.ts (Modul-Cache statt
// Context/Redux, weil es hier nur einen einzigen globalen Status gibt).
// ---------------------------------------------------------------------------

export type SyncStatus = {
  isSyncing: boolean;
  /** Epoch ms des letzten ERFOLGREICHEN Durchlaufs (Push+Pull), SecureStore-persistiert. */
  lastSyncAt: number | null;
  lastError: string | null;
};

function readLastSyncAt(): number | null {
  const raw = SecureStore.getItem(LAST_SYNC_AT_KEY);
  if (!raw) return null;
  const ms = Number(raw);
  return Number.isFinite(ms) ? ms : null;
}

let status: SyncStatus = {
  isSyncing: false,
  lastSyncAt: readLastSyncAt(),
  lastError: null,
};

type SyncStatusListener = (next: SyncStatus) => void;
const listeners = new Set<SyncStatusListener>();

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener(status);
}

function subscribeSyncStatus(listener: SyncStatusListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSyncStatusSnapshot(): SyncStatus {
  return status;
}

/** Reaktiver Sync-Status (Profil-Sektion "Synchronisation"): isSyncing/lastSyncAt/lastError. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatusSnapshot, getSyncStatusSnapshot);
}

// ---------------------------------------------------------------------------
// Session-Gate — runSync darf nie ohne (zumindest gecachte) Session laufen.
//
// authClient.$store.atoms.session ist am installierten Client-Typ verifiziert
// (node_modules/better-auth/dist/client/config.d.mts: `$store: { atoms:
// Record<string, WritableAtom<any>> }` ist Teil des öffentlichen AuthClient-
// Typs) und liefert per `.get()` SYNCHRON den zuletzt bekannten Snapshot
// `{ data, error, isPending, ... }` — denselben Atom, den `useSession()` im
// Root-Layout abonniert hat (siehe app/_layout.tsx). `.get()` erfordert keinen
// Netzwerk-Roundtrip; ein expliziter `authClient.getSession()`-Aufruf (Network)
// wäre hier unnötig, weil Push/Pull ohnehin einen echten Request machen und
// serverseitig per Cookie authentifizieren — dieser Check verhindert nur den
// unnötigen Versuch, wenn offensichtlich kein Nutzer angemeldet ist.
// ---------------------------------------------------------------------------

function hasCachedSession(): boolean {
  const sessionAtom = authClient.$store.atoms.session;
  const value = sessionAtom?.get() as { data?: { user?: { id?: string } } | null } | undefined;
  return !!value?.data?.user?.id;
}

// ---------------------------------------------------------------------------
// Push: lokale Änderungen → POST /sync/push, Tabelle für Tabelle in
// SYNC_TABLES-Reihenfolge (Eltern vor Kindern, siehe packages/shared/src/sync.ts).
// ---------------------------------------------------------------------------

/**
 * Lädt + sendet die zu pushenden Zeilen einer Tabelle und pflegt ihren Cursor.
 * Generisch über T, damit jede Tabelle ihre eigene Zeilenform (SyncRow<T>)
 * behält, ohne sechsmal denselben Chargen-/Cursor-/Warn-Code zu wiederholen.
 */
async function pushTable<T extends SyncTableName>(
  table: T,
  cursors: SyncCursors,
  loadRows: (cursor: number) => Promise<SyncRow<T>[]>,
): Promise<void> {
  const cursor = cursors[table] ?? 0;
  const rows = await loadRows(cursor);
  if (rows.length === 0) return; // leere Tabellen weglassen

  let newCursor = cursor;
  for (let i = 0; i < rows.length; i += MAX_SYNC_ROWS_PER_TABLE) {
    const batch = rows.slice(i, i + MAX_SYNC_ROWS_PER_TABLE);

    // Body enthält bewusst nur DIESE eine Tabelle (spec: "pro Tabelle" pushen).
    // Cast nötig: TS kann eine generische Zuordnung `T -> SyncRow<T>[]` nicht
    // gegen die konkrete, pro Schlüssel unterschiedlich typisierte
    // `SyncPushRequest['tables']`-Form auflösen — table/batch sind hier aber
    // per Konstruktion (derselbe T) zueinander konsistent.
    const body = { tables: { [table]: batch } } as unknown as SyncPushRequest;

    const res = await authClient.$fetch<SyncPushResult>(`${API_URL}/sync/push`, {
      method: 'POST',
      body,
    });

    if (res.error || !res.data) {
      throw new Error(`Push ${table} fehlgeschlagen: ${res.error?.message ?? 'unbekannter Fehler'}`);
    }

    const tableResult = res.data.tables[table];
    if (tableResult.rejected > 0) {
      console.warn(
        `[sync] Push ${table}: ${tableResult.rejected} Zeile(n) abgelehnt ` +
          `(applied=${tableResult.applied}, skipped=${tableResult.skipped}, gesendet=${batch.length}).`,
      );
    }

    for (const row of batch) newCursor = Math.max(newCursor, row.updatedAt);
    cursors[table] = newCursor;
    // Nach jeder Charge persistieren: geht ein späterer Chunk/eine spätere
    // Tabelle noch schief, bleibt der bereits bestätigte Fortschritt erhalten.
    writeCursors(PUSH_CURSORS_KEY, cursors);
  }
}

async function pushChanges(ownerUserId: string): Promise<void> {
  const cursors = readCursors(PUSH_CURSORS_KEY);

  // exercises: NUR eigene (userId = ownerUserId) — globale/importierte Übungen
  // werden vom Client nie gepusht (Server würde sie ohnehin als rejected
  // zurückweisen, siehe applyExercise in apps/api/src/routes/sync.ts).
  await pushTable('exercises', cursors, (cursor) =>
    db
      .select()
      .from(exercises)
      .where(and(gt(exercises.updatedAt, cursor), eq(exercises.userId, ownerUserId))),
  );
  await pushTable('plans', cursors, (cursor) => db.select().from(plans).where(gt(plans.updatedAt, cursor)));
  await pushTable('plan_exercises', cursors, (cursor) =>
    db.select().from(planExercises).where(gt(planExercises.updatedAt, cursor)),
  );
  await pushTable('workouts', cursors, (cursor) => db.select().from(workouts).where(gt(workouts.updatedAt, cursor)));
  await pushTable('workout_sets', cursors, (cursor) =>
    db.select().from(workoutSets).where(gt(workoutSets.updatedAt, cursor)),
  );
  await pushTable('body_metrics', cursors, (cursor) =>
    db.select().from(bodyMetrics).where(gt(bodyMetrics.updatedAt, cursor)),
  );
}

// ---------------------------------------------------------------------------
// Pull: POST /sync/pull → Last-Write-Wins-Merge in die lokale DB, Tabelle für
// Tabelle in SYNC_TABLES-Reihenfolge. `ownerUserId` dient nur als Fallback für
// die (laut Zod-Schema optionalen, laut lokalem Schema aber NOT NULL) userId-
// Felder von plans/workouts/body_metrics — der Server liefert hier praktisch
// immer den echten Wert mit (die Pull-Query filtert ohnehin auf `user.id`),
// der Fallback greift nur zur Absicherung des lokalen NOT-NULL-Constraints.
// ---------------------------------------------------------------------------

const PULL_CHUNK_SIZE = 100;

async function applyInChunks<T>(rows: T[], apply: (row: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < rows.length; i += PULL_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + PULL_CHUNK_SIZE);
    for (const row of chunk) {
      await apply(row);
    }
  }
}

/** LWW-Upsert: fehlt die Zeile lokal → insert; existiert sie → nur überschreiben, wenn incoming neuer ist. */
async function upsertExercise(row: SyncRow<'exercises'>): Promise<void> {
  const existing = (
    await db.select({ updatedAt: exercises.updatedAt }).from(exercises).where(eq(exercises.id, row.id)).limit(1)
  )[0];

  const values: typeof exercises.$inferInsert = {
    id: row.id,
    userId: row.userId ?? null,
    name: row.name,
    nameDe: row.nameDe ?? null,
    category: row.category ?? null,
    primaryMuscle: row.primaryMuscle ?? null,
    equipment: row.equipment ?? null,
    instructionsEn: row.instructionsEn ?? null,
    instructionsDe: row.instructionsDe ?? null,
    thumbnailUrl: row.thumbnailUrl ?? null,
    gifUrl: row.gifUrl ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
  };

  if (!existing) {
    await db.insert(exercises).values(values);
  } else if (row.updatedAt > existing.updatedAt) {
    await db.update(exercises).set(values).where(eq(exercises.id, row.id));
  }
}

async function upsertPlan(row: SyncRow<'plans'>, ownerUserId: string): Promise<void> {
  const existing = (await db.select({ updatedAt: plans.updatedAt }).from(plans).where(eq(plans.id, row.id)).limit(1))[0];

  const values: typeof plans.$inferInsert = {
    id: row.id,
    userId: row.userId ?? ownerUserId,
    name: row.name,
    description: row.description ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
  };

  if (!existing) {
    await db.insert(plans).values(values);
  } else if (row.updatedAt > existing.updatedAt) {
    await db.update(plans).set(values).where(eq(plans.id, row.id));
  }
}

async function upsertPlanExercise(row: SyncRow<'plan_exercises'>): Promise<void> {
  const existing = (
    await db
      .select({ updatedAt: planExercises.updatedAt })
      .from(planExercises)
      .where(eq(planExercises.id, row.id))
      .limit(1)
  )[0];

  const values: typeof planExercises.$inferInsert = {
    id: row.id,
    planId: row.planId,
    exerciseId: row.exerciseId,
    position: row.position,
    targetSets: row.targetSets,
    targetRepsMin: row.targetRepsMin ?? null,
    targetRepsMax: row.targetRepsMax ?? null,
    restSeconds: row.restSeconds ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
  };

  if (!existing) {
    await db.insert(planExercises).values(values);
  } else if (row.updatedAt > existing.updatedAt) {
    await db.update(planExercises).set(values).where(eq(planExercises.id, row.id));
  }
}

async function upsertWorkout(row: SyncRow<'workouts'>, ownerUserId: string): Promise<void> {
  const existing = (
    await db.select({ updatedAt: workouts.updatedAt }).from(workouts).where(eq(workouts.id, row.id)).limit(1)
  )[0];

  const values: typeof workouts.$inferInsert = {
    id: row.id,
    userId: row.userId ?? ownerUserId,
    planId: row.planId ?? null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
  };

  if (!existing) {
    await db.insert(workouts).values(values);
  } else if (row.updatedAt > existing.updatedAt) {
    await db.update(workouts).set(values).where(eq(workouts.id, row.id));
  }
}

async function upsertWorkoutSet(row: SyncRow<'workout_sets'>): Promise<void> {
  const existing = (
    await db.select({ updatedAt: workoutSets.updatedAt }).from(workoutSets).where(eq(workoutSets.id, row.id)).limit(1)
  )[0];

  const values: typeof workoutSets.$inferInsert = {
    id: row.id,
    workoutId: row.workoutId,
    exerciseId: row.exerciseId,
    setNumber: row.setNumber,
    weightKg: row.weightKg,
    reps: row.reps,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
  };

  if (!existing) {
    await db.insert(workoutSets).values(values);
  } else if (row.updatedAt > existing.updatedAt) {
    await db.update(workoutSets).set(values).where(eq(workoutSets.id, row.id));
  }
}

async function upsertBodyMetric(row: SyncRow<'body_metrics'>, ownerUserId: string): Promise<void> {
  const existing = (
    await db.select({ updatedAt: bodyMetrics.updatedAt }).from(bodyMetrics).where(eq(bodyMetrics.id, row.id)).limit(1)
  )[0];

  const values: typeof bodyMetrics.$inferInsert = {
    id: row.id,
    userId: row.userId ?? ownerUserId,
    measuredAt: row.measuredAt,
    weightKg: row.weightKg,
    bodyFatPercent: row.bodyFatPercent ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
  };

  if (!existing) {
    await db.insert(bodyMetrics).values(values);
  } else if (row.updatedAt > existing.updatedAt) {
    await db.update(bodyMetrics).set(values).where(eq(bodyMetrics.id, row.id));
  }
}

async function pullChanges(ownerUserId: string): Promise<void> {
  const pullCursors = await migrateLegacyExercisesCursor(readCursors(PULL_CURSORS_KEY));

  const since: SyncCursors = {};
  for (const table of SYNC_TABLES) {
    if (pullCursors[table] !== undefined) since[table] = pullCursors[table];
  }

  const res = await authClient.$fetch<SyncPullResult>(`${API_URL}/sync/pull`, {
    method: 'POST',
    body: { since },
  });

  if (res.error || !res.data) {
    throw new Error(`Pull fehlgeschlagen: ${res.error?.message ?? 'unbekannter Fehler'}`);
  }

  const { serverTime, tables } = res.data;

  // Reihenfolge = SYNC_TABLES: Eltern vor Kindern (Fremdschlüssel).
  await applyInChunks(tables.exercises, (row) => upsertExercise(row));
  await applyInChunks(tables.plans, (row) => upsertPlan(row, ownerUserId));
  await applyInChunks(tables.plan_exercises, (row) => upsertPlanExercise(row));
  await applyInChunks(tables.workouts, (row) => upsertWorkout(row, ownerUserId));
  await applyInChunks(tables.workout_sets, (row) => upsertWorkoutSet(row));
  await applyInChunks(tables.body_metrics, (row) => upsertBodyMetric(row, ownerUserId));

  const newPullCursors: SyncCursors = {};
  for (const table of SYNC_TABLES) newPullCursors[table] = serverTime;
  writeCursors(PULL_CURSORS_KEY, newPullCursors);
}

// ---------------------------------------------------------------------------
// Öffentliche Einstiegspunkte
// ---------------------------------------------------------------------------

/**
 * Führt einen vollständigen Sync-Durchlauf aus (erst Push, dann Pull).
 * Läuft nie parallel (Modul-Flag `status.isSyncing`) und nie ohne zumindest
 * gecachte Session. Wirft NIE — Netzwerk-/Serverfehler werden geloggt und
 * landen in `status.lastError`; der Aufrufer bekommt in jedem Fall ein
 * aufgelöstes Promise (fire-and-forget-tauglich).
 */
export async function runSync(): Promise<void> {
  if (status.isSyncing) return;

  if (!hasCachedSession()) {
    console.log('[sync] runSync ohne (gecachte) Session übersprungen.');
    return;
  }

  setStatus({ isSyncing: true, lastError: null });

  try {
    const ownerUserId = await getOwnerUserId();
    if (!ownerUserId) {
      console.log('[sync] runSync ohne lokalen Nutzer übersprungen (upsertLocalUser lief evtl. noch nicht).');
      return;
    }

    await pushChanges(ownerUserId);
    await pullChanges(ownerUserId);

    const now = Date.now();
    SecureStore.setItem(LAST_SYNC_AT_KEY, String(now));
    setStatus({ lastSyncAt: now });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log('[sync] runSync fehlgeschlagen (offline toleriert):', err);
    setStatus({ lastError: message });
  } finally {
    setStatus({ isSyncing: false });
  }
}

const APP_STATE_THROTTLE_MS = 2 * 60 * 1000;
let lastAppStateSyncAttemptAt = 0;

/**
 * Für den AppState-Listener in app/_layout.tsx: löst runSync() aus, aber
 * höchstens 1×/2 Minuten (verhindert z. B. Sync-Bursts bei schnellem
 * App-Wechsel). Der manuelle Button in profil.tsx nutzt bewusst NICHT diese
 * Funktion, sondern ruft runSync() direkt auf — ein expliziter Nutzertap soll
 * nie gedrosselt werden.
 */
export function runSyncThrottled(): void {
  const now = Date.now();
  if (now - lastAppStateSyncAttemptAt < APP_STATE_THROTTLE_MS) {
    console.log('[sync] AppState-Trigger gedrosselt (< 2 Minuten seit letztem Versuch).');
    return;
  }
  lastAppStateSyncAttemptAt = now;
  runSync().catch((err) => console.log('[sync] runSync (AppState) fehlgeschlagen:', err));
}

let queuedPushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Live-Sync: Nach jeder lokalen Schreiboperation aufrufen (Ende der
 * Mutations-Helpers in src/data/*). Debounced (4 s nach der letzten
 * Änderung), damit Serien-Edits — z. B. mehrere Sätze nacheinander —
 * in EINEM Sync landen. So erscheinen App-Änderungen ohne manuellen
 * Sync innert Sekunden im Web-Dashboard (das seinerseits per
 * Delta-Polling nachzieht).
 */
export function queueSyncPush(delayMs = 4000): void {
  if (queuedPushTimer) clearTimeout(queuedPushTimer);
  queuedPushTimer = setTimeout(() => {
    queuedPushTimer = null;
    runSync().catch((err) => console.log('[sync] runSync (queueSyncPush) fehlgeschlagen:', err));
  }, delayMs);
}
