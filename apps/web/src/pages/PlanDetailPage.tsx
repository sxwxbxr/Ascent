import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { MuscleMap } from "../components/MuscleMap";
import { api } from "../lib/api";
import { exerciseName } from "../lib/i18n";
import { estimatePlanMinutes } from "../lib/muscle-map";
import { useSnapshot } from "../lib/snapshot";
import type { ExerciseRow, PlanExerciseRow } from "../lib/snapshot";

/** Rohgeschlecht laut Profil (siehe packages/shared/src/validation.ts `profileUpdateSchema`, SettingsPage.tsx). */
type ProfileGender = "m" | "w" | "d";

/** Nur der Ausschnitt von `GET /profile`, den diese Seite braucht. */
interface ProfileGenderResponse {
  gender: ProfileGender | null;
}

/** männlich -> male, weiblich -> female; divers/fehlend -> male-Default (Body-Modell kennt nur zwei Ausprägungen). */
function toBodyGender(profileGender: ProfileGender | null | undefined): "male" | "female" {
  return profileGender === "w" ? "female" : "male";
}

function formatRepsRange(min: number | null | undefined, max: number | null | undefined): string {
  if (min != null && max != null) return min === max ? `${min}` : `${min}–${max}`;
  if (min != null) return `${min}`;
  if (max != null) return `${max}`;
  return "–";
}

function formatPlanExerciseMeta(planExercise: PlanExerciseRow): string {
  const sets = `${planExercise.targetSets} ${planExercise.targetSets === 1 ? "Satz" : "Sätze"}`;
  const reps = `${formatRepsRange(planExercise.targetRepsMin, planExercise.targetRepsMax)} Wdh.`;
  const rest = planExercise.restSeconds != null ? `${planExercise.restSeconds} s Pause` : "keine Pause hinterlegt";
  return `${sets} · ${reps} · ${rest}`;
}

/**
 * Plan-Übersicht (Route `/plaene/:planId`): Muskel-Karte + Übungsliste eines
 * Plans, rein lesend aus dem Snapshot. Das Bearbeiten von Übungen (Reihen-
 * folge/Zielwerte/Hinzufügen/Entfernen) bleibt Aufgabe von PlanEditorPage,
 * jetzt unter `/plaene/:planId/bearbeiten` (siehe App.tsx) — der Link dahin
 * ist im Header immer sichtbar, auch bei einem leeren Plan.
 */
export function PlanDetailPage() {
  const { planId } = useParams<{ planId: string }>();
  const { snapshot, loading, error } = useSnapshot();

  const [profileGender, setProfileGender] = useState<ProfileGender | null>(null);
  const [genderKnown, setGenderKnown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ProfileGenderResponse>("/profile")
      .then((profile) => {
        if (!cancelled) {
          setProfileGender(profile.gender);
          setGenderKnown(true);
        }
      })
      .catch(() => {
        // Profil konnte nicht geladen werden: Körpermodell fällt still auf
        // männlich zurück (siehe toBodyGender) — kein Blocker für die Seite.
        if (!cancelled) setGenderKnown(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const plan = useMemo(() => snapshot.plans.find((row) => row.id === planId), [snapshot.plans, planId]);

  const planExercises = useMemo(() => {
    return snapshot.planExercises
      // Der Snapshot hat gelöschte Zeilen bereits entfernt (siehe lib/snapshot.ts) — Filter hier nur defensiv.
      .filter((row) => row.planId === planId && !row.deleted)
      .sort((a, b) => a.position - b.position);
  }, [snapshot.planExercises, planId]);

  const exercisesById = useMemo(() => {
    const map = new Map<string, ExerciseRow>();
    for (const exercise of snapshot.exercises) map.set(exercise.id, exercise);
    return map;
  }, [snapshot.exercises]);

  const minutes = useMemo(() => estimatePlanMinutes(planExercises), [planExercises]);
  const bodyGender = toBodyGender(profileGender);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <p className="text-on-surface-muted">Plan wird geladen…</p>
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

  if (!plan) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-extrabold text-on-surface">Plan nicht gefunden</h1>
        <p className="text-on-surface-muted">Dieser Plan existiert nicht (mehr) oder gehört nicht zu deinem Konto.</p>
        <Link to="/plaene" className="font-semibold text-primary hover:underline">
          ← Alle Pläne
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          to="/plaene"
          className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted hover:text-on-surface"
        >
          ← Alle Pläne
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-on-surface">{plan.name}</h1>
            {plan.description && <p className="mt-1 text-on-surface-muted">{plan.description}</p>}
            <p className="mt-2 text-sm font-semibold uppercase tracking-widest text-on-surface-muted">
              {planExercises.length === 0 ? "Keine Übungen" : `~${minutes} Min`}
              {" · "}
              {planExercises.length} {planExercises.length === 1 ? "Übung" : "Übungen"}
            </p>
          </div>
          <Link
            to={`/plaene/${plan.id}/bearbeiten`}
            className="h-12 rounded-md bg-primary px-6 text-center font-bold uppercase leading-[3rem] tracking-wide text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98]"
          >
            Übungen bearbeiten
          </Link>
        </div>
      </div>

      <MuscleMap planExercises={planExercises} exercisesById={exercisesById} gender={bodyGender} />

      {genderKnown && (profileGender === null || profileGender === "d") && (
        <p className="-mt-4 text-xs text-on-surface-muted">
          Hinweis: Die Muskel-Karte zeigt ein männliches Körpermodell, da im Profil kein oder das Geschlecht
          &bdquo;divers&ldquo; hinterlegt ist.
        </p>
      )}

      <div className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">Übungen</h2>

        {planExercises.length === 0 ? (
          <div className="rounded-lg border border-surface-container-high bg-surface-container p-6 text-center text-on-surface-muted">
            Dieser Plan hat noch keine Übungen.{" "}
            <Link to="/uebungen" className="font-semibold text-primary hover:underline">
              Übungen durchsuchen
            </Link>{" "}
            und über &bdquo;+ Zu Plan&ldquo; direkt hier hinzufügen, oder{" "}
            <Link to={`/plaene/${plan.id}/bearbeiten`} className="font-semibold text-primary hover:underline">
              im Plan-Editor
            </Link>{" "}
            ergänzen.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {planExercises.map((planExercise) => {
              const exercise = exercisesById.get(planExercise.exerciseId);
              const displayName = exercise ? exerciseName(exercise) : "Unbekannte Übung";

              return (
                <div
                  key={planExercise.id}
                  className="flex items-center gap-4 rounded-lg border border-surface-container-high bg-surface-container p-4"
                >
                  {exercise?.thumbnailUrl ? (
                    <img
                      src={exercise.thumbnailUrl}
                      alt=""
                      className="h-12 w-12 flex-none rounded bg-white object-contain"
                    />
                  ) : (
                    <span className="h-12 w-12 flex-none rounded bg-surface-container-high" />
                  )}
                  <div className="min-w-0 flex-1">
                    {exercise ? (
                      <Link
                        to={`/uebungen/${exercise.id}`}
                        className="font-bold text-on-surface transition-colors hover:text-primary"
                      >
                        {displayName}
                      </Link>
                    ) : (
                      <p className="font-bold text-on-surface">{displayName}</p>
                    )}
                    <p className="mt-1 text-sm text-on-surface-muted">{formatPlanExerciseMeta(planExercise)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
