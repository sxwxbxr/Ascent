import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { epley1Rm } from "@ascent/shared";
import { AddToPlanMenu } from "../components/AddToPlanMenu";
import { capitalizeWords, categoryLabelDe, exerciseName, muscleLabelDe } from "../lib/i18n";
import { useSnapshot } from "../lib/snapshot";
import type { ExerciseRow, WorkoutSetRow } from "../lib/snapshot";

/** Anzahl der zuletzt trainierten Einheiten, die in "Deine Statistik" gezeigt werden. */
const RECENT_SESSION_LIMIT = 5;

/** Parst ein JSON-Array von Strings robust — liefert `[]` bei `null`/Parse-Fehlern/Fremdformat. */
function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("de-CH");
}

interface SessionStat {
  workoutId: string;
  date: number;
  setCount: number;
  bestWeightKg: number;
  bestReps: number;
  estimated1Rm: number;
}

type InstructionsBlock =
  | { kind: "prose"; text: string; isEnglish: boolean }
  | { kind: "steps"; steps: string[]; isEnglish: boolean };

interface ExerciseMediaProps {
  exercise: ExerciseRow;
  name: string;
}

/**
 * Medienkarte: GIF/Standbild (max. 480px, Quelle ist 180×180 mit weissem
 * Hintergrund — daher `bg-white` + `object-contain` statt Skalierung über die
 * native Auflösung hinaus). Klick öffnet die Lightbox (fullscreen, Escape/
 * Backdrop/X schliessen). Eigene Übungen haben nie Medien (siehe
 * apps/mobile/src/data/exercises.ts) — dann nur der Initialen-Platzhalter.
 */
function ExerciseMedia({ exercise, name }: ExerciseMediaProps) {
  const hasGif = Boolean(exercise.gifUrl);
  const hasThumbnail = Boolean(exercise.thumbnailUrl);
  const [showAnimation, setShowAnimation] = useState(hasGif);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Bei Navigation zu einer anderen Übung (gleiche Komponnteninstanz dank
  // Route-Wechsel ohne Remount) auf den Default für die neue Übung zurücksetzen.
  useEffect(() => {
    setShowAnimation(hasGif);
    setLightboxOpen(false);
  }, [exercise.id, hasGif]);

  useEffect(() => {
    if (!lightboxOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setLightboxOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen]);

  const activeSrc = showAnimation && exercise.gifUrl ? exercise.gifUrl : (exercise.thumbnailUrl ?? exercise.gifUrl);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-surface-container-high bg-surface-container p-6">
      {activeSrc ? (
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          aria-label="Bild vergrössern"
          className="mx-auto block aspect-square w-full max-w-[480px] cursor-zoom-in overflow-hidden rounded-lg bg-white"
        >
          <img src={activeSrc} alt={name} className="h-full w-full object-contain" />
        </button>
      ) : (
        <div className="flex aspect-square w-full max-w-[480px] items-center justify-center rounded-lg bg-white">
          <span className="text-5xl font-extrabold text-surface/30">{initial}</span>
        </div>
      )}

      {hasGif && hasThumbnail && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowAnimation(false)}
            className={`h-9 rounded-md border px-4 text-xs font-bold uppercase tracking-widest transition-colors ${
              !showAnimation
                ? "border-primary text-primary"
                : "border-outline text-on-surface-muted hover:text-on-surface"
            }`}
          >
            Standbild
          </button>
          <button
            type="button"
            onClick={() => setShowAnimation(true)}
            className={`h-9 rounded-md border px-4 text-xs font-bold uppercase tracking-widest transition-colors ${
              showAnimation
                ? "border-primary text-primary"
                : "border-outline text-on-surface-muted hover:text-on-surface"
            }`}
          >
            Animation
          </button>
        </div>
      )}

      {lightboxOpen && activeSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            aria-label="Schliessen"
            className="absolute right-6 top-6 flex h-12 w-12 items-center justify-center rounded-full border border-outline text-2xl leading-none text-on-surface transition-colors hover:border-primary hover:text-primary"
          >
            ×
          </button>
          <img
            src={activeSrc}
            alt={name}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[80vmin] max-w-[80vmin] rounded-lg bg-white object-contain"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Übungsdetail (Route `/uebungen/:id`). Datenquelle ausschliesslich der
 * Snapshot: die Übung selbst (inkl. der neuen Felder muscleGroup/
 * secondaryMuscles/instructionStepsEn, bei Bestandsdaten NULL) sowie
 * `workout_sets`/`workouts` für die "Deine Statistik"-Sektion.
 */
export function ExerciseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { snapshot, loading, error } = useSnapshot();

  const exercise = useMemo<ExerciseRow | undefined>(
    () => snapshot.exercises.find((row) => row.id === id),
    [snapshot.exercises, id],
  );

  const sessions = useMemo<SessionStat[]>(() => {
    if (!exercise) return [];

    const setsByWorkout = new Map<string, WorkoutSetRow[]>();
    for (const set of snapshot.workoutSets) {
      if (set.exerciseId !== exercise.id) continue;
      const list = setsByWorkout.get(set.workoutId);
      if (list) {
        list.push(set);
      } else {
        setsByWorkout.set(set.workoutId, [set]);
      }
    }

    const workoutsById = new Map(snapshot.workouts.map((workout) => [workout.id, workout]));

    const rows: SessionStat[] = [];
    for (const [workoutId, sets] of setsByWorkout.entries()) {
      const workout = workoutsById.get(workoutId);
      if (!workout) continue;

      let best: WorkoutSetRow | null = null;
      let bestEstimate = -Infinity;
      for (const set of sets) {
        const estimate = epley1Rm(set.weightKg, set.reps);
        if (estimate > bestEstimate) {
          bestEstimate = estimate;
          best = set;
        }
      }
      if (!best) continue;

      rows.push({
        workoutId,
        date: workout.startedAt,
        setCount: sets.length,
        bestWeightKg: best.weightKg,
        bestReps: best.reps,
        estimated1Rm: bestEstimate,
      });
    }

    return rows.sort((a, b) => b.date - a.date).slice(0, RECENT_SESSION_LIMIT);
  }, [exercise, snapshot.workoutSets, snapshot.workouts]);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <p className="text-on-surface-muted">Übung wird geladen…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-8">
        <p className="text-error">{error}</p>
      </div>
    );
  }

  if (!exercise) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-extrabold text-on-surface">Übung nicht gefunden</h1>
        <p className="text-on-surface-muted">Diese Übung existiert nicht (mehr).</p>
        <Link to="/uebungen" className="font-semibold text-primary hover:underline">
          ← Alle Übungen
        </Link>
      </div>
    );
  }

  const isOwn = exercise.userId != null;
  const name = exerciseName(exercise);
  const secondaryMuscles = parseJsonStringArray(exercise.secondaryMuscles);
  const instructionSteps = parseJsonStringArray(exercise.instructionStepsEn);
  const hasMuscleSection = Boolean(exercise.muscleGroup) || secondaryMuscles.length > 0;

  // Priorität: deutsche Ausführung (falls vorhanden — insb. bei eigenen
  // Übungen) vor nummerierten EN-Schritten vor EN-Fliesstext; sonst keine Sektion.
  let instructionsBlock: InstructionsBlock | null = null;
  if (exercise.instructionsDe) {
    instructionsBlock = { kind: "prose", text: exercise.instructionsDe, isEnglish: false };
  } else if (instructionSteps.length > 0) {
    instructionsBlock = { kind: "steps", steps: instructionSteps, isEnglish: true };
  } else if (exercise.instructionsEn) {
    instructionsBlock = { kind: "prose", text: exercise.instructionsEn, isEnglish: true };
  }

  return (
    <div className="flex flex-col gap-8">
      <Link
        to="/uebungen"
        className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted hover:text-on-surface"
      >
        ← Alle Übungen
      </Link>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <ExerciseMedia exercise={exercise} name={name} />

        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-on-surface">{name}</h1>
              {exercise.nameDe && <p className="mt-1 text-sm text-on-surface-muted">{exercise.name}</p>}
            </div>
            <AddToPlanMenu exerciseId={exercise.id} />
          </div>

          <div className="flex flex-wrap gap-2">
            {isOwn && (
              <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold uppercase tracking-widest text-on-primary">
                Eigene Übung
              </span>
            )}
            {exercise.category && (
              <span className="rounded-full border border-outline px-3 py-1 text-xs font-semibold text-on-surface">
                {categoryLabelDe(exercise.category)}
              </span>
            )}
            {exercise.primaryMuscle && (
              <span className="rounded-full border border-outline px-3 py-1 text-xs font-semibold text-on-surface">
                {muscleLabelDe(exercise.primaryMuscle)}
              </span>
            )}
            {exercise.equipment && (
              <span className="rounded-full border border-outline px-3 py-1 text-xs font-semibold text-on-surface">
                {capitalizeWords(exercise.equipment)}
              </span>
            )}
          </div>

          {hasMuscleSection && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                Beteiligte Muskeln
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {exercise.muscleGroup && (
                  <span className="rounded-md bg-surface-container-high px-3 py-1.5 text-sm text-on-surface">
                    {muscleLabelDe(exercise.muscleGroup)}
                  </span>
                )}
                {secondaryMuscles.map((muscle) => (
                  <span
                    key={muscle}
                    className="rounded-md bg-surface-container-high px-3 py-1.5 text-sm text-on-surface"
                  >
                    {muscleLabelDe(muscle)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {instructionsBlock && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                Ausführung
              </h2>
              <div className="mt-3">
                {instructionsBlock.kind === "steps" ? (
                  <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-on-surface">
                    {instructionsBlock.steps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="whitespace-pre-line text-sm text-on-surface">{instructionsBlock.text}</p>
                )}
                {instructionsBlock.isEnglish && (
                  <p className="mt-2 text-xs text-on-surface-muted">
                    Anleitung auf Englisch — Übersetzung folgt.
                  </p>
                )}
              </div>
            </div>
          )}

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
              Deine Statistik
            </h2>
            {sessions.length === 0 ? (
              <p className="mt-3 text-sm text-on-surface-muted">
                Noch keine erfassten Sätze für diese Übung.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-lg border border-surface-container-high">
                <table className="w-full min-w-[420px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-surface-container-high text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                      <th scope="col" className="px-4 py-3">
                        Datum
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Sätze
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Bester Satz
                      </th>
                      <th scope="col" className="px-4 py-3">
                        1RM (geschätzt)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session) => (
                      <tr
                        key={session.workoutId}
                        className="border-b border-surface-container-high last:border-b-0"
                      >
                        <td className="px-4 py-3 text-on-surface">{formatDate(session.date)}</td>
                        <td className="px-4 py-3 tabular-nums text-on-surface">{session.setCount}</td>
                        <td className="px-4 py-3 tabular-nums text-on-surface">
                          {session.bestWeightKg.toLocaleString("de-CH")} kg × {session.bestReps}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-primary">
                          {Math.round(session.estimated1Rm).toLocaleString("de-CH")} kg
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Link to="/" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
              Im Dashboard ansehen →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
