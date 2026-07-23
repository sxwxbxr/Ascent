/**
 * Helper für das Ernährungs-Modul (docs/KONZEPT_Ernaehrung.md, Abschnitte 2/6/7):
 * Mahlzeiten-Slot-Labels, Datums-Arithmetik auf ISO-Tagen (YYYY-MM-DD), die
 * Nährwert-Snapshot-Berechnung (kcal/Makros je Menge aus den `*Per100`-Werten
 * eines `foods`-Eintrags, Konzept Abschnitt 2.2) sowie die kcal-Trend-
 * Aggregation für die Statistik-Karte (Abschnitt 7). Bewusst reine Funktionen
 * ohne React-Abhängigkeit, damit sie sich leicht isoliert nachvollziehen
 * lassen – analog zu `packages/shared/src/progression.ts` fürs Kraft-Modul.
 */
import type { FoodEntryRow, FoodRow, NutritionGoalRow } from "./snapshot";

/** Reihenfolge der Mahlzeiten-Slots im Tagebuch (Konzept Abschnitt 6, Web/App identisch). */
export const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_SLOT_LABELS_DE: Readonly<Record<MealSlot, string>> = {
  breakfast: "Frühstück",
  lunch: "Mittag",
  dinner: "Abend",
  snack: "Snack",
};

function isoDateFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Heutiges Datum als ISO-Tag (YYYY-MM-DD), lokale Zeitzone. */
export function todayIso(): string {
  return isoDateFromDate(new Date());
}

/** ISO-Tag um `days` verschoben (negativ = zurück, positiv = vor). */
export function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + days);
  return isoDateFromDate(date);
}

/** Deutsches Anzeigedatum (de-CH) aus einem ISO-Tag, z. B. "Mi., 23.07.2026". */
export function formatIsoDateDe(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  return date.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Nährwerte für `amountG` Gramm eines Lebensmittels (OFF-Konvention: Werte je 100 g/ml). */
export interface ComputedNutrients {
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

type FoodNutrientBasis = Pick<FoodRow, "kcalPer100" | "proteinPer100" | "carbsPer100" | "fatPer100">;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Berechnet den Nährwert-Snapshot für eine erfasste Menge (Konzept 2.2: die
 * kcal/Makros werden zum Erfassungszeitpunkt eingefroren und mit dem
 * `food_entries`-Eintrag gespeichert, nicht jedes Mal aus `foods` neu
 * berechnet).
 */
export function computeNutrients(food: FoodNutrientBasis, amountG: number): ComputedNutrients {
  const factor = amountG / 100;
  return {
    kcal: round1(food.kcalPer100 * factor),
    proteinG: food.proteinPer100 != null ? round1(food.proteinPer100 * factor) : null,
    carbsG: food.carbsPer100 != null ? round1(food.carbsPer100 * factor) : null,
    fatG: food.fatPer100 != null ? round1(food.fatPer100 * factor) : null,
  };
}

/**
 * Das aktuell gültige Ernährungsziel: das mit dem neuesten `effectiveFrom`
 * (Tie-Break: neuestes `createdAt`). Für V1 reicht "immer das neueste Ziel"
 * (Konzept Abschnitt 2.3/9.5) – keine rückwirkende Auswertung nach Datum.
 */
export function latestGoal(goals: NutritionGoalRow[]): NutritionGoalRow | null {
  let best: NutritionGoalRow | null = null;
  for (const goal of goals) {
    if (!best || goal.effectiveFrom > best.effectiveFrom) {
      best = goal;
    } else if (goal.effectiveFrom === best.effectiveFrom && goal.createdAt > best.createdAt) {
      best = goal;
    }
  }
  return best;
}

/** Summe Wasser (ml) für einen bestimmten Tag. */
export function sumWaterMl(entries: FoodEntryRow[], isoDate: string): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.entryType === "water" && entry.loggedDate === isoDate) {
      total += entry.amountMl ?? 0;
    }
  }
  return total;
}

/** kcal-Tagessumme je `loggedDate` (nur `entryType: 'food'`), aufsteigend sortiert. */
export interface DailyKcalPoint {
  date: string;
  kcal: number;
}

/**
 * Reine historische Aggregation für den kcal-Trend-Chart (Konzept Abschnitt
 * 7) – KEIN Regressions-/Trendlinien-Modell wie `strengthTrend`, weil hier
 * nichts vorhergesagt wird, nur Vergangenheit gruppiert/summiert wird.
 */
export function dailyKcalTrend(entries: FoodEntryRow[]): DailyKcalPoint[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.entryType !== "food") continue;
    totals.set(entry.loggedDate, (totals.get(entry.loggedDate) ?? 0) + (entry.kcal ?? 0));
  }
  return Array.from(totals.entries())
    .map(([date, kcal]) => ({ date, kcal: round1(kcal) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Parst ein optionales Zahlenfeld aus einem Formular-Input; leer/ungültig -> undefined (Feld bleibt unangetastet/leer). */
export function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}
