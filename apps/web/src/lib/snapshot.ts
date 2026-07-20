import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SyncPullResult, SyncRow, SyncTableName } from "@ascent/shared";
import { SYNC_TABLES } from "@ascent/shared";
import { api, ApiError } from "./api";
import { useVisiblePolling } from "./live-sync";

/**
 * Zeilentypen je Sync-Tabelle, direkt aus dem geteilten Sync-Vertrag
 * (packages/shared/src/sync.ts) abgeleitet – das ist exakt die Form, die
 * `POST /sync/pull` liefert (siehe apps/api/src/routes/sync.ts).
 */
export type ExerciseRow = SyncRow<"exercises">;
export type PlanRow = SyncRow<"plans">;
export type PlanExerciseRow = SyncRow<"plan_exercises">;
export type WorkoutRow = SyncRow<"workouts">;
export type WorkoutSetRow = SyncRow<"workout_sets">;
export type BodyMetricRow = SyncRow<"body_metrics">;

/** Der komplette, bereits um `deleted`-Zeilen bereinigte Nutzer-Datenbestand. */
export interface Snapshot {
  exercises: ExerciseRow[];
  plans: PlanRow[];
  planExercises: PlanExerciseRow[];
  workouts: WorkoutRow[];
  workoutSets: WorkoutSetRow[];
  bodyMetrics: BodyMetricRow[];
}

const EMPTY_SNAPSHOT: Snapshot = {
  exercises: [],
  plans: [],
  planExercises: [],
  workouts: [],
  workoutSets: [],
  bodyMetrics: [],
};

export interface SnapshotContextValue {
  snapshot: Snapshot;
  /** true während des initialen Ladens ODER eines expliziten reload(). */
  loading: boolean;
  error: string | null;
  /** Nach Schreiboperationen (POST/PUT/DELETE) aufrufen, um den Snapshot neu zu laden. */
  reload: () => Promise<void>;
}

const SnapshotContext = createContext<SnapshotContextValue | null>(null);

function withoutDeleted<T extends { deleted: boolean }>(rows: T[]): T[] {
  return rows.filter((row) => !row.deleted);
}

function toSnapshot(result: SyncPullResult): Snapshot {
  return {
    exercises: withoutDeleted(result.tables.exercises),
    plans: withoutDeleted(result.tables.plans),
    planExercises: withoutDeleted(result.tables.plan_exercises),
    workouts: withoutDeleted(result.tables.workouts),
    workoutSets: withoutDeleted(result.tables.workout_sets),
    bodyMetrics: withoutDeleted(result.tables.body_metrics),
  };
}

/** Cursor je Sync-Tabelle für `POST /sync/pull { since }` – siehe packages/shared/src/sync.ts. */
type Cursor = Record<SyncTableName, number>;

/** Setzt denselben `serverTime`-Wert als Cursor für ALLE Sync-Tabellen (Vorgabe Punkt 1). */
function cursorFromServerTime(serverTime: number): Cursor {
  const cursor = {} as Cursor;
  for (const table of SYNC_TABLES) {
    cursor[table] = serverTime;
  }
  return cursor;
}

/**
 * Merged ein Delta (neue/geänderte Zeilen einer Tabelle) per Id in den
 * bestehenden Bestand: vorhandene Ids werden ersetzt, neue angehängt, als
 * `deleted` markierte Zeilen entfernt (Konsistenz mit `withoutDeleted` beim
 * Voll-Pull). Liefert die UNVERÄNDERTE `existing`-Referenz zurück, wenn das
 * Delta leer ist – damit Konsumenten (z. B. Charts), die auf Referenz-
 * Gleichheit memoisieren, bei ruhigen Tabellen nicht neu rendern.
 */
function mergeRows<T extends { id: string; deleted: boolean }>(existing: T[], delta: T[]): T[] {
  if (delta.length === 0) {
    return existing;
  }
  const byId = new Map(existing.map((row) => [row.id, row] as const));
  for (const row of delta) {
    if (row.deleted) {
      byId.delete(row.id);
    } else {
      byId.set(row.id, row);
    }
  }
  return Array.from(byId.values());
}

/**
 * Merged einen Delta-Pull in den bestehenden Snapshot. Gibt `null` zurück,
 * wenn KEINE der sechs Tabellen tatsächlich Zeilen im Delta hatte – der
 * Aufrufer lässt den State dann unangetastet (keine unnötigen Re-Renders
 * sämtlicher Dashboard-Charts bei einem "leeren" Poll).
 */
function mergeSnapshot(previous: Snapshot, delta: SyncPullResult): Snapshot | null {
  const exercises = mergeRows(previous.exercises, delta.tables.exercises);
  const plans = mergeRows(previous.plans, delta.tables.plans);
  const planExercises = mergeRows(previous.planExercises, delta.tables.plan_exercises);
  const workouts = mergeRows(previous.workouts, delta.tables.workouts);
  const workoutSets = mergeRows(previous.workoutSets, delta.tables.workout_sets);
  const bodyMetrics = mergeRows(previous.bodyMetrics, delta.tables.body_metrics);

  const unchanged =
    exercises === previous.exercises &&
    plans === previous.plans &&
    planExercises === previous.planExercises &&
    workouts === previous.workouts &&
    workoutSets === previous.workoutSets &&
    bodyMetrics === previous.bodyMetrics;

  if (unchanged) {
    return null;
  }

  return { exercises, plans, planExercises, workouts, workoutSets, bodyMetrics };
}

/** Delta-Poll-Intervall: alle 10s, nur solange der Tab sichtbar ist. */
const LIVE_POLL_INTERVAL_MS = 10_000;
/** Debounce zwischen zwei tatsächlichen Polls (Intervall, visibilitychange, focus). */
const LIVE_POLL_MIN_GAP_MS = 2_000;

/**
 * Lädt EINMAL pro App-Session (Mount) den kompletten Nutzer-Datenbestand via
 * `POST /sync/pull { since: {} }` – das ist laut Architekturvorgabe die
 * alleinige Datenquelle für sämtliche Statistik-Berechnungen im Dashboard.
 * Wird innerhalb von <Layout> gemountet, NACHDEM die Session geprüft wurde
 * (siehe components/Layout.tsx), damit der Pull nie anonym feuert.
 *
 * Danach hält ein Delta-Poll (siehe live-sync.ts) den Snapshot "live": die
 * Mobile-App pusht nach jeder Änderung automatisch (queueSyncPush, ~4s
 * Verzögerung) – das Dashboard soll das ohne F5 übernehmen. Der Voll-Pull
 * liefert `serverTime`, der ab dann als Cursor für alle Sync-Tabellen dient;
 * jeder weitere Poll fragt nur noch Zeilen NACH diesem Cursor ab und merged
 * sie per Id in den bestehenden Bestand (siehe mergeSnapshot oben).
 */
export function SnapshotProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Cursor für das Delta-Polling; `null` bis der erste Voll-Pull einen
  // `serverTime` geliefert hat (kein Ref-State nötig – wird nie gerendert).
  const cursorRef = useRef<Cursor | null>(null);
  // Live-Polling läuft standardmässig; wird bei 401 (Session weg) gestoppt.
  const [liveEnabled, setLiveEnabled] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.post<SyncPullResult>("/sync/pull", { since: {} });
      setSnapshot(toSnapshot(result));
      cursorRef.current = cursorFromServerTime(result.serverTime);
      // Ein erfolgreicher Voll-Pull heisst: Session ist gültig – falls das
      // Live-Polling zuvor wegen 401 gestoppt wurde, darf es wieder laufen.
      setLiveEnabled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Daten konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // reload ist stabil (useCallback ohne Abhängigkeiten) – soll nur beim Mount laufen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollDelta = useCallback(async () => {
    const since = cursorRef.current;
    // Noch kein Voll-Pull durchgelaufen (Race mit dem initialen reload()) – nichts zu tun.
    if (!since) {
      return;
    }
    try {
      const result = await api.post<SyncPullResult>("/sync/pull", { since });
      cursorRef.current = cursorFromServerTime(result.serverTime);
      setSnapshot((previous) => mergeSnapshot(previous, result) ?? previous);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Session weg – das Auth-Gate übernimmt; weiteres Polling wäre sinnlos.
        setLiveEnabled(false);
        return;
      }
      // Offline / Netzwerkfehler etc.: still tolerieren, der nächste Poll versucht's erneut.
    }
  }, []);

  useVisiblePolling(pollDelta, {
    intervalMs: LIVE_POLL_INTERVAL_MS,
    minGapMs: LIVE_POLL_MIN_GAP_MS,
    enabled: liveEnabled,
  });

  const value = useMemo<SnapshotContextValue>(
    () => ({ snapshot, loading, error, reload }),
    [snapshot, loading, error, reload],
  );

  // createElement statt JSX: die Datei bleibt bewusst `.ts` (kein `.tsx`),
  // JSX-Syntax würde vom TS-Compiler in `.ts`-Dateien nicht geparst.
  return createElement(SnapshotContext.Provider, { value }, children);
}

export function useSnapshot(): SnapshotContextValue {
  const context = useContext(SnapshotContext);
  if (!context) {
    throw new Error("useSnapshot() muss innerhalb von <SnapshotProvider> aufgerufen werden.");
  }
  return context;
}
