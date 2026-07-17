/**
 * Übergabe-Vertrag zwischen Übungs-Picker (app/exercises, Arbeitspaket
 * "Pläne") und seinen Aufrufern (Plan-Editor, aktives Training):
 * Der Aufrufer registriert einen Handler und navigiert zu /exercises;
 * der Picker ruft bei Auswahl consumeExercisePick() auf und geht zurück.
 * Modul-lokaler Zustand reicht — es gibt nie zwei Picker gleichzeitig.
 */
export type ExercisePickHandler = (exerciseId: string) => void;

let handler: ExercisePickHandler | null = null;

export function setExercisePickHandler(h: ExercisePickHandler): void {
  handler = h;
}

export function hasExercisePickHandler(): boolean {
  return handler !== null;
}

/** Vom Picker bei Auswahl aufgerufen; konsumiert den Handler (einmalig). */
export function consumeExercisePick(exerciseId: string): void {
  const h = handler;
  handler = null;
  h?.(exerciseId);
}

export function clearExercisePickHandler(): void {
  handler = null;
}
