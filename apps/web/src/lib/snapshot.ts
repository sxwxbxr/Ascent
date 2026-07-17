import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SyncPullResult, SyncRow } from "@ascent/shared";
import { api } from "./api";

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

/**
 * Lädt EINMAL pro App-Session (Mount) den kompletten Nutzer-Datenbestand via
 * `POST /sync/pull { since: {} }` – das ist laut Architekturvorgabe die
 * alleinige Datenquelle für sämtliche Statistik-Berechnungen im Dashboard.
 * Wird innerhalb von <Layout> gemountet, NACHDEM die Session geprüft wurde
 * (siehe components/Layout.tsx), damit der Pull nie anonym feuert.
 */
export function SnapshotProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.post<SyncPullResult>("/sync/pull", { since: {} });
      setSnapshot(toSnapshot(result));
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
