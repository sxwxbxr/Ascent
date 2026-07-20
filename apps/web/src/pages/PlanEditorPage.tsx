import { useCallback, useEffect, useMemo, useState } from "react";
import type { FocusEvent } from "react";
import { Link, useParams } from "react-router";
import { ExercisePickerModal } from "../components/ExercisePickerModal";
import { ApiError, api } from "../lib/api";
import { exerciseName } from "../lib/i18n";
import { useSnapshot } from "../lib/snapshot";
import type { ExerciseRow, PlanExerciseRow, PlanRow } from "../lib/snapshot";

interface PlanDetail extends PlanRow {
  planExercises: PlanExerciseRow[];
}

interface PlanExerciseItemProps {
  planExercise: PlanExerciseRow;
  exercise: ExerciseRow | undefined;
  busy: boolean;
  disableUp: boolean;
  disableDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onSaveTargetSets: (value: number) => void;
  onSaveRepsMin: (value: number) => void;
  onSaveRepsMax: (value: number) => void;
  onSaveRest: (value: number) => void;
}

/** Eine Zeile der Plan-Übungsliste: Anzeige + editierbare Zielwerte (Auto-Save onBlur). */
function PlanExerciseItem({
  planExercise,
  exercise,
  busy,
  disableUp,
  disableDown,
  onMoveUp,
  onMoveDown,
  onRemove,
  onSaveTargetSets,
  onSaveRepsMin,
  onSaveRepsMax,
  onSaveRest,
}: PlanExerciseItemProps) {
  const displayName = exercise ? exerciseName(exercise) : "Unbekannte Übung";

  function handleBlur(
    event: FocusEvent<HTMLInputElement>,
    current: number | null | undefined,
    save: (value: number) => void,
  ) {
    const raw = event.target.value.trim();
    if (raw === "") return;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed === current) return;
    save(parsed);
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-surface-container-high bg-surface-container p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        {exercise?.thumbnailUrl ? (
          <img src={exercise.thumbnailUrl} alt="" className="h-12 w-12 flex-none rounded object-cover" />
        ) : (
          <span className="h-12 w-12 flex-none rounded bg-surface-container-high" />
        )}
        <div>
          <p className="font-bold text-on-surface">{displayName}</p>
          {exercise?.category && <p className="text-xs text-on-surface-muted">{exercise.category}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
          Sätze
          <input
            type="number"
            min={1}
            max={20}
            defaultValue={planExercise.targetSets}
            onBlur={(event) => handleBlur(event, planExercise.targetSets, onSaveTargetSets)}
            className="h-10 w-16 rounded-md border-0 border-b-2 border-outline bg-surface px-2 text-center text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
          Wdh. min
          <input
            type="number"
            min={1}
            max={100}
            defaultValue={planExercise.targetRepsMin ?? ""}
            onBlur={(event) => handleBlur(event, planExercise.targetRepsMin, onSaveRepsMin)}
            className="h-10 w-16 rounded-md border-0 border-b-2 border-outline bg-surface px-2 text-center text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
          Wdh. max
          <input
            type="number"
            min={1}
            max={100}
            defaultValue={planExercise.targetRepsMax ?? ""}
            onBlur={(event) => handleBlur(event, planExercise.targetRepsMax, onSaveRepsMax)}
            className="h-10 w-16 rounded-md border-0 border-b-2 border-outline bg-surface px-2 text-center text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
          Pause (s)
          <input
            type="number"
            min={0}
            max={600}
            defaultValue={planExercise.restSeconds ?? ""}
            onBlur={(event) => handleBlur(event, planExercise.restSeconds, onSaveRest)}
            className="h-10 w-20 rounded-md border-0 border-b-2 border-outline bg-surface px-2 text-center text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={busy || disableUp}
            aria-label="Nach oben verschieben"
            className="flex h-10 w-10 items-center justify-center rounded-md border border-outline text-on-surface-muted transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={busy || disableDown}
            aria-label="Nach unten verschieben"
            className="flex h-10 w-10 items-center justify-center rounded-md border border-outline text-on-surface-muted transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="h-10 rounded-md border border-outline px-4 text-xs font-bold uppercase tracking-widest text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Entfernen
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Plan-Editor (Route `/plaene/:planId`). Lädt das Plan-Detail direkt via
 * `GET /plans/:planId` (Server liefert bereits nach `position` sortierte
 * Plan-Übungen) in lokalen State und nach jeder Mutation neu. Ruft zusätzlich
 * `useSnapshot().reload()` auf, damit Dashboard/Verlauf konsistent bleiben.
 */
export function PlanEditorPage() {
  const { planId } = useParams<{ planId: string }>();
  const { snapshot, reload } = useSnapshot();

  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [rowError, setRowError] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const exerciseById = useMemo(() => {
    const map = new Map<string, ExerciseRow>();
    for (const exercise of snapshot.exercises) map.set(exercise.id, exercise);
    return map;
  }, [snapshot.exercises]);

  const loadPlan = useCallback(async () => {
    if (!planId) return;
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const data = await api.get<PlanDetail>(`/plans/${planId}`);
      setPlan(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
        setPlan(null);
      } else {
        setLoadError(err instanceof ApiError ? err.message : "Plan konnte nicht geladen werden.");
      }
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  const sortedExercises = useMemo(() => {
    if (!plan) return [];
    return [...plan.planExercises].sort((a, b) => a.position - b.position);
  }, [plan]);

  async function updatePlanExercise(
    planExerciseId: string,
    patch: Partial<{
      exerciseId: string;
      position: number;
      targetSets: number;
      targetRepsMin: number;
      targetRepsMax: number;
      restSeconds: number;
    }>,
  ) {
    if (!planId) return;
    setBusyRowId(planExerciseId);
    setRowError(null);
    try {
      await api.put(`/plans/${planId}/exercises/${planExerciseId}`, patch);
      await Promise.all([loadPlan(), reload()]);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Änderung konnte nicht gespeichert werden.");
    } finally {
      setBusyRowId(null);
    }
  }

  async function moveExercise(planExercise: PlanExerciseRow, direction: "up" | "down") {
    const index = sortedExercises.findIndex((row) => row.id === planExercise.id);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapIndex < 0 || swapIndex >= sortedExercises.length) return;

    const current = sortedExercises[index];
    const other = sortedExercises[swapIndex];
    if (!current || !other || !planId) return;

    setBusyRowId(current.id);
    setRowError(null);
    try {
      await Promise.all([
        api.put(`/plans/${planId}/exercises/${current.id}`, { position: other.position }),
        api.put(`/plans/${planId}/exercises/${other.id}`, { position: current.position }),
      ]);
      await Promise.all([loadPlan(), reload()]);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Reihenfolge konnte nicht geändert werden.");
    } finally {
      setBusyRowId(null);
    }
  }

  async function removeExercise(planExercise: PlanExerciseRow) {
    if (!planId) return;
    if (!window.confirm("Übung aus dem Plan entfernen?")) return;

    setBusyRowId(planExercise.id);
    setRowError(null);
    try {
      await api.delete(`/plans/${planId}/exercises/${planExercise.id}`);
      await Promise.all([loadPlan(), reload()]);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Entfernen fehlgeschlagen.");
    } finally {
      setBusyRowId(null);
    }
  }

  async function handleAddExercise(exercise: ExerciseRow) {
    if (!planId) return;
    const maxPosition = sortedExercises.reduce((max, row) => Math.max(max, row.position), -1);

    setAdding(true);
    setModalError(null);
    try {
      await api.post(`/plans/${planId}/exercises`, {
        exerciseId: exercise.id,
        position: maxPosition + 1,
        targetSets: 3,
      });
      await Promise.all([loadPlan(), reload()]);
      setModalOpen(false);
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : "Übung konnte nicht hinzugefügt werden.");
    } finally {
      setAdding(false);
    }
  }

  if (!planId) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-error">Kein Plan ausgewählt.</p>
        <Link to="/plaene" className="font-semibold text-primary hover:underline">
          Zurück zu den Plänen
        </Link>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-extrabold text-on-surface">Plan nicht gefunden</h1>
        <p className="text-on-surface-muted">
          Dieser Plan existiert nicht (mehr) oder gehört nicht zu deinem Konto.
        </p>
        <Link to="/plaene" className="font-semibold text-primary hover:underline">
          Zurück zu den Plänen
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link to="/plaene" className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted hover:text-on-surface">
          ← Alle Pläne
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-on-surface">
              {plan?.name ?? (loading ? "Wird geladen…" : "Plan bearbeiten")}
            </h1>
            {plan?.description && <p className="mt-1 text-on-surface-muted">{plan.description}</p>}
          </div>
          <button
            type="button"
            onClick={() => {
              setModalError(null);
              setModalOpen(true);
            }}
            disabled={!plan}
            className="h-12 rounded-md bg-primary px-6 font-bold uppercase tracking-wide text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Übung hinzufügen
          </button>
        </div>
      </div>

      {loading && !plan && <p className="text-on-surface-muted">Wird geladen…</p>}
      {loadError && (
        <p role="alert" className="text-sm text-error">
          {loadError}
        </p>
      )}
      {rowError && (
        <p role="alert" className="text-sm text-error">
          {rowError}
        </p>
      )}

      {plan && sortedExercises.length === 0 && (
        <div className="rounded-lg border border-surface-container-high bg-surface-container p-6 text-center text-on-surface-muted">
          Dieser Plan hat noch keine Übungen. Füge die erste Übung hinzu.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {sortedExercises.map((planExercise, index) => (
          <PlanExerciseItem
            key={planExercise.id}
            planExercise={planExercise}
            exercise={exerciseById.get(planExercise.exerciseId)}
            busy={busyRowId === planExercise.id}
            disableUp={index === 0}
            disableDown={index === sortedExercises.length - 1}
            onMoveUp={() => void moveExercise(planExercise, "up")}
            onMoveDown={() => void moveExercise(planExercise, "down")}
            onRemove={() => void removeExercise(planExercise)}
            onSaveTargetSets={(value) => void updatePlanExercise(planExercise.id, { targetSets: value })}
            onSaveRepsMin={(value) => void updatePlanExercise(planExercise.id, { targetRepsMin: value })}
            onSaveRepsMax={(value) => void updatePlanExercise(planExercise.id, { targetRepsMax: value })}
            onSaveRest={(value) => void updatePlanExercise(planExercise.id, { restSeconds: value })}
          />
        ))}
      </div>

      {modalOpen && (
        <ExercisePickerModal
          onClose={() => !adding && setModalOpen(false)}
          onSelect={(exercise) => void handleAddExercise(exercise)}
          submitError={modalError}
          submitting={adding}
        />
      )}
    </div>
  );
}
