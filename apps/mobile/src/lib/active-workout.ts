import { getActiveWorkout } from '../data/workouts';

/**
 * Schlanker Modul-Store für die aktive Workout-ID. Die Datenbank bleibt die
 * Quelle der Wahrheit (siehe getActiveWorkout in ../data/workouts) — dieser
 * Cache dient nur dem synchronen Zugriff (z. B. Navigations-Guards), ohne bei
 * jedem Zugriff erneut awaiten zu müssen. src/data/workouts.ts hält ihn bei
 * startWorkout/finishWorkout/cancelWorkout automatisch aktuell.
 *
 * Hinweis zyklischer Import: data/workouts.ts importiert umgekehrt
 * setCachedActiveWorkoutId von hier. Das ist unproblematisch, weil beide
 * Seiten die importierte Funktion nur innerhalb von Funktionsrümpfen aufrufen
 * (nie beim Modul-Laden selbst) — ein bei CommonJS/Metro sicheres Muster.
 */

let cachedActiveWorkoutId: string | null = null;

export function getCachedActiveWorkoutId(): string | null {
  return cachedActiveWorkoutId;
}

export function setCachedActiveWorkoutId(id: string | null): void {
  cachedActiveWorkoutId = id;
}

/**
 * Beim App-Start (oder wann immer ein frischer Check nötig ist) aufzurufen:
 * fragt die DB nach einem laufenden Workout (finishedAt IS NULL, deleted=false)
 * und synchronisiert den Modul-Cache — ermöglicht Resume nach Force-Kill/
 * Neustart der App.
 */
export async function resumeActiveWorkout(): Promise<string | null> {
  const rows = await getActiveWorkout();
  cachedActiveWorkoutId = rows[0]?.id ?? null;
  return cachedActiveWorkoutId;
}
