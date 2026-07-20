import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { epley1Rm, strengthTrend } from "@ascent/shared";
import { ApiError, api } from "../lib/api";
import { useEntitlement } from "../lib/entitlements";
import { exerciseName } from "../lib/i18n";
import { useSnapshot } from "../lib/snapshot";
import type { WorkoutRow, WorkoutSetRow } from "../lib/snapshot";

/** Feature-Key für die "Erweiterte Statistik"-Karte (siehe apps/api/seed/feature_flags.sql). */
const ADVANCED_STATS_FEATURE = "stats.web.advanced";

/** Literale Hex-Werte für recharts-SVG-Elemente – Tailwind-Klassen wirken dort nicht. */
const CHART_PRIMARY_COLOR = "#B4FF39";
const CHART_TREND_COLOR = "#93DB00";
const CHART_GRID_COLOR = "#2C2C2C";
const CHART_AXIS_COLOR = "#A0A0A0";
const CHART_TOOLTIP_BG = "#1E1E1E";
const CHART_TOOLTIP_BORDER = "#2C2C2C";

/** Montag 00:00 (lokale Zeit) der Woche, in der `date` liegt. */
function startOfWeek(date: Date): number {
  const day = date.getDay(); // 0=So,1=Mo,...6=Sa
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - diffToMonday);
  return monday.getTime();
}

function isFinished(workout: WorkoutRow): boolean {
  return workout.finishedAt != null;
}

function formatNumber(value: number): string {
  return value.toLocaleString("de-CH");
}

function formatDate(value: number): string {
  return new Date(value).toLocaleDateString("de-CH");
}

function formatTooltipValue(value: number | string | ReadonlyArray<number | string> | undefined): string {
  if (typeof value === "number") {
    return value.toFixed(1);
  }
  return String(value ?? "");
}

interface ExerciseOption {
  id: string;
  label: string;
  setCount: number;
}

interface StrengthChartPoint {
  date: number;
  oneRm: number;
  trend?: number;
}

interface RecentWorkoutRow {
  id: string;
  date: number;
  planName: string;
  setCount: number;
  volumeKg: number;
}

export function DashboardPage() {
  const { snapshot, loading, error, reload } = useSnapshot();
  const hasAdvancedStats = useEntitlement(ADVANCED_STATS_FEATURE);

  const [selectedExerciseIdOverride, setSelectedExerciseIdOverride] = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState("");
  const [dateInput, setDateInput] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Übungen mit mindestens einem Satz in einem abgeschlossenen Workout, alphabetisch sortiert.
  const exerciseOptions = useMemo<ExerciseOption[]>(() => {
    const completedWorkoutIds = new Set(snapshot.workouts.filter(isFinished).map((w) => w.id));
    const setCounts = new Map<string, number>();
    for (const set of snapshot.workoutSets) {
      if (!completedWorkoutIds.has(set.workoutId)) continue;
      setCounts.set(set.exerciseId, (setCounts.get(set.exerciseId) ?? 0) + 1);
    }
    const exercisesById = new Map(snapshot.exercises.map((exercise) => [exercise.id, exercise]));
    const options: ExerciseOption[] = [];
    for (const [exerciseId, setCount] of setCounts.entries()) {
      const exercise = exercisesById.get(exerciseId);
      const label = exercise ? exerciseName(exercise) : exerciseId;
      options.push({ id: exerciseId, label, setCount });
    }
    options.sort((a, b) => a.label.localeCompare(b.label, "de-CH"));
    return options;
  }, [snapshot.workouts, snapshot.workoutSets, snapshot.exercises]);

  // Vorauswahl: die Übung mit den meisten Sätzen.
  const defaultExerciseId = useMemo<string | null>(() => {
    let bestId: string | null = null;
    let bestCount = -1;
    for (const option of exerciseOptions) {
      if (option.setCount > bestCount) {
        bestCount = option.setCount;
        bestId = option.id;
      }
    }
    return bestId;
  }, [exerciseOptions]);

  const selectedExerciseId = selectedExerciseIdOverride ?? defaultExerciseId;

  const strength = useMemo<{ chartData: StrengthChartPoint[]; hasTrend: boolean }>(() => {
    if (!selectedExerciseId) {
      return { chartData: [], hasTrend: false };
    }

    const setsByWorkout = new Map<string, WorkoutSetRow[]>();
    for (const set of snapshot.workoutSets) {
      if (set.exerciseId !== selectedExerciseId) continue;
      const list = setsByWorkout.get(set.workoutId);
      if (list) {
        list.push(set);
      } else {
        setsByWorkout.set(set.workoutId, [set]);
      }
    }

    const sessions: { date: number; best1Rm: number }[] = [];
    for (const workout of snapshot.workouts) {
      if (!isFinished(workout)) continue;
      const sets = setsByWorkout.get(workout.id);
      if (!sets || sets.length === 0) continue;
      let best1Rm = 0;
      for (const set of sets) {
        const oneRm = epley1Rm(set.weightKg, set.reps);
        if (oneRm > best1Rm) best1Rm = oneRm;
      }
      sessions.push({ date: workout.startedAt, best1Rm });
    }
    sessions.sort((a, b) => a.date - b.date);

    const trend = strengthTrend(sessions, 3);
    const chartData: StrengthChartPoint[] = sessions.map((session) => ({
      date: session.date,
      oneRm: session.best1Rm,
      trend: trend ? trend.predict(session.date) : undefined,
    }));

    return { chartData, hasTrend: trend !== null };
  }, [selectedExerciseId, snapshot.workouts, snapshot.workoutSets]);

  const bodyMetricsChartData = useMemo(
    () =>
      [...snapshot.bodyMetrics]
        .sort((a, b) => a.measuredAt - b.measuredAt)
        .map((metric) => ({ date: metric.measuredAt, weightKg: metric.weightKg })),
    [snapshot.bodyMetrics],
  );

  const stats = useMemo(() => {
    const weekStartMs = startOfWeek(new Date());
    const completedWorkouts = snapshot.workouts.filter(isFinished);
    const workoutsThisWeek = completedWorkouts.filter((w) => w.startedAt >= weekStartMs);
    const workoutIdsThisWeek = new Set(workoutsThisWeek.map((w) => w.id));

    let volumeThisWeek = 0;
    for (const set of snapshot.workoutSets) {
      if (workoutIdsThisWeek.has(set.workoutId)) {
        volumeThisWeek += set.weightKg * set.reps;
      }
    }

    return {
      workoutsThisWeekCount: workoutsThisWeek.length,
      volumeThisWeek,
      totalWorkoutsCount: completedWorkouts.length,
    };
  }, [snapshot.workouts, snapshot.workoutSets]);

  const recentWorkouts = useMemo<RecentWorkoutRow[]>(() => {
    const plansById = new Map(snapshot.plans.map((plan) => [plan.id, plan]));
    const setsByWorkout = new Map<string, WorkoutSetRow[]>();
    for (const set of snapshot.workoutSets) {
      const list = setsByWorkout.get(set.workoutId);
      if (list) {
        list.push(set);
      } else {
        setsByWorkout.set(set.workoutId, [set]);
      }
    }

    return snapshot.workouts
      .filter(isFinished)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 5)
      .map((workout) => {
        const sets = setsByWorkout.get(workout.id) ?? [];
        const volumeKg = sets.reduce((sum, set) => sum + set.weightKg * set.reps, 0);
        const planName = (workout.planId ? plansById.get(workout.planId)?.name : undefined) ?? "Frei";
        return {
          id: workout.id,
          date: workout.startedAt,
          planName,
          setCount: sets.length,
          volumeKg,
        };
      });
  }, [snapshot.workouts, snapshot.workoutSets, snapshot.plans]);

  async function handleSubmitWeight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    const weightKg = Number.parseFloat(weightInput);
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      setSubmitError("Bitte ein gültiges Gewicht eingeben.");
      return;
    }
    const measuredAt = new Date(dateInput).getTime();
    if (!Number.isFinite(measuredAt)) {
      setSubmitError("Bitte ein gültiges Datum eingeben.");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/body-metrics", { measuredAt, weightKg });
      setWeightInput("");
      await reload();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Gewicht konnte nicht gespeichert werden.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-extrabold text-on-surface">Dashboard</h1>

      {loading && <p className="text-sm text-on-surface-muted">Daten werden geladen…</p>}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}

      {!loading && !error && (
        <>
          {/* Stat-Kacheln */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-lg border border-surface-container-high bg-surface-container p-6">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                Trainings diese Woche
              </h2>
              <p className="mt-4 text-4xl font-extrabold tabular-nums text-primary">
                {formatNumber(stats.workoutsThisWeekCount)}
              </p>
            </div>
            <div className="rounded-lg border border-surface-container-high bg-surface-container p-6">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                Gesamtvolumen diese Woche
              </h2>
              <p className="mt-4 text-4xl font-extrabold tabular-nums text-primary">
                {formatNumber(Math.round(stats.volumeThisWeek))} kg
              </p>
            </div>
            <div className="rounded-lg border border-surface-container-high bg-surface-container p-6">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                Anzahl Trainings gesamt
              </h2>
              <p className="mt-4 text-4xl font-extrabold tabular-nums text-primary">
                {formatNumber(stats.totalWorkoutsCount)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Kraftverlauf */}
            <div className="rounded-lg border border-surface-container-high bg-surface-container p-6 lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                  Kraftverlauf
                </h2>
                {exerciseOptions.length > 0 && (
                  <select
                    value={selectedExerciseId ?? ""}
                    onChange={(event) => setSelectedExerciseIdOverride(event.target.value)}
                    className="h-10 rounded-md border border-outline bg-surface px-3 text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {exerciseOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {exerciseOptions.length === 0 ? (
                <p className="mt-6 text-sm text-on-surface-muted">
                  Noch keine abgeschlossenen Trainings mit erfassten Sätzen vorhanden. Sobald du dein erstes
                  Training abschliesst, erscheint hier dein Kraftverlauf.
                </p>
              ) : (
                <>
                  <div className="mt-6 h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={strength.chartData}>
                        <CartesianGrid stroke={CHART_GRID_COLOR} horizontal vertical={false} />
                        <XAxis
                          dataKey="date"
                          type="number"
                          domain={["dataMin", "dataMax"]}
                          tickFormatter={(value: number) => formatDate(value)}
                          stroke={CHART_AXIS_COLOR}
                          tick={{ fill: CHART_AXIS_COLOR, fontSize: 12 }}
                        />
                        <YAxis
                          stroke={CHART_AXIS_COLOR}
                          tick={{ fill: CHART_AXIS_COLOR, fontSize: 12 }}
                          label={{
                            value: "kg (1RM geschätzt)",
                            angle: -90,
                            position: "insideLeft",
                            fill: CHART_AXIS_COLOR,
                          }}
                        />
                        <Tooltip
                          contentStyle={{ background: CHART_TOOLTIP_BG, border: `1px solid ${CHART_TOOLTIP_BORDER}` }}
                          labelFormatter={(label) => formatDate(Number(label))}
                          formatter={(value) => formatTooltipValue(value)}
                        />
                        <Line
                          type="monotone"
                          dataKey="oneRm"
                          name="1RM"
                          stroke={CHART_PRIMARY_COLOR}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                        {strength.hasTrend && (
                          <Line
                            type="monotone"
                            dataKey="trend"
                            name="Trend"
                            stroke={CHART_TREND_COLOR}
                            strokeWidth={2}
                            strokeDasharray="6 4"
                            dot={false}
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  {!strength.hasTrend && (
                    <p className="mt-3 text-xs text-on-surface-muted">Trend ab 3 Trainings</p>
                  )}
                </>
              )}
            </div>

            {/* Erweiterte Statistik (Teaser) */}
            <div className="rounded-lg border border-surface-container-high bg-surface-container p-6">
              <div className="flex items-center gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                  Erweiterte Statistik
                </h2>
                {!hasAdvancedStats && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-on-primary">
                    Pro
                  </span>
                )}
              </div>

              {hasAdvancedStats ? (
                <p className="mt-4 text-sm text-on-surface-muted">
                  Erweiterte Statistik ist freigeschaltet.
                </p>
              ) : (
                <div className="relative mt-4 overflow-hidden rounded-md">
                  <div className="pointer-events-none flex select-none flex-col gap-2 opacity-30 blur-[2px]" aria-hidden="true">
                    <div className="h-3 w-2/3 rounded bg-surface-container-high" />
                    <div className="h-24 w-full rounded bg-surface-container-high" />
                    <div className="h-3 w-1/2 rounded bg-surface-container-high" />
                  </div>
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                    <p className="text-sm text-on-surface">
                      Tiefere Einblicke in deine Progression – nur mit Ascent Pro.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Körpergewicht */}
            <div className="rounded-lg border border-surface-container-high bg-surface-container p-6">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                Körpergewicht
              </h2>

              {bodyMetricsChartData.length === 0 ? (
                <p className="mt-6 text-sm text-on-surface-muted">
                  Noch keine Körpergewicht-Einträge vorhanden.
                </p>
              ) : (
                <div className="mt-6 h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={bodyMetricsChartData}>
                      <CartesianGrid stroke={CHART_GRID_COLOR} horizontal vertical={false} />
                      <XAxis
                        dataKey="date"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(value: number) => formatDate(value)}
                        stroke={CHART_AXIS_COLOR}
                        tick={{ fill: CHART_AXIS_COLOR, fontSize: 12 }}
                      />
                      <YAxis
                        stroke={CHART_AXIS_COLOR}
                        tick={{ fill: CHART_AXIS_COLOR, fontSize: 12 }}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip
                        contentStyle={{ background: CHART_TOOLTIP_BG, border: `1px solid ${CHART_TOOLTIP_BORDER}` }}
                        labelFormatter={(label) => formatDate(Number(label))}
                        formatter={(value) => `${formatTooltipValue(value)} kg`}
                      />
                      <Line
                        type="monotone"
                        dataKey="weightKg"
                        name="Gewicht"
                        stroke={CHART_PRIMARY_COLOR}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <form
                onSubmit={(event) => void handleSubmitWeight(event)}
                className="mt-6 flex flex-wrap items-end gap-4"
              >
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="weightKg"
                    className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                  >
                    Gewicht (kg)
                  </label>
                  <input
                    id="weightKg"
                    type="number"
                    step="0.1"
                    min="0"
                    required
                    value={weightInput}
                    onChange={(event) => setWeightInput(event.target.value)}
                    className="h-12 w-28 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="measuredAt"
                    className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                  >
                    Datum
                  </label>
                  <input
                    id="measuredAt"
                    type="date"
                    required
                    value={dateInput}
                    onChange={(event) => setDateInput(event.target.value)}
                    className="h-12 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-12 rounded-md bg-primary px-6 font-bold uppercase tracking-wide text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Wird gespeichert…" : "Gewicht erfassen"}
                </button>
              </form>
              {submitError && (
                <p role="alert" className="mt-3 text-sm text-error">
                  {submitError}
                </p>
              )}
            </div>

            {/* Letzte Trainings */}
            <div className="rounded-lg border border-surface-container-high bg-surface-container p-6">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                Letzte Trainings
              </h2>

              {recentWorkouts.length === 0 ? (
                <p className="mt-4 text-sm text-on-surface-muted">Noch keine abgeschlossenen Trainings.</p>
              ) : (
                <ul className="mt-4 flex flex-col divide-y divide-surface-container-high">
                  {recentWorkouts.map((workout) => (
                    <li key={workout.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                      <div className="flex flex-col">
                        <span className="font-semibold text-on-surface">{formatDate(workout.date)}</span>
                        <span className="text-on-surface-muted">{workout.planName}</span>
                      </div>
                      <div className="flex flex-col items-end tabular-nums">
                        <span className="text-on-surface">{workout.setCount} Sätze</span>
                        <span className="text-on-surface-muted">
                          {formatNumber(Math.round(workout.volumeKg))} kg
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <Link to="/verlauf" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
                Zum Verlauf →
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
