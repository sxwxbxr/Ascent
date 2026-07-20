/**
 * Deutsche Anzeige-Labels für die (englischsprachige) Übungsdatenbank-Taxonomie
 * (Import aus `hasaneyldrm/exercises-dataset`, siehe CLAUDE.md). Rohwerte
 * bleiben überall die Filter-/Vergleichsschlüssel (category, primaryMuscle,
 * equipment) — hier nur die Anzeige.
 *
 * MUSCLE_LABELS_DE/CATEGORY_LABELS_DE sind bewusst 1:1 aus
 * `apps/mobile/src/data/exercises.ts` übernommen (gleiche Datenlage, gleiche
 * Übersetzungen), damit App und Web-Dashboard konsistent beschriften.
 */

/** Deutsches Label je Zielmuskel-Rohwert (ExerciseDB-Taxonomie). */
export const MUSCLE_LABELS_DE: Readonly<Record<string, string>> = {
  abs: "Bauch",
  lats: "Latissimus",
  quads: "Quadrizeps",
  calves: "Waden",
  pectorals: "Brust",
  delts: "Schultern",
  biceps: "Bizeps",
  triceps: "Trizeps",
  glutes: "Gesäss",
  hamstrings: "Beinbeuger",
  traps: "Trapez",
  forearms: "Unterarme",
  spine: "unterer Rücken",
  "cardiovascular system": "Cardio",
  "upper back": "oberer Rücken",
  adductors: "Adduktoren",
  abductors: "Abduktoren",
  "serratus anterior": "Sägemuskel",
  "levator scapulae": "Nacken",
  ankles: "Fussgelenke",
};

/** Deutsches Label für einen Zielmuskel-Rohwert; unbekannte/fehlende Werte fallen auf das Original bzw. `null` zurück. */
export function muscleLabelDe(muscle: string | null | undefined): string | null {
  if (!muscle) return null;
  return MUSCLE_LABELS_DE[muscle] ?? muscle;
}

/** Die 10 Kategoriewerte der Übungsdatenbank (englisch in der DB) mit deutschem Anzeigelabel. */
export const CATEGORY_LABELS_DE: Readonly<Record<string, string>> = {
  back: "Rücken",
  cardio: "Cardio",
  chest: "Brust",
  "lower arms": "Unterarme",
  "lower legs": "Unterschenkel",
  neck: "Nacken",
  shoulders: "Schultern",
  "upper arms": "Oberarme",
  "upper legs": "Oberschenkel",
  waist: "Rumpf",
};

/** Deutsches Label für einen Kategoriewert; unbekannte/fehlende Werte fallen auf das Original bzw. `null` zurück. */
export function categoryLabelDe(category: string | null | undefined): string | null {
  if (!category) return null;
  return CATEGORY_LABELS_DE[category] ?? category;
}

/** Zeigt Equipment-Rohwerte (z. B. "body weight") kapitalisiert an ("Body Weight") — Anzeige-only, Rohwert bleibt Filterschlüssel. */
export function capitalizeWords(value: string): string {
  return value
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** Minimale Form, die für die Namens-Präferenz nötig ist — strukturell kompatibel zu `ExerciseRow`. */
export interface NamedExercise {
  name: string;
  nameDe?: string | null;
}

/** Bevorzugter Anzeigename einer Übung: deutscher Name falls vorhanden, sonst der (meist englische) Originalname. */
export function exerciseName(exercise: NamedExercise): string {
  return exercise.nameDe ?? exercise.name;
}
