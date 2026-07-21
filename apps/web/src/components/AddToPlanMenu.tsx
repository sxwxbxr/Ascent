import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { ApiError, api } from "../lib/api";
import { useSnapshot } from "../lib/snapshot";
import type { PlanRow } from "../lib/snapshot";

interface AddToPlanMenuProps {
  exerciseId: string;
}

/** Wie lange die Erfolgsbestätigung ("Zu <Plan> hinzugefügt") eingeblendet bleibt. */
const CONFIRMATION_DURATION_MS = 2000;

/**
 * Popover-Button "+ Zu Plan" (Spotify-Playlist-Stil): fügt eine Übung direkt in
 * einen der eigenen Pläne ein, ohne den Plan-Editor zu öffnen. Nutzt
 * ausschliesslich den Snapshot (`useSnapshot`) für Pläne/Plan-Übungen und
 * `POST /plans/:planId/exercises` (siehe apps/api/src/routes/plans.ts) zum
 * Schreiben; nach Erfolg `reload()`, damit alle Ansichten (Plan-Editor,
 * Dashboard) sofort konsistent sind.
 *
 * Wird sowohl in Übungskarten (ExercisesPage, innerhalb eines <Link>) als auch
 * im Kopfbereich der Detailseite (ExerciseDetailPage) verwendet – der äussere
 * Klick-Handler stoppt daher grundsätzlich Bubbling/Default, damit ein Klick
 * ins Menü nie eine umgebende Link-Navigation auslöst.
 */
export function AddToPlanMenu({ exerciseId }: AddToPlanMenuProps) {
  const { snapshot, reload } = useSnapshot();
  const [open, setOpen] = useState(false);
  const [submittingPlanId, setSubmittingPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const confirmationTimeoutRef = useRef<number | null>(null);

  // Eigene Pläne alphabetisch – snapshot.plans hat `deleted` bereits herausgefiltert.
  const plans = useMemo(
    () => [...snapshot.plans].sort((a, b) => a.name.localeCompare(b.name, "de-CH")),
    [snapshot.plans],
  );

  // Ids aller Pläne, die diese Übung bereits enthalten (snapshot.planExercises
  // ist ebenfalls schon um `deleted` bereinigt).
  const plansContainingExercise = useMemo(() => {
    const ids = new Set<string>();
    for (const planExercise of snapshot.planExercises) {
      if (planExercise.exerciseId === exerciseId) ids.add(planExercise.planId);
    }
    return ids;
  }, [snapshot.planExercises, exerciseId]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Timeout beim Unmount aufräumen (z. B. Navigation kurz nach dem Hinzufügen).
  useEffect(() => {
    return () => {
      if (confirmationTimeoutRef.current !== null) window.clearTimeout(confirmationTimeoutRef.current);
    };
  }, []);

  /** Verhindert, dass ein Klick ins Menü an ein umgebendes <Link> (Kartennavigation) durchgereicht wird. */
  function stopBubble(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  async function handleSelect(plan: PlanRow) {
    if (submittingPlanId !== null || plansContainingExercise.has(plan.id)) return;

    setError(null);
    setSubmittingPlanId(plan.id);

    // Position = (max. position der nicht-gelöschten Plan-Übungen dieses Plans) + 1, sonst 0.
    const ownExercises = snapshot.planExercises.filter((row) => row.planId === plan.id);
    const maxPosition = ownExercises.reduce((max, row) => Math.max(max, row.position), -1);

    try {
      await api.post(`/plans/${plan.id}/exercises`, {
        exerciseId,
        position: maxPosition + 1,
        targetSets: 3,
        restSeconds: 90,
      });
      await reload();
      setOpen(false);
      setConfirmation(`Zu ${plan.name} hinzugefügt`);
      if (confirmationTimeoutRef.current !== null) window.clearTimeout(confirmationTimeoutRef.current);
      confirmationTimeoutRef.current = window.setTimeout(() => setConfirmation(null), CONFIRMATION_DURATION_MS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Übung konnte nicht hinzugefügt werden.");
    } finally {
      setSubmittingPlanId(null);
    }
  }

  return (
    <div className="relative inline-block" onClick={stopBubble}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 items-center gap-1 rounded-full border border-outline bg-surface-container-high px-3 text-xs font-bold uppercase tracking-widest text-on-surface-muted transition-colors hover:border-primary hover:text-on-surface"
      >
        + Zu Plan
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-outline bg-surface-container-high p-2 shadow-lg"
          >
            {plans.length === 0 ? (
              <p className="px-3 py-2 text-sm text-on-surface-muted">
                Noch kein Plan — im Tab Pläne erstellen
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {plans.map((plan) => {
                  const alreadyIncluded = plansContainingExercise.has(plan.id);
                  const busy = submittingPlanId === plan.id;
                  return (
                    <li key={plan.id}>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={alreadyIncluded || submittingPlanId !== null}
                        onClick={() => void handleSelect(plan)}
                        className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="truncate">{plan.name}</span>
                        {alreadyIncluded && (
                          <span className="flex-none text-xs text-on-surface-muted">✓ bereits enthalten</span>
                        )}
                        {busy && <span className="flex-none text-xs text-on-surface-muted">…</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {error && (
              <p role="alert" className="mt-2 px-3 py-1 text-xs text-error">
                {error}
              </p>
            )}
          </div>
        </>
      )}

      {confirmation && (
        <div
          role="status"
          className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-primary/40 bg-surface-container-high px-3 py-2 text-xs font-semibold text-primary"
        >
          {confirmation}
        </div>
      )}
    </div>
  );
}
