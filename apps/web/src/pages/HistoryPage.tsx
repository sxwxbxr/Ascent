import { Fragment, useMemo, useState } from "react";
import type { ExerciseRow, WorkoutSetRow } from "../lib/snapshot";
import { useSnapshot } from "../lib/snapshot";
import { epley1Rm } from "@ascent/shared";
import { exerciseName } from "../lib/i18n";

interface HistoryRow {
  workoutId: string;
  startedAt: number;
  sortKey: number;
  planName: string;
  exerciseCount: number;
  setCount: number;
  volumeKg: number;
  sets: WorkoutSetRow[];
}

interface ExerciseGroup {
  exerciseId: string;
  exerciseName: string;
  sets: WorkoutSetRow[];
  bestSetId: string | null;
}

function formatDateTime(epochMs: number): string {
  const date = new Date(epochMs);
  const dateText = date.toLocaleDateString("de-CH");
  const timeText = date.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
  return `${dateText} ${timeText}`;
}

function displayName(exercise: ExerciseRow | undefined): string {
  if (!exercise) {
    return "Unbekannte Übung";
  }
  return exerciseName(exercise);
}

function groupSetsByExercise(
  sets: WorkoutSetRow[],
  exercisesById: Map<string, ExerciseRow>,
): ExerciseGroup[] {
  const setsByExercise = new Map<string, WorkoutSetRow[]>();
  for (const set of sets) {
    const existing = setsByExercise.get(set.exerciseId);
    if (existing) {
      existing.push(set);
    } else {
      setsByExercise.set(set.exerciseId, [set]);
    }
  }

  return Array.from(setsByExercise.entries()).map(([exerciseId, exerciseSets]) => {
    const sortedSets = [...exerciseSets].sort((a, b) => a.setNumber - b.setNumber);

    let bestSetId: string | null = null;
    let best1Rm = -Infinity;
    for (const set of sortedSets) {
      const estimated1Rm = epley1Rm(set.weightKg, set.reps);
      if (estimated1Rm > best1Rm) {
        best1Rm = estimated1Rm;
        bestSetId = set.id;
      }
    }

    return {
      exerciseId,
      exerciseName: displayName(exercisesById.get(exerciseId)),
      sets: sortedSets,
      bestSetId,
    };
  });
}

export function HistoryPage() {
  const { snapshot, loading, error } = useSnapshot();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const plansById = useMemo(
    () => new Map(snapshot.plans.map((plan) => [plan.id, plan])),
    [snapshot.plans],
  );

  const exercisesById = useMemo(
    () => new Map(snapshot.exercises.map((exercise) => [exercise.id, exercise])),
    [snapshot.exercises],
  );

  const rows = useMemo<HistoryRow[]>(() => {
    const finishedWorkouts = snapshot.workouts.filter(
      (workout) => workout.finishedAt !== null && workout.finishedAt !== undefined,
    );

    const builtRows = finishedWorkouts.map((workout) => {
      const sets = snapshot.workoutSets.filter((set) => set.workoutId === workout.id);
      const exerciseIds = new Set(sets.map((set) => set.exerciseId));
      const volumeKg = sets.reduce((sum, set) => sum + set.weightKg * set.reps, 0);
      const plan = workout.planId ? plansById.get(workout.planId) : undefined;

      const row: HistoryRow = {
        workoutId: workout.id,
        startedAt: workout.startedAt,
        sortKey: workout.finishedAt ?? workout.startedAt,
        planName: plan?.name ?? "Frei",
        exerciseCount: exerciseIds.size,
        setCount: sets.length,
        volumeKg,
        sets,
      };
      return row;
    });

    return builtRows.sort((a, b) => b.sortKey - a.sortKey);
  }, [snapshot.workouts, snapshot.workoutSets, plansById]);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-3xl font-extrabold text-on-surface">Verlauf</h1>
        <p className="text-on-surface-muted">Verlauf wird geladen…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-3xl font-extrabold text-on-surface">Verlauf</h1>
        <p className="text-error">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-extrabold text-on-surface">Verlauf</h1>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-surface-container-high bg-surface-container p-8 text-center">
          <p className="text-on-surface-muted">
            Noch keine abgeschlossenen Trainingseinheiten vorhanden. Sobald du ein
            Training abschliesst, erscheint es hier.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-surface-container-high bg-surface-container">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-surface-container-high text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                <th scope="col" className="px-4 py-3">
                  Datum
                </th>
                <th scope="col" className="px-4 py-3">
                  Plan
                </th>
                <th scope="col" className="px-4 py-3">
                  Übungen
                </th>
                <th scope="col" className="px-4 py-3">
                  Sätze
                </th>
                <th scope="col" className="px-4 py-3">
                  Volumen (kg)
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isExpanded = expandedId === row.workoutId;
                const exerciseGroups = isExpanded
                  ? groupSetsByExercise(row.sets, exercisesById)
                  : [];

                return (
                  <Fragment key={row.workoutId}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : row.workoutId)}
                      aria-expanded={isExpanded}
                      className="cursor-pointer border-b border-surface-container-high transition-colors last:border-b-0 hover:bg-surface-container-high/60"
                    >
                      <td className="px-4 py-3 text-on-surface">
                        {formatDateTime(row.startedAt)}
                      </td>
                      <td className="px-4 py-3 text-on-surface">{row.planName}</td>
                      <td className="px-4 py-3 tabular-nums text-on-surface">
                        {row.exerciseCount}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-on-surface">
                        {row.setCount}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-on-surface">
                        {row.volumeKg.toLocaleString("de-CH")}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-surface-container-high bg-surface last:border-b-0">
                        <td colSpan={5} className="px-4 py-4">
                          <div className="flex flex-col gap-4">
                            {exerciseGroups.map((group) => (
                              <div key={group.exerciseId}>
                                <h3 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                                  {group.exerciseName}
                                </h3>
                                <ul className="mt-2 flex flex-wrap gap-2">
                                  {group.sets.map((set) => {
                                    const isBest = set.id === group.bestSetId;
                                    return (
                                      <li
                                        key={set.id}
                                        className={`rounded-md border px-3 py-1.5 tabular-nums ${
                                          isBest
                                            ? "border-primary text-primary"
                                            : "border-outline text-on-surface"
                                        }`}
                                      >
                                        {set.weightKg.toLocaleString("de-CH")} kg ×{" "}
                                        {set.reps}
                                        {isBest && (
                                          <span className="ml-1 text-xs">
                                            · 1RM ≈{" "}
                                            {Math.round(
                                              epley1Rm(set.weightKg, set.reps),
                                            ).toLocaleString("de-CH")}{" "}
                                            kg
                                          </span>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
