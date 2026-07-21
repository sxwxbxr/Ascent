import { useMemo, useState } from "react";
import { Link } from "react-router";
import { AddToPlanMenu } from "../components/AddToPlanMenu";
import { CATEGORY_LABELS_DE, capitalizeWords, exerciseName, muscleLabelDe } from "../lib/i18n";
import { useSnapshot } from "../lib/snapshot";
import type { ExerciseRow } from "../lib/snapshot";

/** Erste Seite der Übungsliste; "Mehr anzeigen" lädt jeweils eine weitere Seite nach (kein endloses DOM). */
const PAGE_SIZE = 60;

interface ExerciseCardProps {
  exercise: ExerciseRow;
}

function ExerciseCard({ exercise }: ExerciseCardProps) {
  const isOwn = exercise.userId != null;
  const name = exerciseName(exercise);
  const muscle = muscleLabelDe(exercise.primaryMuscle);
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <Link
      to={`/uebungen/${exercise.id}`}
      className="group relative flex flex-col gap-3 rounded-lg border border-surface-container-high bg-surface-container p-3 transition-colors hover:border-primary/60"
    >
      {/* Positioniert relativ zur Karte (nicht zum Bildcontainer), damit das
          Popover nicht vom `overflow-hidden` des Bildes abgeschnitten wird. */}
      <div className="absolute right-3 top-3 z-10">
        <AddToPlanMenu exerciseId={exercise.id} />
      </div>

      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-white">
        {exercise.thumbnailUrl ? (
          <img src={exercise.thumbnailUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-3xl font-extrabold text-surface/30">{initial}</span>
          </div>
        )}
        {isOwn && (
          <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-on-primary">
            Eigene
          </span>
        )}
      </div>
      <div>
        <p className="font-bold leading-tight text-on-surface transition-colors group-hover:text-primary">
          {name}
        </p>
        {muscle && <p className="mt-1 text-xs text-on-surface-muted">{muscle}</p>}
      </div>
    </Link>
  );
}

/**
 * Übungsdatenbank (Route `/uebungen`). Datenquelle ist ausschliesslich der
 * Snapshot (`useSnapshot`, `POST /sync/pull`) — der enthält bereits ALLE für
 * den Nutzer sichtbaren Übungen (global importierte + eigene, `deleted`
 * bereits herausgefiltert), daher kein eigener Request.
 */
export function ExercisesPage() {
  const { snapshot, loading, error } = useSnapshot();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [equipment, setEquipment] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  function handleSearchChange(value: string) {
    setSearch(value);
    setVisibleCount(PAGE_SIZE);
  }

  function handleCategoryChange(value: string) {
    setCategory(value);
    setVisibleCount(PAGE_SIZE);
  }

  function handleEquipmentChange(value: string) {
    setEquipment(value);
    setVisibleCount(PAGE_SIZE);
  }

  const equipmentOptions = useMemo(() => {
    const values = new Set<string>();
    for (const exercise of snapshot.exercises) {
      if (exercise.equipment) values.add(exercise.equipment);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [snapshot.exercises]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    const rows = snapshot.exercises.filter((exercise) => {
      if (term) {
        const matchesName = exercise.name.toLowerCase().includes(term);
        const matchesNameDe = exercise.nameDe?.toLowerCase().includes(term) ?? false;
        if (!matchesName && !matchesNameDe) return false;
      }
      if (category && exercise.category !== category) return false;
      if (equipment && exercise.equipment !== equipment) return false;
      return true;
    });

    // Eigene Übungen zuerst, dann alphabetisch nach Anzeigename (analog zur
    // Sortierung in der Mobile-App, siehe apps/mobile/src/data/exercises.ts).
    return rows.sort((a, b) => {
      const aOwn = a.userId != null ? 0 : 1;
      const bOwn = b.userId != null ? 0 : 1;
      if (aOwn !== bOwn) return aOwn - bOwn;
      return exerciseName(a).localeCompare(exerciseName(b), "de-CH");
    });
  }, [snapshot.exercises, search, category, equipment]);

  const visible = filtered.slice(0, visibleCount);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-3xl font-extrabold text-on-surface">Übungen</h1>
        <p className="text-on-surface-muted">Übungen werden geladen…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-3xl font-extrabold text-on-surface">Übungen</h1>
        <p className="text-error">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-3xl font-extrabold text-on-surface">Übungen</h1>

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex flex-1 flex-col gap-2 sm:min-w-[240px]">
          <label
            htmlFor="exercise-search"
            className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
          >
            Suche
          </label>
          <input
            id="exercise-search"
            type="text"
            placeholder="Übung suchen…"
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            className="h-12 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface placeholder:text-on-surface-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="exercise-category"
            className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
          >
            Kategorie
          </label>
          <select
            id="exercise-category"
            value={category}
            onChange={(event) => handleCategoryChange(event.target.value)}
            className="h-12 rounded-md border border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Alle Kategorien</option>
            {Object.entries(CATEGORY_LABELS_DE).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="exercise-equipment"
            className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
          >
            Equipment
          </label>
          <select
            id="exercise-equipment"
            value={equipment}
            onChange={(event) => handleEquipmentChange(event.target.value)}
            className="h-12 rounded-md border border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Alles Equipment</option>
            {equipmentOptions.map((value) => (
              <option key={value} value={value}>
                {capitalizeWords(value)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-surface-container-high bg-surface-container p-8 text-center">
          <p className="text-on-surface-muted">Keine Übungen gefunden. Passe Suche oder Filter an.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((exercise) => (
              <ExerciseCard key={exercise.id} exercise={exercise} />
            ))}
          </div>

          {visibleCount < filtered.length && (
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              className="h-12 self-center rounded-md border border-outline px-6 text-xs font-bold uppercase tracking-widest text-on-surface-muted transition-colors hover:text-on-surface"
            >
              Mehr anzeigen ({filtered.length - visibleCount} weitere)
            </button>
          )}
        </>
      )}
    </div>
  );
}
