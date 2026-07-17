import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError, api } from "../lib/api";
import { useSnapshot } from "../lib/snapshot";
import type { PlanRow } from "../lib/snapshot";

/**
 * Liste aller eigenen Trainingspläne (aus dem Snapshot, kein Extra-Request).
 * Anlegen/Umbenennen/Löschen laufen über die Plan-CRUD-Routen; nach jeder
 * Schreiboperation wird `reload()` aufgerufen, damit Dashboard/Verlauf
 * konsistent bleiben (dort werden dieselben Snapshot-Daten verwendet).
 */
export function PlansPage() {
  const { snapshot, loading, error, reload } = useSnapshot();
  const navigate = useNavigate();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingBusy, setCreatingBusy] = useState(false);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function exerciseCount(planId: string): number {
    return snapshot.planExercises.filter((planExercise) => planExercise.planId === planId).length;
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;

    setCreateError(null);
    setCreatingBusy(true);
    try {
      const plan = await api.post<PlanRow>("/plans", {
        name,
        description: newDescription.trim() || undefined,
      });
      await reload();
      setNewName("");
      setNewDescription("");
      setCreating(false);
      void navigate(`/plaene/${plan.id}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Plan konnte nicht erstellt werden.");
    } finally {
      setCreatingBusy(false);
    }
  }

  function startRename(plan: PlanRow) {
    setRenamingId(plan.id);
    setRenameValue(plan.name);
    setRenameError(null);
  }

  async function confirmRename(planId: string) {
    const name = renameValue.trim();
    if (!name) return;

    setBusyId(planId);
    setRenameError(null);
    try {
      await api.put(`/plans/${planId}`, { name });
      await reload();
      setRenamingId(null);
    } catch (err) {
      setRenameError(err instanceof ApiError ? err.message : "Umbenennen fehlgeschlagen.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(plan: PlanRow) {
    if (!window.confirm(`Plan "${plan.name}" wirklich löschen?`)) return;

    setBusyId(plan.id);
    setRowError(null);
    try {
      await api.delete(`/plans/${plan.id}`);
      await reload();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Löschen fehlgeschlagen.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-extrabold text-on-surface">Pläne</h1>
        <button
          type="button"
          onClick={() => {
            setCreateError(null);
            setCreating((prev) => !prev);
          }}
          className="h-12 rounded-md bg-primary px-6 font-bold uppercase tracking-wide text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          {creating ? "Abbrechen" : "Neuen Plan anlegen"}
        </button>
      </div>

      {creating && (
        <form
          onSubmit={(event) => void handleCreate(event)}
          className="flex flex-col gap-4 rounded-lg border border-surface-container-high bg-surface-container p-6"
        >
          <div className="flex flex-col gap-2">
            <label
              htmlFor="plan-name"
              className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
            >
              Name
            </label>
            <input
              id="plan-name"
              required
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="z. B. Push-Pull-Legs"
              className="h-12 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface placeholder:text-on-surface-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="plan-description"
              className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
            >
              Beschreibung (optional)
            </label>
            <textarea
              id="plan-description"
              rows={2}
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              className="rounded-md border-0 border-b-2 border-outline bg-surface px-4 py-3 text-on-surface placeholder:text-on-surface-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {createError && (
            <p role="alert" className="text-sm text-error">
              {createError}
            </p>
          )}

          <button
            type="submit"
            disabled={creatingBusy}
            className="h-12 self-start rounded-md bg-primary px-6 font-bold uppercase tracking-wide text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creatingBusy ? "Wird erstellt…" : "Plan erstellen"}
          </button>
        </form>
      )}

      {loading && <p className="text-on-surface-muted">Wird geladen…</p>}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {rowError && (
        <p role="alert" className="text-sm text-error">
          {rowError}
        </p>
      )}

      {!loading && snapshot.plans.length === 0 && (
        <div className="rounded-lg border border-surface-container-high bg-surface-container p-6 text-center text-on-surface-muted">
          Noch keine Pläne vorhanden. Lege deinen ersten Trainingsplan an.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {snapshot.plans.map((plan) => {
          const count = exerciseCount(plan.id);
          const isRenaming = renamingId === plan.id;
          const isBusy = busyId === plan.id;

          return (
            <div
              key={plan.id}
              className="flex flex-col gap-4 rounded-lg border border-surface-container-high bg-surface-container p-6 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex-1">
                {isRenaming ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      className="h-10 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={() => void confirmRename(plan.id)}
                      disabled={isBusy}
                      className="h-10 rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-widest text-on-primary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Speichern
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="h-10 rounded-md border border-outline px-4 text-xs font-bold uppercase tracking-widest text-on-surface-muted transition-colors hover:text-on-surface"
                    >
                      Abbrechen
                    </button>
                    {renameError && (
                      <p role="alert" className="w-full text-sm text-error">
                        {renameError}
                      </p>
                    )}
                  </div>
                ) : (
                  <Link to={`/plaene/${plan.id}`} className="group inline-block">
                    <h2 className="text-lg font-bold text-on-surface transition-colors group-hover:text-primary">
                      {plan.name}
                    </h2>
                    {plan.description && (
                      <p className="mt-1 text-sm text-on-surface-muted">{plan.description}</p>
                    )}
                    <p className="mt-1 text-xs uppercase tracking-widest text-on-surface-muted">
                      {count} {count === 1 ? "Übung" : "Übungen"}
                    </p>
                  </Link>
                )}
              </div>

              {!isRenaming && (
                <div className="flex flex-none gap-3">
                  <button
                    type="button"
                    onClick={() => startRename(plan)}
                    className="h-10 rounded-md border border-outline px-4 text-xs font-bold uppercase tracking-widest text-on-surface-muted transition-colors hover:text-on-surface"
                  >
                    Umbenennen
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(plan)}
                    disabled={isBusy}
                    className="h-10 rounded-md border border-outline px-4 text-xs font-bold uppercase tracking-widest text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Löschen
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
