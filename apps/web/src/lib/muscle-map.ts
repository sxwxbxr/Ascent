/**
 * Aggregiert die Zielmuskeln eines Trainingsplans zu einer Muskel-Karte
 * (siehe components/MuscleMap.tsx) und schätzt die Plandauer.
 *
 * BIBLIOTHEKSENTSCHEID: gerendert wird mit `@mjcdev/react-body-highlighter`
 * (nicht `react-body-highlighter`, das initial installiert war) — als
 * einzige der beiden Kandidaten bietet sie ein sauber typisiertes
 * `gender?: 'male' | 'female'`-Prop auf `BodyProps` (siehe
 * node_modules/@mjcdev/react-body-highlighter/dist/index.d.ts) und wurde
 * bereits mit einem eigenen Vite-Beispielprojekt gegen React getestet
 * (Peer-Dependency `react: "*"`, keine RN-spezifischen Abhängigkeiten in
 * den SVG-Assets). Die Muskel-Slugs unterscheiden sich dadurch leicht vom
 * ursprünglich vorgesehenen Mapping (Ziel: `react-body-highlighter`-Slugs):
 * kein `abductors`-Slug (→ weglassen), `delts` nur als ein `deltoids`-Slug
 * statt getrennt vorne/hinten, dafür nativ `ankles` (treffender als der
 * ursprünglich vorgesehene Ersatz `calves`).
 */
import { muscleLabelDe } from "./i18n";
import type { ExerciseRow, PlanExerciseRow } from "./snapshot";

/** Muskel-Slugs, die `@mjcdev/react-body-highlighter`s `Body`-Komponente kennt. */
export type BodySlug =
  | "abs"
  | "adductors"
  | "ankles"
  | "biceps"
  | "calves"
  | "chest"
  | "deltoids"
  | "feet"
  | "forearm"
  | "gluteal"
  | "hamstring"
  | "hands"
  | "hair"
  | "head"
  | "knees"
  | "lower-back"
  | "neck"
  | "obliques"
  | "quadriceps"
  | "tibialis"
  | "trapezius"
  | "triceps"
  | "upper-back";

/**
 * Mapping unserer Datensatz-Rohwerte (siehe MUSCLE_LABELS_DE in lib/i18n.ts)
 * auf Bibliotheks-Slugs. Ein Rohwert kann auf mehrere Slugs zeigen; ein
 * leeres Array (oder ein fehlender Eintrag) heisst bewusst "weglassen"
 * (unbekannt oder von der Bibliothek nicht darstellbar — z. B. `abductors`
 * und `cardiovascular system`).
 */
export const MUSCLE_SLUG_MAP: Readonly<Record<string, readonly BodySlug[]>> = {
  abs: ["abs"],
  lats: ["upper-back"],
  quads: ["quadriceps"],
  calves: ["calves"],
  pectorals: ["chest"],
  delts: ["deltoids"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  glutes: ["gluteal"],
  hamstrings: ["hamstring"],
  traps: ["trapezius"],
  forearms: ["forearm"],
  spine: ["lower-back"],
  "upper back": ["upper-back"],
  adductors: ["adductors"],
  abductors: [], // von @mjcdev/react-body-highlighter nicht unterstützt -> weglassen
  "serratus anterior": ["abs"],
  "levator scapulae": ["neck"],
  ankles: ["ankles"],
  "cardiovascular system": [], // kein darstellbarer Muskel -> weglassen
};

/** Frequenz-/Intensitätsstufe für die Muskel-Karte (1 = am schwächsten trainiert, 4 = am stärksten). */
export type MuscleLevel = 1 | 2 | 3 | 4;

/** Ein Eintrag für `Body`s `data`-Prop (nur Slug + Stufe, siehe MuscleMap.tsx). */
export interface PlanBodyPart {
  slug: BodySlug;
  intensity: MuscleLevel;
}

/** Ein Legende-Eintrag: Stufe -> deutsche Labels der beitragenden Rohmuskeln (dedupliziert, alphabetisch). */
export interface MuscleLegendEntry {
  level: MuscleLevel;
  muscles: string[];
}

export interface PlanMuscleData {
  bodyParts: PlanBodyPart[];
  /** Von stärkster (4) zu schwächster (1) Stufe sortiert; leere Stufen werden mitgeliefert. */
  legend: MuscleLegendEntry[];
}

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

function addSlugContribution(
  scoreBySlug: Map<BodySlug, number>,
  contributorsBySlug: Map<BodySlug, Set<string>>,
  rawMuscle: string | null | undefined,
  weight: number,
): void {
  if (!rawMuscle) return;
  const slugs = MUSCLE_SLUG_MAP[rawMuscle];
  if (!slugs || slugs.length === 0) return;
  for (const slug of slugs) {
    scoreBySlug.set(slug, (scoreBySlug.get(slug) ?? 0) + weight);
    const contributors = contributorsBySlug.get(slug) ?? new Set<string>();
    contributors.add(rawMuscle);
    contributorsBySlug.set(slug, contributors);
  }
}

/**
 * Bucketing: Stufen relativ zum stärksten Muskel DIESES Plans (>=75/50/25%
 * des Maximums -> 4/3/2, sonst 1), NICHT als statistische Quartile über die
 * Score-Verteilung. Begründung: ein Plan hat typischerweise nur eine
 * Handvoll unterschiedlich beanspruchter Muskelgruppen (5-12) — dafür sind
 * echte Quartile (25./50./75. Perzentil) zu wenige Datenpunkte, um stabil zu
 * sein. Feste Relativ-Schwellen zum Maximum garantieren dagegen unabhängig
 * von Plangrösse/Satzzahl immer eine gut lesbare Verteilung: der/die am
 * stärksten trainierte(n) Muskel(n) leuchten immer in der hellsten
 * Lime-Stufe, unbeteiligte Muskeln bleiben unbunt (kein Score -> kein Eintrag).
 */
function levelForScore(score: number, maxScore: number): MuscleLevel {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

/**
 * Aggregiert pro Muskel-Slug eine Intensität = Summe über alle
 * Plan-Übungen von (primaryMuscle-Slug: Gewicht 2, muscleGroup-/
 * secondaryMuscles-Slugs: Gewicht 1) × targetSets. Übungen ohne Eintrag in
 * `exercisesById` (gelöschte Übung) werden übersprungen.
 */
export function computePlanMuscleData(
  planExercises: readonly PlanExerciseRow[],
  exercisesById: ReadonlyMap<string, ExerciseRow>,
): PlanMuscleData {
  const scoreBySlug = new Map<BodySlug, number>();
  const contributorsBySlug = new Map<BodySlug, Set<string>>();

  for (const planExercise of planExercises) {
    const exercise = exercisesById.get(planExercise.exerciseId);
    if (!exercise) continue;
    const sets = planExercise.targetSets;

    addSlugContribution(scoreBySlug, contributorsBySlug, exercise.primaryMuscle, 2 * sets);
    addSlugContribution(scoreBySlug, contributorsBySlug, exercise.muscleGroup, 1 * sets);
    for (const secondary of parseJsonStringArray(exercise.secondaryMuscles)) {
      addSlugContribution(scoreBySlug, contributorsBySlug, secondary, 1 * sets);
    }
  }

  const levels: MuscleLevel[] = [4, 3, 2, 1];

  if (scoreBySlug.size === 0) {
    return { bodyParts: [], legend: levels.map((level) => ({ level, muscles: [] })) };
  }

  const maxScore = Math.max(...scoreBySlug.values());
  const musclesByLevel = new Map<MuscleLevel, Set<string>>(levels.map((level) => [level, new Set<string>()]));
  const bodyParts: PlanBodyPart[] = [];

  for (const [slug, score] of scoreBySlug.entries()) {
    const level = levelForScore(score, maxScore);
    bodyParts.push({ slug, intensity: level });

    const contributors = contributorsBySlug.get(slug);
    if (contributors) {
      for (const raw of contributors) {
        const label = muscleLabelDe(raw);
        if (label) musclesByLevel.get(level)?.add(label);
      }
    }
  }

  const legend: MuscleLegendEntry[] = levels.map((level) => ({
    level,
    muscles: Array.from(musclesByLevel.get(level) ?? []).sort((a, b) => a.localeCompare(b, "de-CH")),
  }));

  return { bodyParts, legend };
}

/** Default-Pausenzeit (Sekunden), falls `restSeconds` bei einer Plan-Übung fehlt. */
const DEFAULT_REST_SECONDS = 90;
/** Default-Wiederholungszahl, falls weder targetRepsMin noch -Max gesetzt sind. */
const DEFAULT_REPS = 10;
/** Angenommene Zeit pro Wiederholung während des Satzes (Sekunden). */
const SECONDS_PER_REP = 3.5;
/** Rüstzeit pro Übung (Gerät wechseln/einstellen), einmalig pro Plan-Übung. */
const SETUP_SECONDS_PER_EXERCISE = 60;

function averageReps(min: number | null | undefined, max: number | null | undefined): number {
  if (min != null && max != null) return (min + max) / 2;
  if (min != null) return min;
  if (max != null) return max;
  return DEFAULT_REPS;
}

/**
 * Schätzt die Trainingsdauer eines Plans in Minuten (aufgerundet):
 * Summe über alle Plan-Übungen von
 * `targetSets × (reps × 3.5s Arbeit + restSeconds) + 60s Rüstzeit/Übung`,
 * wobei `reps` der Mittelwert aus targetRepsMin/-Max ist (Fallback 10) und
 * fehlende `restSeconds` mit 90s (üblicher Satzpause) angenommen werden.
 */
export function estimatePlanMinutes(planExercises: readonly PlanExerciseRow[]): number {
  let totalSeconds = 0;
  for (const planExercise of planExercises) {
    const reps = averageReps(planExercise.targetRepsMin, planExercise.targetRepsMax);
    const rest = planExercise.restSeconds ?? DEFAULT_REST_SECONDS;
    totalSeconds += planExercise.targetSets * (reps * SECONDS_PER_REP + rest) + SETUP_SECONDS_PER_EXERCISE;
  }
  return Math.ceil(totalSeconds / 60);
}
