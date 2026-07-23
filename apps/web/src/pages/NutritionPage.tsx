import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ApiError, api } from "../lib/api";
import { useEntitlement } from "../lib/entitlements";
import {
  MEAL_SLOTS,
  MEAL_SLOT_LABELS_DE,
  computeNutrients,
  dailyKcalTrend,
  formatIsoDateDe,
  latestGoal,
  parseOptionalNumber,
  shiftIsoDate,
  sumWaterMl,
  todayIso,
} from "../lib/nutrition";
import type { MealSlot } from "../lib/nutrition";
import { useSnapshot } from "../lib/snapshot";
import type { FoodEntryRow, FoodRow } from "../lib/snapshot";
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_PRIMARY_COLOR,
  CHART_TOOLTIP_BG,
  CHART_TOOLTIP_BORDER,
  CHART_TREND_COLOR,
} from "./DashboardPage";

/** Feature-Keys (docs/KONZEPT_Ernaehrung.md Abschnitt 5) – Gating ausschliesslich über useEntitlement, nie hartcodiert. */
const NUTRITION_TRACKING_FEATURE = "nutrition.tracking";
const WATER_TRACKING_FEATURE = "nutrition.water_tracking";
const STATS_WEB_FEATURE = "nutrition.stats.web";

/** Debounce für die Lebensmittelsuche (Konzept Abschnitt 3.3: hält das Team unter dem OFF-Rate-Limit). */
const SEARCH_DEBOUNCE_MS = 400;
/** Mindestlänge der Sucheingabe, ab der überhaupt gesucht wird. */
const MIN_QUERY_LENGTH = 2;
/** Schrittgrösse des Wasser-Steppers (Konzept Abschnitt 6). */
const WATER_STEP_ML = 250;

function formatNumber(value: number): string {
  return value.toLocaleString("de-CH");
}

/**
 * Anzeigename eines Tagebuch-Eintrags: über `foodId` aus dem Snapshot
 * aufgelöst, sonst der generische Schnelleintrags-Hinweis – `food_entries`
 * selbst trägt (bewusst laut Konzept 2.2) keinen eigenen Namen, nur den
 * Nährwert-Snapshot.
 */
function entryLabel(entry: FoodEntryRow, foodsById: Map<string, FoodRow>): string {
  if (entry.foodId) {
    const food = foodsById.get(entry.foodId);
    if (food) return food.brand ? `${food.name} · ${food.brand}` : food.name;
    return "Lebensmittel (nicht mehr verfügbar)";
  }
  return "Schnelleintrag (ohne Datenbanktreffer)";
}

interface ProgressBarProps {
  label: string;
  current: number;
  target: number | null | undefined;
  unit: string;
}

/** Balken "Ist vs. Ziel" für kcal/Makros – ohne Ziel nur der reine Ist-Wert. */
function ProgressBar({ label, current, target, unit }: ProgressBarProps) {
  const hasTarget = target != null && target > 0;
  const pct = hasTarget ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const over = hasTarget && current > target;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
        <span>{label}</span>
        <span className={over ? "text-error" : "text-on-surface"}>
          {formatNumber(Math.round(current))}
          {hasTarget ? ` / ${formatNumber(target)}` : ""} {unit}
        </span>
      </div>
      {hasTarget && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
          <div
            className={`h-full rounded-full transition-[width] ${over ? "bg-error" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Formularzustand für die Inline-Bearbeitung eines einzelnen Tagebuch-Eintrags. */
interface EditState {
  entryId: string;
  amountG: string;
  kcal: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
}

/**
 * Ernährungs-Tagebuch (Route `/ernaehrung`, docs/KONZEPT_Ernaehrung.md
 * Abschnitt 6 Web + Abschnitt 7 Statistik). Datenquelle für das Tagebuch
 * selbst ist ausschliesslich der Snapshot (`useSnapshot`); die Lebensmittel-
 * suche im Modal ruft dagegen live `GET /foods?q=` auf (Cache-First +
 * OFF-Fallback serverseitig, siehe apps/api/src/routes/foods.ts) – nach jeder
 * Schreiboperation wird `reload()` aufgerufen, damit neu gecachte Lebensmittel
 * und neue Einträge sofort überall konsistent sind.
 */
export function NutritionPage() {
  const hasTracking = useEntitlement(NUTRITION_TRACKING_FEATURE);
  const hasWaterTracking = useEntitlement(WATER_TRACKING_FEATURE);
  const hasStatsWeb = useEntitlement(STATS_WEB_FEATURE);
  const { snapshot, loading, error, reload } = useSnapshot();

  const [selectedDate, setSelectedDate] = useState(() => todayIso());

  // Lebensmittel-Suche-Modal (Konzept 3.3/6): `addModalSlot` ist zugleich der
  // "ist offen"-Zustand (null = geschlossen) und der voreingestellte
  // Mahlzeiten-Slot, aus dessen Sektion "+ Hinzufügen" geklickt wurde.
  const [addModalSlot, setAddModalSlot] = useState<MealSlot | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FoodRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedFood, setSelectedFood] = useState<FoodRow | null>(null);
  const [amountInput, setAmountInput] = useState("100");
  const [manualMode, setManualMode] = useState(false);
  const [manualKcal, setManualKcal] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs] = useState("");
  const [manualFat, setManualFat] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [diaryError, setDiaryError] = useState<string | null>(null);

  const [waterBusy, setWaterBusy] = useState(false);
  const [waterError, setWaterError] = useState<string | null>(null);

  const [goalKcalInput, setGoalKcalInput] = useState("");
  const [goalProteinInput, setGoalProteinInput] = useState("");
  const [goalCarbsInput, setGoalCarbsInput] = useState("");
  const [goalFatInput, setGoalFatInput] = useState("");
  const [goalWaterInput, setGoalWaterInput] = useState("");
  const [goalSubmitting, setGoalSubmitting] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);

  // Debounced Lebensmittelsuche (Konzept 3.3: 400-500 ms, hier 400 ms).
  useEffect(() => {
    if (addModalSlot === null || manualMode) return;
    const trimmed = searchQuery.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSearchResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timeoutId = window.setTimeout(() => {
      api
        .get<FoodRow[]>(`/foods?q=${encodeURIComponent(trimmed)}`)
        .then((rows) => {
          setSearchResults(rows);
          setSearchError(null);
        })
        .catch((err) => {
          setSearchError(err instanceof ApiError ? err.message : "Suche fehlgeschlagen.");
        })
        .finally(() => setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [searchQuery, addModalSlot, manualMode]);

  const foodsById = useMemo(() => new Map(snapshot.foods.map((food) => [food.id, food])), [snapshot.foods]);

  const foodEntriesForDate = useMemo(
    () => snapshot.foodEntries.filter((entry) => entry.entryType === "food" && entry.loggedDate === selectedDate),
    [snapshot.foodEntries, selectedDate],
  );

  const entriesBySlot = useMemo(() => {
    const map = new Map<MealSlot, FoodEntryRow[]>();
    for (const slot of MEAL_SLOTS) map.set(slot, []);
    for (const entry of foodEntriesForDate) {
      const slot: MealSlot = entry.mealSlot ?? "snack";
      map.get(slot)?.push(entry);
    }
    for (const list of map.values()) list.sort((a, b) => a.loggedAt - b.loggedAt);
    return map;
  }, [foodEntriesForDate]);

  const totals = useMemo(() => {
    let kcal = 0;
    let proteinG = 0;
    let carbsG = 0;
    let fatG = 0;
    for (const entry of foodEntriesForDate) {
      kcal += entry.kcal ?? 0;
      proteinG += entry.proteinG ?? 0;
      carbsG += entry.carbsG ?? 0;
      fatG += entry.fatG ?? 0;
    }
    return { kcal, proteinG, carbsG, fatG };
  }, [foodEntriesForDate]);

  const waterMl = useMemo(() => sumWaterMl(snapshot.foodEntries, selectedDate), [snapshot.foodEntries, selectedDate]);
  const goal = useMemo(() => latestGoal(snapshot.nutritionGoals), [snapshot.nutritionGoals]);
  const kcalTrendData = useMemo(() => dailyKcalTrend(snapshot.foodEntries), [snapshot.foodEntries]);

  function openAddModal(slot: MealSlot) {
    setAddModalSlot(slot);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError(null);
    setSelectedFood(null);
    setAmountInput("100");
    setManualMode(false);
    setManualKcal("");
    setManualName("");
    setManualProtein("");
    setManualCarbs("");
    setManualFat("");
    setAddError(null);
  }

  function closeAddModal() {
    setAddModalSlot(null);
  }

  function selectFood(food: FoodRow) {
    setSelectedFood(food);
    setAmountInput(food.servingSizeG != null ? String(food.servingSizeG) : "100");
  }

  async function submitSelectedFood() {
    if (!selectedFood || addModalSlot === null) return;
    const amountG = Number.parseFloat(amountInput);
    if (!Number.isFinite(amountG) || amountG <= 0) {
      setAddError("Bitte eine gültige Menge (g) eingeben.");
      return;
    }

    setAddSubmitting(true);
    setAddError(null);
    const nutrients = computeNutrients(selectedFood, amountG);
    try {
      await api.post("/food-entries", {
        entryType: "food",
        foodId: selectedFood.id,
        loggedDate: selectedDate,
        mealSlot: addModalSlot,
        amountG,
        kcal: nutrients.kcal,
        proteinG: nutrients.proteinG ?? undefined,
        carbsG: nutrients.carbsG ?? undefined,
        fatG: nutrients.fatG ?? undefined,
        loggedAt: Date.now(),
      });
      await reload();
      closeAddModal();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Eintrag konnte nicht gespeichert werden.");
    } finally {
      setAddSubmitting(false);
    }
  }

  async function submitManualEntry() {
    if (addModalSlot === null) return;
    const name = manualName.trim();
    if (!name) {
      setAddError("Bitte einen Namen eingeben.");
      return;
    }
    const kcal = Number.parseFloat(manualKcal);
    if (!Number.isFinite(kcal) || kcal < 0) {
      setAddError("Bitte eine gültige kcal-Menge eingeben.");
      return;
    }

    setAddSubmitting(true);
    setAddError(null);
    try {
      // Konsistent mit der App (src/data/nutrition.ts addManualFoodEntry):
      // manueller Eintrag = eigenes Lebensmittel (source 'custom') mit Namen,
      // dann ein 100-g-Eintrag darauf. So bleibt der Name erhalten und das
      // Lebensmittel ist wiederverwendbar — die eingegebenen Werte gelten als
      // "pro 100 g" (Menge 100), der Snapshot ist damit identisch zur Eingabe.
      const protein = parseOptionalNumber(manualProtein);
      const carbs = parseOptionalNumber(manualCarbs);
      const fat = parseOptionalNumber(manualFat);
      const food = await api.post<FoodRow>("/foods", {
        name,
        kcalPer100: kcal,
        proteinPer100: protein,
        carbsPer100: carbs,
        fatPer100: fat,
      });
      await api.post("/food-entries", {
        entryType: "food",
        foodId: food.id,
        loggedDate: selectedDate,
        mealSlot: addModalSlot,
        amountG: 100,
        kcal,
        proteinG: protein,
        carbsG: carbs,
        fatG: fat,
        loggedAt: Date.now(),
      });
      await reload();
      closeAddModal();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Eintrag konnte nicht gespeichert werden.");
    } finally {
      setAddSubmitting(false);
    }
  }

  function startEdit(entry: FoodEntryRow) {
    setEditError(null);
    setEditState({
      entryId: entry.id,
      amountG: entry.amountG != null ? String(entry.amountG) : "",
      kcal: entry.kcal != null ? String(entry.kcal) : "",
      proteinG: entry.proteinG != null ? String(entry.proteinG) : "",
      carbsG: entry.carbsG != null ? String(entry.carbsG) : "",
      fatG: entry.fatG != null ? String(entry.fatG) : "",
    });
  }

  async function saveEdit(entry: FoodEntryRow) {
    if (!editState) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      if (entry.foodId) {
        const amountG = Number.parseFloat(editState.amountG);
        if (!Number.isFinite(amountG) || amountG <= 0) {
          setEditError("Bitte eine gültige Menge (g) eingeben.");
          return;
        }
        const food = foodsById.get(entry.foodId);
        const nutrients = food
          ? computeNutrients(food, amountG)
          : { kcal: Number.parseFloat(editState.kcal) || 0, proteinG: null, carbsG: null, fatG: null };
        await api.put(`/food-entries/${entry.id}`, {
          amountG,
          kcal: nutrients.kcal,
          proteinG: nutrients.proteinG ?? undefined,
          carbsG: nutrients.carbsG ?? undefined,
          fatG: nutrients.fatG ?? undefined,
        });
      } else {
        const kcal = Number.parseFloat(editState.kcal);
        if (!Number.isFinite(kcal) || kcal < 0) {
          setEditError("Bitte eine gültige kcal-Menge eingeben.");
          return;
        }
        await api.put(`/food-entries/${entry.id}`, {
          kcal,
          proteinG: parseOptionalNumber(editState.proteinG),
          carbsG: parseOptionalNumber(editState.carbsG),
          fatG: parseOptionalNumber(editState.fatG),
        });
      }
      await reload();
      setEditState(null);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Eintrag konnte nicht gespeichert werden.");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function deleteEntry(id: string) {
    setDeletingId(id);
    setDiaryError(null);
    try {
      await api.delete(`/food-entries/${id}`);
      await reload();
    } catch (err) {
      setDiaryError(err instanceof ApiError ? err.message : "Eintrag konnte nicht gelöscht werden.");
    } finally {
      setDeletingId(null);
    }
  }

  async function addWater() {
    setWaterBusy(true);
    setWaterError(null);
    try {
      await api.post("/food-entries", {
        entryType: "water",
        loggedDate: selectedDate,
        amountMl: WATER_STEP_ML,
        loggedAt: Date.now(),
      });
      await reload();
    } catch (err) {
      setWaterError(err instanceof ApiError ? err.message : "Wasser konnte nicht erfasst werden.");
    } finally {
      setWaterBusy(false);
    }
  }

  async function removeWater() {
    const todaysWater = snapshot.foodEntries
      .filter((entry) => entry.entryType === "water" && entry.loggedDate === selectedDate)
      .sort((a, b) => b.loggedAt - a.loggedAt);
    const last = todaysWater[0];
    if (!last) return;

    setWaterBusy(true);
    setWaterError(null);
    try {
      await api.delete(`/food-entries/${last.id}`);
      await reload();
    } catch (err) {
      setWaterError(err instanceof ApiError ? err.message : "Wasser konnte nicht entfernt werden.");
    } finally {
      setWaterBusy(false);
    }
  }

  async function handleSubmitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGoalError(null);

    const kcalTarget = Number.parseInt(goalKcalInput, 10);
    if (!Number.isFinite(kcalTarget) || kcalTarget <= 0) {
      setGoalError("Bitte ein gültiges kcal-Ziel eingeben.");
      return;
    }

    setGoalSubmitting(true);
    try {
      await api.post("/nutrition-goals", {
        effectiveFrom: todayIso(),
        kcalTarget,
        proteinTargetG: parseOptionalNumber(goalProteinInput),
        carbsTargetG: parseOptionalNumber(goalCarbsInput),
        fatTargetG: parseOptionalNumber(goalFatInput),
        waterTargetMl: parseOptionalNumber(goalWaterInput),
      });
      await reload();
    } catch (err) {
      setGoalError(err instanceof ApiError ? err.message : "Ziel konnte nicht gespeichert werden.");
    } finally {
      setGoalSubmitting(false);
    }
  }

  if (!hasTracking) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-extrabold text-on-surface">Ernährung</h1>
          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-on-primary">
            Pro
          </span>
        </div>
        <div className="relative overflow-hidden rounded-lg border border-surface-container-high bg-surface-container p-10">
          <div
            className="pointer-events-none flex select-none flex-col gap-4 opacity-30 blur-[2px]"
            aria-hidden="true"
          >
            <div className="h-4 w-1/3 rounded bg-surface-container-high" />
            <div className="h-24 w-full rounded bg-surface-container-high" />
            <div className="h-4 w-1/2 rounded bg-surface-container-high" />
            <div className="h-24 w-full rounded bg-surface-container-high" />
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-on-surface">
              Ernährungs-Tagebuch, Lebensmittelsuche und Ziele sind aktuell nicht freigeschaltet.
            </p>
            <p className="text-sm text-on-surface-muted">
              Sobald das Feature aktiviert ist, erscheint hier dein Tagebuch.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-3xl font-extrabold text-on-surface">Ernährung</h1>
        <p className="text-on-surface-muted">Daten werden geladen…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-3xl font-extrabold text-on-surface">Ernährung</h1>
        <p className="text-error">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-extrabold text-on-surface">Ernährung</h1>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSelectedDate((current) => shiftIsoDate(current, -1))}
            aria-label="Vorheriger Tag"
            className="h-10 w-10 rounded-full border border-outline text-on-surface-muted transition-colors hover:text-on-surface"
          >
            ←
          </button>
          <div className="flex flex-col items-center gap-1">
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => {
                if (event.target.value) setSelectedDate(event.target.value);
              }}
              className="h-10 rounded-md border border-outline bg-surface px-3 text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-xs text-on-surface-muted">{formatIsoDateDe(selectedDate)}</span>
          </div>
          <button
            type="button"
            onClick={() => setSelectedDate((current) => shiftIsoDate(current, 1))}
            aria-label="Nächster Tag"
            className="h-10 w-10 rounded-full border border-outline text-on-surface-muted transition-colors hover:text-on-surface"
          >
            →
          </button>
          {selectedDate !== todayIso() && (
            <button
              type="button"
              onClick={() => setSelectedDate(todayIso())}
              className="text-xs font-semibold uppercase tracking-widest text-primary hover:underline"
            >
              Heute
            </button>
          )}
        </div>
      </div>

      {/* kcal-/Makro-Summe vs. Ziel */}
      <div className="rounded-lg border border-surface-container-high bg-surface-container p-6">
        <div className="flex flex-col gap-4">
          <ProgressBar label="kcal" current={totals.kcal} target={goal?.kcalTarget} unit="kcal" />
          {goal?.proteinTargetG != null && (
            <ProgressBar label="Eiweiss" current={totals.proteinG} target={goal.proteinTargetG} unit="g" />
          )}
          {goal?.carbsTargetG != null && (
            <ProgressBar label="Kohlenhydrate" current={totals.carbsG} target={goal.carbsTargetG} unit="g" />
          )}
          {goal?.fatTargetG != null && (
            <ProgressBar label="Fett" current={totals.fatG} target={goal.fatTargetG} unit="g" />
          )}
          {!goal && (
            <p className="text-sm text-on-surface-muted">
              Noch kein Ernährungsziel gesetzt — siehe Abschnitt „Ziele" weiter unten.
            </p>
          )}
        </div>
      </div>

      {/* Tagebuch nach Mahlzeiten-Slot */}
      {diaryError && (
        <p role="alert" className="text-sm text-error">
          {diaryError}
        </p>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {MEAL_SLOTS.map((slot) => {
          const entries = entriesBySlot.get(slot) ?? [];
          return (
            <div key={slot} className="rounded-lg border border-surface-container-high bg-surface-container p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                  {MEAL_SLOT_LABELS_DE[slot]}
                </h3>
                <button
                  type="button"
                  onClick={() => openAddModal(slot)}
                  className="h-8 rounded-full border border-outline px-3 text-xs font-bold uppercase tracking-widest text-on-surface-muted transition-colors hover:border-primary hover:text-on-surface"
                >
                  + Hinzufügen
                </button>
              </div>

              {entries.length === 0 ? (
                <p className="mt-3 text-sm text-on-surface-muted">Noch keine Einträge.</p>
              ) : (
                <ul className="mt-3 flex flex-col divide-y divide-surface-container-high">
                  {entries.map((entry) => (
                    <li key={entry.id} className="py-3 text-sm">
                      {editState?.entryId === entry.id ? (
                        <div className="flex flex-col gap-2">
                          {entry.foodId ? (
                            <div className="flex flex-wrap items-end gap-3">
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                                  Menge (g)
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={editState.amountG}
                                  onChange={(event) =>
                                    setEditState({ ...editState, amountG: event.target.value })
                                  }
                                  className="h-10 w-28 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                              </div>
                              <button
                                type="button"
                                disabled={editSubmitting}
                                onClick={() => void saveEdit(entry)}
                                className="h-10 rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-widest text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Speichern
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditState(null)}
                                className="h-10 rounded-md border border-outline px-4 text-xs font-bold uppercase tracking-widest text-on-surface-muted hover:text-on-surface"
                              >
                                Abbrechen
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2">
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  placeholder="kcal"
                                  value={editState.kcal}
                                  onChange={(event) => setEditState({ ...editState, kcal: event.target.value })}
                                  className="h-10 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  placeholder="Eiweiss (g)"
                                  value={editState.proteinG}
                                  onChange={(event) =>
                                    setEditState({ ...editState, proteinG: event.target.value })
                                  }
                                  className="h-10 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  placeholder="Kohlenhydrate (g)"
                                  value={editState.carbsG}
                                  onChange={(event) =>
                                    setEditState({ ...editState, carbsG: event.target.value })
                                  }
                                  className="h-10 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  placeholder="Fett (g)"
                                  value={editState.fatG}
                                  onChange={(event) => setEditState({ ...editState, fatG: event.target.value })}
                                  className="h-10 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                              </div>
                              <div className="flex gap-3">
                                <button
                                  type="button"
                                  disabled={editSubmitting}
                                  onClick={() => void saveEdit(entry)}
                                  className="h-10 rounded-md bg-primary px-4 text-xs font-bold uppercase tracking-widest text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Speichern
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditState(null)}
                                  className="h-10 rounded-md border border-outline px-4 text-xs font-bold uppercase tracking-widest text-on-surface-muted hover:text-on-surface"
                                >
                                  Abbrechen
                                </button>
                              </div>
                            </div>
                          )}
                          {editError && (
                            <p role="alert" className="text-xs text-error">
                              {editError}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-on-surface">
                              {entryLabel(entry, foodsById)}
                            </p>
                            <p className="text-xs tabular-nums text-on-surface-muted">
                              {entry.amountG != null ? `${formatNumber(entry.amountG)} g · ` : ""}
                              {Math.round(entry.kcal ?? 0)} kcal
                            </p>
                          </div>
                          <div className="flex flex-none items-center gap-3 text-xs font-bold uppercase tracking-widest">
                            <button
                              type="button"
                              onClick={() => startEdit(entry)}
                              className="text-on-surface-muted transition-colors hover:text-on-surface"
                            >
                              Bearbeiten
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === entry.id}
                              onClick={() => void deleteEntry(entry.id)}
                              className="text-on-surface-muted transition-colors hover:text-error disabled:opacity-60"
                            >
                              Löschen
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* Wasser + Ziele */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-surface-container-high bg-surface-container p-6">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">Wasser</h3>
          {hasWaterTracking ? (
            <>
              <p className="mt-3 text-2xl font-extrabold tabular-nums text-primary">
                {formatNumber(waterMl)} ml
                {goal?.waterTargetMl != null && (
                  <span className="ml-1 text-base font-semibold text-on-surface-muted">
                    / {formatNumber(goal.waterTargetMl)} ml
                  </span>
                )}
              </p>
              {goal?.waterTargetMl != null && (
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, Math.round((waterMl / goal.waterTargetMl) * 100))}%` }}
                  />
                </div>
              )}
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  disabled={waterBusy}
                  onClick={() => void removeWater()}
                  aria-label={`${WATER_STEP_ML} ml entfernen`}
                  className="h-11 w-11 rounded-full border border-outline text-lg font-bold text-on-surface-muted transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-60"
                >
                  −
                </button>
                <span className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                  {WATER_STEP_ML} ml
                </span>
                <button
                  type="button"
                  disabled={waterBusy}
                  onClick={() => void addWater()}
                  aria-label={`${WATER_STEP_ML} ml hinzufügen`}
                  className="h-11 w-11 rounded-full bg-primary text-lg font-bold text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  +
                </button>
              </div>
              {waterError && (
                <p role="alert" className="mt-2 text-xs text-error">
                  {waterError}
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-on-surface-muted">Wasser-Tracking ist aktuell nicht freigeschaltet.</p>
          )}
        </div>

        <div className="rounded-lg border border-surface-container-high bg-surface-container p-6">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">Ziele</h3>

          {goal ? (
            <p className="mt-3 text-sm text-on-surface-muted">
              Aktuelles Ziel (seit {formatIsoDateDe(goal.effectiveFrom)}): {formatNumber(goal.kcalTarget)} kcal
              {goal.proteinTargetG != null ? ` · ${formatNumber(goal.proteinTargetG)} g Eiweiss` : ""}
              {goal.carbsTargetG != null ? ` · ${formatNumber(goal.carbsTargetG)} g Kohlenhydrate` : ""}
              {goal.fatTargetG != null ? ` · ${formatNumber(goal.fatTargetG)} g Fett` : ""}
              {goal.waterTargetMl != null ? ` · ${formatNumber(goal.waterTargetMl)} ml Wasser` : ""}
            </p>
          ) : (
            <p className="mt-3 text-sm text-on-surface-muted">Noch kein Ziel gesetzt.</p>
          )}

          <form onSubmit={(event) => void handleSubmitGoal(event)} className="mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="goal-kcal"
                  className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                >
                  kcal-Ziel *
                </label>
                <input
                  id="goal-kcal"
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={goalKcalInput}
                  onChange={(event) => setGoalKcalInput(event.target.value)}
                  className="h-11 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="goal-water"
                  className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                >
                  Wasser (ml)
                </label>
                <input
                  id="goal-water"
                  type="number"
                  min="0"
                  step="50"
                  value={goalWaterInput}
                  onChange={(event) => setGoalWaterInput(event.target.value)}
                  className="h-11 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="goal-protein"
                  className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                >
                  Eiweiss (g)
                </label>
                <input
                  id="goal-protein"
                  type="number"
                  min="0"
                  step="1"
                  value={goalProteinInput}
                  onChange={(event) => setGoalProteinInput(event.target.value)}
                  className="h-11 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="goal-carbs"
                  className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                >
                  Kohlenhydrate (g)
                </label>
                <input
                  id="goal-carbs"
                  type="number"
                  min="0"
                  step="1"
                  value={goalCarbsInput}
                  onChange={(event) => setGoalCarbsInput(event.target.value)}
                  className="h-11 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="goal-fat"
                  className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                >
                  Fett (g)
                </label>
                <input
                  id="goal-fat"
                  type="number"
                  min="0"
                  step="1"
                  value={goalFatInput}
                  onChange={(event) => setGoalFatInput(event.target.value)}
                  className="h-11 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={goalSubmitting}
              className="h-11 self-start rounded-md bg-primary px-6 font-bold uppercase tracking-wide text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {goalSubmitting ? "Wird gespeichert…" : "Ziel speichern"}
            </button>
          </form>
          {goalError && (
            <p role="alert" className="mt-2 text-xs text-error">
              {goalError}
            </p>
          )}
        </div>
      </div>

      {/* kcal-Trend (Konzept Abschnitt 7): reine historische Aggregation, kein Regressionsmodell. */}
      <div className="rounded-lg border border-surface-container-high bg-surface-container p-6">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">kcal-Trend</h3>
          {!hasStatsWeb && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-on-primary">
              Pro
            </span>
          )}
        </div>

        {hasStatsWeb ? (
          kcalTrendData.length === 0 ? (
            <p className="mt-6 text-sm text-on-surface-muted">
              Noch keine Einträge vorhanden. Sobald du Mahlzeiten erfasst, erscheint hier dein kcal-Verlauf.
            </p>
          ) : (
            <div className="mt-6 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={kcalTrendData}>
                  <CartesianGrid stroke={CHART_GRID_COLOR} horizontal vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke={CHART_AXIS_COLOR}
                    tick={{ fill: CHART_AXIS_COLOR, fontSize: 12 }}
                    tickFormatter={(value: string) => formatIsoDateDe(value)}
                  />
                  <YAxis stroke={CHART_AXIS_COLOR} tick={{ fill: CHART_AXIS_COLOR, fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ background: CHART_TOOLTIP_BG, border: `1px solid ${CHART_TOOLTIP_BORDER}` }}
                    labelFormatter={(label) => formatIsoDateDe(String(label))}
                    formatter={(value) => `${value} kcal`}
                  />
                  <Line
                    type="monotone"
                    dataKey="kcal"
                    name="kcal"
                    stroke={CHART_PRIMARY_COLOR}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  {goal && (
                    <ReferenceLine
                      y={goal.kcalTarget}
                      stroke={CHART_TREND_COLOR}
                      strokeDasharray="6 4"
                      label={{ value: "Ziel", fill: CHART_AXIS_COLOR, fontSize: 12, position: "insideTopRight" }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        ) : (
          <div className="relative mt-4 overflow-hidden rounded-md">
            <div className="pointer-events-none flex select-none flex-col gap-2 opacity-30 blur-[2px]" aria-hidden="true">
              <div className="h-3 w-2/3 rounded bg-surface-container-high" />
              <div className="h-24 w-full rounded bg-surface-container-high" />
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
              <p className="text-sm text-on-surface">kcal-Trend ist aktuell nicht freigeschaltet.</p>
            </div>
          </div>
        )}
      </div>

      {/* Such-Modal "Lebensmittel hinzufügen" */}
      {addModalSlot !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeAddModal} />
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg border border-outline bg-surface-container-high p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-on-surface">Lebensmittel hinzufügen</h2>
              <button
                type="button"
                onClick={closeAddModal}
                aria-label="Schliessen"
                className="text-on-surface-muted transition-colors hover:text-on-surface"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="add-meal-slot"
                className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
              >
                Mahlzeit
              </label>
              <select
                id="add-meal-slot"
                value={addModalSlot}
                onChange={(event) => setAddModalSlot(event.target.value as MealSlot)}
                className="h-11 rounded-md border border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {MEAL_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {MEAL_SLOT_LABELS_DE[slot]}
                  </option>
                ))}
              </select>
            </div>

            {!manualMode ? (
              <>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="food-search"
                    className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                  >
                    Suche
                  </label>
                  <input
                    id="food-search"
                    type="text"
                    autoFocus
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                      setSelectedFood(null);
                    }}
                    placeholder="Lebensmittel suchen…"
                    className="h-11 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface placeholder:text-on-surface-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                {searching && <p className="text-xs text-on-surface-muted">Suche läuft…</p>}
                {searchError && (
                  <p role="alert" className="text-xs text-error">
                    {searchError}
                  </p>
                )}

                {!selectedFood && searchResults.length > 0 && (
                  <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                    {searchResults.map((food) => (
                      <li key={food.id}>
                        <button
                          type="button"
                          onClick={() => selectFood(food)}
                          className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm text-on-surface transition-colors hover:bg-surface-container"
                        >
                          <span className="font-semibold">
                            {food.name}
                            {food.brand ? ` · ${food.brand}` : ""}
                          </span>
                          <span className="text-xs tabular-nums text-on-surface-muted">
                            {Math.round(food.kcalPer100)} kcal / 100 g
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {!selectedFood && !searching && searchQuery.trim().length >= MIN_QUERY_LENGTH && searchResults.length === 0 && (
                  <p className="text-xs text-on-surface-muted">Keine Treffer.</p>
                )}

                {selectedFood && (
                  <div className="flex flex-col gap-3 rounded-md border border-outline p-4">
                    <p className="font-semibold text-on-surface">
                      {selectedFood.name}
                      {selectedFood.brand ? ` · ${selectedFood.brand}` : ""}
                    </p>
                    <div className="flex flex-col gap-2">
                      <label
                        htmlFor="food-amount"
                        className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                      >
                        Menge (g)
                      </label>
                      <input
                        id="food-amount"
                        type="number"
                        min="1"
                        step="1"
                        value={amountInput}
                        onChange={(event) => setAmountInput(event.target.value)}
                        className="h-11 w-32 rounded-md border-0 border-b-2 border-outline bg-surface px-4 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    {(() => {
                      const amountG = Number.parseFloat(amountInput);
                      if (!Number.isFinite(amountG) || amountG <= 0) return null;
                      const preview = computeNutrients(selectedFood, amountG);
                      return (
                        <p className="text-xs tabular-nums text-on-surface-muted">
                          ≈ {Math.round(preview.kcal)} kcal
                          {preview.proteinG != null ? ` · ${preview.proteinG} g Eiweiss` : ""}
                          {preview.carbsG != null ? ` · ${preview.carbsG} g Kohlenhydrate` : ""}
                          {preview.fatG != null ? ` · ${preview.fatG} g Fett` : ""}
                        </p>
                      );
                    })()}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedFood(null)}
                        className="h-11 rounded-md border border-outline px-4 text-xs font-bold uppercase tracking-widest text-on-surface-muted hover:text-on-surface"
                      >
                        Zurück
                      </button>
                      <button
                        type="button"
                        disabled={addSubmitting}
                        onClick={() => void submitSelectedFood()}
                        className="h-11 flex-1 rounded-md bg-primary px-4 font-bold uppercase tracking-wide text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {addSubmitting ? "Wird gespeichert…" : "Hinzufügen"}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setManualMode(true)}
                  className="self-start text-xs font-semibold text-primary hover:underline"
                >
                  Kein Treffer? Manuell erfassen
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-on-surface-muted">
                  Manuell erfasstes Lebensmittel — wird mit Namen als eigenes, wiederverwendbares
                  Lebensmittel gespeichert. Werte gelten als Angabe pro Portion.
                </p>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="manual-name"
                    className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                  >
                    Name *
                  </label>
                  <input
                    id="manual-name"
                    type="text"
                    value={manualName}
                    onChange={(event) => setManualName(event.target.value)}
                    className="h-11 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="manual-kcal"
                      className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                    >
                      kcal *
                    </label>
                    <input
                      id="manual-kcal"
                      type="number"
                      min="0"
                      step="1"
                      value={manualKcal}
                      onChange={(event) => setManualKcal(event.target.value)}
                      className="h-11 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="manual-protein"
                      className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                    >
                      Eiweiss (g)
                    </label>
                    <input
                      id="manual-protein"
                      type="number"
                      min="0"
                      step="0.1"
                      value={manualProtein}
                      onChange={(event) => setManualProtein(event.target.value)}
                      className="h-11 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="manual-carbs"
                      className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                    >
                      Kohlenhydrate (g)
                    </label>
                    <input
                      id="manual-carbs"
                      type="number"
                      min="0"
                      step="0.1"
                      value={manualCarbs}
                      onChange={(event) => setManualCarbs(event.target.value)}
                      className="h-11 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="manual-fat"
                      className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                    >
                      Fett (g)
                    </label>
                    <input
                      id="manual-fat"
                      type="number"
                      min="0"
                      step="0.1"
                      value={manualFat}
                      onChange={(event) => setManualFat(event.target.value)}
                      className="h-11 rounded-md border-0 border-b-2 border-outline bg-surface px-3 text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setManualMode(false)}
                    className="h-11 rounded-md border border-outline px-4 text-xs font-bold uppercase tracking-widest text-on-surface-muted hover:text-on-surface"
                  >
                    Zurück zur Suche
                  </button>
                  <button
                    type="button"
                    disabled={addSubmitting}
                    onClick={() => void submitManualEntry()}
                    className="h-11 flex-1 rounded-md bg-primary px-4 font-bold uppercase tracking-wide text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {addSubmitting ? "Wird gespeichert…" : "Eintragen"}
                  </button>
                </div>
              </div>
            )}

            {addError && (
              <p role="alert" className="text-xs text-error">
                {addError}
              </p>
            )}
          </div>
        </div>
      )}

      <footer className="text-xs text-on-surface-muted">Nährwertdaten von Open Food Facts (ODbL).</footer>
    </div>
  );
}
