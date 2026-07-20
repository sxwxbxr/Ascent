import { useEffect, useState } from "react";
import { ApiError, api } from "../lib/api";
import { exerciseName } from "../lib/i18n";
import type { ExerciseRow } from "../lib/snapshot";

interface ExercisePickerModalProps {
  onClose: () => void;
  onSelect: (exercise: ExerciseRow) => void;
  /** Fehler aus dem Hinzufügen-Request (POST /plans/:planId/exercises) – wird IM Modal angezeigt. */
  submitError?: string | null;
  /** true während eine ausgewählte Übung hinzugefügt wird (deaktiviert die Auswahl gegen Doppel-Submits). */
  submitting?: boolean;
}

/**
 * Such-Modal zur Übungsauswahl (genutzt von PlanEditorPage, "Übung
 * hinzufügen"). Sucht per Debounce (~300ms) gegen `GET /exercises?q=…` –
 * liefert globale (importierte) + eigene Übungen inkl. Thumbnail.
 */
export function ExercisePickerModal({ onClose, onSelect, submitError, submitting }: ExercisePickerModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ExerciseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const handle = setTimeout(() => {
      const params = new URLSearchParams({ limit: "100" });
      const trimmed = query.trim();
      if (trimmed) params.set("q", trimmed);

      api
        .get<ExerciseRow[]>(`/exercises?${params.toString()}`)
        .then((rows) => {
          if (!cancelled) setResults(rows);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof ApiError ? err.message : "Übungen konnten nicht geladen werden.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  return (
    <div
      className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16 sm:pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-surface-container-high bg-surface-container-high p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-on-surface">Übung hinzufügen</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-md border border-outline px-4 text-xs font-bold uppercase tracking-widest text-on-surface-muted transition-colors hover:text-on-surface"
          >
            Schliessen
          </button>
        </div>

        <input
          type="text"
          autoFocus
          placeholder="Übung suchen…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mt-4 h-12 w-full rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface placeholder:text-on-surface-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />

        {error && (
          <p role="alert" className="mt-3 text-sm text-error">
            {error}
          </p>
        )}
        {submitError && (
          <p role="alert" className="mt-3 text-sm text-error">
            {submitError}
          </p>
        )}

        <div className="mt-4 max-h-96 overflow-y-auto">
          {loading ? (
            <p className="py-6 text-center text-sm text-on-surface-muted">Wird geladen…</p>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-sm text-on-surface-muted">Keine Übungen gefunden.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {results.map((exercise) => (
                <li key={exercise.id}>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => onSelect(exercise)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {exercise.thumbnailUrl ? (
                      <img
                        src={exercise.thumbnailUrl}
                        alt=""
                        className="h-10 w-10 flex-none rounded object-cover"
                      />
                    ) : (
                      <span className="h-10 w-10 flex-none rounded bg-surface-container" />
                    )}
                    <span className="flex flex-col">
                      <span className="font-semibold text-on-surface">
                        {exerciseName(exercise)}
                      </span>
                      {exercise.category && (
                        <span className="text-xs text-on-surface-muted">{exercise.category}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
