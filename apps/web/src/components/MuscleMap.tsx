import Body from "@mjcdev/react-body-highlighter";
import { computePlanMuscleData } from "../lib/muscle-map";
import type { MuscleLevel } from "../lib/muscle-map";
import type { ExerciseRow, PlanExerciseRow } from "../lib/snapshot";

/**
 * Lime-Intensitätsskala für die vier Muskel-Frequenzstufen (schwach -> stark,
 * Index = Stufe - 1, siehe `Body`s `colors`-Prop). Bewusst vom Akzent
 * (`--color-primary` #b4ff39) abgeleitet statt einer generischen Heatmap-
 * Farbe, damit die Karte im "Dark Performance"-Farbschema bleibt.
 */
const LIME_INTENSITY_COLORS = ["#3d4d1a", "#6f9a1e", "#93db00", "#b4ff39"];

/** Entspricht `--color-outline` — die `Body`-Komponente nimmt nur einen Literal-Farbwert an, keine Tailwind-Klasse. */
const BODY_OUTLINE_COLOR = "#424a35";

const LEVEL_LABELS_DE: Record<MuscleLevel, string> = {
  4: "Sehr stark",
  3: "Stark",
  2: "Mittel",
  1: "Leicht",
};

export interface MuscleMapProps {
  planExercises: readonly PlanExerciseRow[];
  exercisesById: ReadonlyMap<string, ExerciseRow>;
  /**
   * Körpermodell-Geschlecht. `@mjcdev/react-body-highlighter` unterstützt
   * nativ `'male' | 'female'`; ein Hinweistext bei angenommenem/fehlendem
   * Profil-Geschlecht wird bewusst NICHT hier, sondern in PlanDetailPage
   * gerendert (dort ist bekannt, ob der Wert vom Profil stammt oder ein
   * Default ist).
   */
  gender: "male" | "female";
}

/**
 * Muskel-Karte eines Trainingsplans: Vorder- und Rückansicht nebeneinander
 * (untereinander auf schmalen Bildschirmen) plus Legende. Datenquelle ist
 * ausschliesslich `computePlanMuscleData` (reine Aggregation, keine eigenen
 * Requests).
 */
export function MuscleMap({ planExercises, exercisesById, gender }: MuscleMapProps) {
  const { bodyParts, legend } = computePlanMuscleData(planExercises, exercisesById);

  if (bodyParts.length === 0) {
    return (
      <div className="rounded-lg border border-surface-container-high bg-surface-container p-6 text-center text-on-surface-muted">
        Für diesen Plan liegen noch keine Muskeldaten vor.
      </div>
    );
  }

  const data = bodyParts.map((part) => ({ slug: part.slug, intensity: part.intensity }));
  const activeLegend = legend.filter((entry) => entry.muscles.length > 0);

  return (
    <div className="rounded-lg border border-surface-container-high bg-surface-container p-6">
      <div className="grid grid-cols-2 gap-4 sm:gap-8">
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">Vorderseite</p>
          {/* Body rendert ein <svg> mit festen width/height-Attributen (px); die
              Arbitrary-Variant erzwingt volle Breite + proportionale Höhe, damit
              die Karte responsiv bleibt (viewBox behält das Seitenverhältnis). */}
          <div className="w-full max-w-[220px] [&>svg]:h-auto [&>svg]:w-full">
            <Body data={data} side="front" gender={gender} colors={LIME_INTENSITY_COLORS} border={BODY_OUTLINE_COLOR} />
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">Rückseite</p>
          <div className="w-full max-w-[220px] [&>svg]:h-auto [&>svg]:w-full">
            <Body data={data} side="back" gender={gender} colors={LIME_INTENSITY_COLORS} border={BODY_OUTLINE_COLOR} />
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2 border-t border-surface-container-high pt-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">Legende</p>
        <ul className="flex flex-col gap-1.5">
          {activeLegend.map((entry) => (
            <li key={entry.level} className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className="h-3 w-3 flex-none rounded-full"
                style={{ backgroundColor: LIME_INTENSITY_COLORS[entry.level - 1] }}
                aria-hidden="true"
              />
              <span className="w-20 flex-none text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                {LEVEL_LABELS_DE[entry.level]}
              </span>
              <span className="text-on-surface">{entry.muscles.join(", ")}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
