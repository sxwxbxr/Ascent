import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Ionicons } from '@expo/vector-icons';
import type { Food, NutritionGoal } from '@ascent/shared';

import {
  addFoodEntry,
  addManualFoodEntry,
  addWaterEntry,
  buildDayEntriesQuery,
  buildLatestGoalQuery,
  buildLocalFoodSearchQuery,
  computeSnapshot,
  deleteFoodEntry,
  isTodayIsoDate,
  MEAL_SLOTS,
  mealSlotLabelDe,
  removeLastWaterEntry,
  searchFoodsOnline,
  setNutritionGoal,
  shiftIsoDate,
  todayIsoDate,
  type DayEntryRow,
  type MealSlot,
} from '../../src/data/nutrition';
import { useOwnerUserId } from '../../src/lib/owner';
import { Screen } from '../../src/ui/Screen';

// Ernährungs-Tab (Konzept: docs/KONZEPT_Ernaehrung.md, Abschnitt 6) —
// Tagesansicht mit Datums-Navigator, kcal-/Makro-Fortschritt, Mahlzeiten-
// Sektionen (+ Picker-Modal), Wasser-Widget, Ziele-Formular.
//
// TODO(Entitlements): kein mobiles Entitlement-Gate vorhanden (Suche nach
// "entitlement" in apps/mobile ergab keinen Treffer) — laut Konzept Abschnitt
// 5 ist `nutrition.tracking` ohnehin auf `free` geseedet. Sobald ein mobiles
// Äquivalent zu useEntitlement existiert, HIER darauf gaten statt neu zu bauen.

const COLOR_ON_SURFACE = '#e5e2e1';
const COLOR_ON_SURFACE_MUTED = '#a0a0a0';
const COLOR_ON_PRIMARY = '#213600';

const kcalFormatter = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });
const gramFormatter = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 });
const mlFormatter = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });
const dayLabelFormatter = new Intl.DateTimeFormat('de-CH', { weekday: 'long', day: '2-digit', month: '2-digit' });

function parseIsoDateLocal(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function parseNumberInput(text: string): number | undefined {
  const normalized = text.trim().replace(',', '.');
  if (normalized === '') return undefined;
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : undefined;
}

export default function ErnaehrungScreen() {
  const ownerUserId = useOwnerUserId();
  const [loggedDate, setLoggedDate] = useState(() => todayIsoDate());
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMealSlot, setPickerMealSlot] = useState<MealSlot | null>(null);
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [waterBusy, setWaterBusy] = useState(false);

  // Placeholder-Query ('' matcht nie eine echte userId) solange die Session
  // noch lädt — hält die Hook-Reihenfolge stabil (Muster wie plans.tsx).
  const { data: entries } = useLiveQuery(buildDayEntriesQuery(ownerUserId ?? '', loggedDate), [ownerUserId, loggedDate]);
  const { data: goalRows } = useLiveQuery(buildLatestGoalQuery(ownerUserId ?? ''), [ownerUserId]);
  const goal: NutritionGoal | undefined = goalRows[0];

  const totals = useMemo(() => {
    let kcal = 0;
    let proteinG = 0;
    let carbsG = 0;
    let fatG = 0;
    let waterMl = 0;
    const byMealSlot = new Map<MealSlot, DayEntryRow[]>();
    for (const slot of MEAL_SLOTS) byMealSlot.set(slot.value, []);

    for (const entry of entries) {
      if (entry.entryType === 'water') {
        waterMl += entry.amountMl ?? 0;
        continue;
      }
      kcal += entry.kcal ?? 0;
      proteinG += entry.proteinG ?? 0;
      carbsG += entry.carbsG ?? 0;
      fatG += entry.fatG ?? 0;
      if (entry.mealSlot) byMealSlot.get(entry.mealSlot)?.push(entry);
    }

    return { kcal, proteinG, carbsG, fatG, waterMl, byMealSlot };
  }, [entries]);

  function openPicker(slot: MealSlot) {
    setPickerMealSlot(slot);
    setPickerVisible(true);
  }

  function handleDeleteEntry(entry: DayEntryRow) {
    Alert.alert('Eintrag löschen?', entry.foodName ?? 'Eintrag entfernen?', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => {
          deleteFoodEntry(entry.id).catch((err: unknown) => {
            console.error(err);
            Alert.alert('Fehler', 'Eintrag konnte nicht gelöscht werden.');
          });
        },
      },
    ]);
  }

  async function handleWaterStep(deltaMl: number) {
    if (waterBusy) return;
    setWaterBusy(true);
    try {
      if (deltaMl > 0) {
        await addWaterEntry(loggedDate, deltaMl);
      } else {
        await removeLastWaterEntry(loggedDate);
      }
    } catch (err) {
      Alert.alert('Fehler', err instanceof Error ? err.message : 'Wasser konnte nicht erfasst werden.');
    } finally {
      setWaterBusy(false);
    }
  }

  const dateLabel = dayLabelFormatter.format(parseIsoDateLocal(loggedDate));

  return (
    <Screen title="Ernährung" subtitle="Dein Ernährungstagebuch">
      {/* Datums-Navigator */}
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => setLoggedDate((d) => shiftIsoDate(d, -1))}
          hitSlop={8}
          android_ripple={{ color: 'rgba(255,255,255,0.1)', borderless: true }}
          className="h-12 w-12 items-center justify-center rounded-full active:opacity-70"
        >
          <Ionicons name="chevron-back" size={22} color={COLOR_ON_SURFACE} />
        </Pressable>
        <View className="items-center">
          <Text className="font-sans text-base font-bold capitalize text-on-surface">{dateLabel}</Text>
          {!isTodayIsoDate(loggedDate) && (
            <Pressable onPress={() => setLoggedDate(todayIsoDate())} hitSlop={6}>
              <Text className="font-sans text-xs font-semibold text-primary">Zu heute springen</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={() => setLoggedDate((d) => shiftIsoDate(d, 1))}
          hitSlop={8}
          android_ripple={{ color: 'rgba(255,255,255,0.1)', borderless: true }}
          className="h-12 w-12 items-center justify-center rounded-full active:opacity-70"
        >
          <Ionicons name="chevron-forward" size={22} color={COLOR_ON_SURFACE} />
        </Pressable>
      </View>

      {/* Kalorien-/Makro-Übersicht */}
      <View className="gap-4 rounded-xl border border-surface-container-high bg-surface-container p-4">
        <View className="flex-row items-start justify-between">
          <View>
            <Text className="font-sans text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
              Kalorien
            </Text>
            <View className="flex-row items-baseline gap-1">
              <Text className="tabular-nums font-sans text-3xl font-extrabold text-on-surface">
                {kcalFormatter.format(totals.kcal)}
              </Text>
              <Text className="font-sans text-base font-semibold text-on-surface-muted">
                {goal ? `/ ${kcalFormatter.format(goal.kcalTarget)} kcal` : 'kcal'}
              </Text>
            </View>
          </View>
          <Pressable onPress={() => setGoalModalVisible(true)} hitSlop={8} className="h-12 items-center justify-center px-1">
            <Text className="font-sans text-sm font-semibold text-on-surface-muted">
              {goal ? 'Ziel bearbeiten' : 'Ziel festlegen'}
            </Text>
          </Pressable>
        </View>

        {goal ? (
          <>
            <ProgressBar value={totals.kcal} max={goal.kcalTarget} />
            {totals.kcal > goal.kcalTarget && (
              <Text className="font-sans text-xs text-error">
                {kcalFormatter.format(totals.kcal - goal.kcalTarget)} kcal über Ziel
              </Text>
            )}
            <View className="flex-row justify-between gap-4">
              <MacroBar label="Protein" value={totals.proteinG} target={goal.proteinTargetG} />
              <MacroBar label="Kohlenhydrate" value={totals.carbsG} target={goal.carbsTargetG} />
              <MacroBar label="Fett" value={totals.fatG} target={goal.fatTargetG} />
            </View>
          </>
        ) : (
          <Text className="font-sans text-sm text-on-surface-muted">
            Noch kein Ziel gesetzt — leg eines fest, um deinen Fortschritt zu sehen.
          </Text>
        )}
      </View>

      {/* Mahlzeiten-Sektionen */}
      {MEAL_SLOTS.map((slot) => {
        const slotEntries = totals.byMealSlot.get(slot.value) ?? [];
        const slotKcal = slotEntries.reduce((sum, e) => sum + (e.kcal ?? 0), 0);
        return (
          <View key={slot.value} className="gap-2 rounded-xl border border-surface-container-high bg-surface-container p-4">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-base font-bold text-on-surface">{slot.labelDe}</Text>
              <Text className="tabular-nums font-sans text-sm text-on-surface-muted">
                {kcalFormatter.format(slotKcal)} kcal
              </Text>
            </View>

            {slotEntries.length === 0 ? (
              <Text className="font-sans text-sm text-on-surface-muted">Noch nichts erfasst.</Text>
            ) : (
              <View className="gap-1">
                {slotEntries.map((entry) => (
                  <Pressable
                    key={entry.id}
                    onLongPress={() => handleDeleteEntry(entry)}
                    android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
                    className="min-h-[48px] flex-row items-center justify-between rounded-lg bg-surface-container-high px-3 py-2 active:opacity-80"
                  >
                    <View className="flex-1 pr-2">
                      <Text numberOfLines={1} className="font-sans text-sm font-semibold text-on-surface">
                        {entry.foodName ?? 'Eintrag'}
                      </Text>
                      {entry.amountG != null && (
                        <Text className="font-sans text-xs text-on-surface-muted">{gramFormatter.format(entry.amountG)} g</Text>
                      )}
                    </View>
                    <Text className="tabular-nums font-sans text-sm font-bold text-on-surface">
                      {kcalFormatter.format(entry.kcal ?? 0)} kcal
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <Pressable
              onPress={() => openPicker(slot.value)}
              android_ripple={{ color: '#21360033' }}
              className="mt-1 min-h-[44px] flex-row items-center justify-center gap-2 rounded-lg bg-primary px-4 active:opacity-90"
            >
              <Ionicons name="add" size={18} color={COLOR_ON_PRIMARY} />
              <Text className="font-sans text-sm font-bold text-on-primary">Hinzufügen</Text>
            </Pressable>
          </View>
        );
      })}

      {/* Wasser-Widget */}
      <View className="gap-3 rounded-xl border border-surface-container-high bg-surface-container p-4">
        <View className="flex-row items-center justify-between">
          <Text className="font-sans text-base font-bold text-on-surface">Wasser</Text>
          <Text className="tabular-nums font-sans text-sm text-on-surface-muted">
            {mlFormatter.format(totals.waterMl)} ml
            {goal?.waterTargetMl ? ` / ${mlFormatter.format(goal.waterTargetMl)} ml` : ''}
          </Text>
        </View>
        {goal?.waterTargetMl ? <ProgressBar value={totals.waterMl} max={goal.waterTargetMl} /> : null}
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => void handleWaterStep(-250)}
            disabled={waterBusy}
            android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
            className="h-12 flex-1 items-center justify-center rounded-lg border border-outline active:opacity-80"
          >
            <Text className="font-sans font-bold text-on-surface">-250 ml</Text>
          </Pressable>
          <Pressable
            onPress={() => void handleWaterStep(250)}
            disabled={waterBusy}
            android_ripple={{ color: '#21360033' }}
            className="h-12 flex-1 items-center justify-center rounded-lg bg-primary active:opacity-90"
          >
            <Text className="font-sans font-bold text-on-primary">+250 ml</Text>
          </Pressable>
        </View>
      </View>

      <FoodPickerModal
        visible={pickerVisible}
        mealSlot={pickerMealSlot}
        loggedDate={loggedDate}
        ownerUserId={ownerUserId ?? ''}
        onClose={() => setPickerVisible(false)}
      />

      <GoalModal visible={goalModalVisible} onClose={() => setGoalModalVisible(false)} currentGoal={goal ?? null} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Fortschrittsbalken (Design-System: "Progress Tracks... fill is #B4FF39").
// ---------------------------------------------------------------------------

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <View className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
      <View className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </View>
  );
}

function MacroBar({ label, value, target }: { label: string; value: number; target: number | null | undefined }) {
  return (
    <View className="flex-1 gap-1">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-sans text-[10px] uppercase tracking-wide text-on-surface-muted">{label}</Text>
        <Text className="tabular-nums font-sans text-xs text-on-surface-muted">
          {gramFormatter.format(value)}
          {target ? `/${gramFormatter.format(target)}` : ''}g
        </Text>
      </View>
      {target ? <ProgressBar value={value} max={target} /> : null}
    </View>
  );
}

function NutrientPreview({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 items-center gap-0.5">
      <Text className="font-sans text-[10px] uppercase tracking-wide text-on-surface-muted">{label}</Text>
      <Text className="tabular-nums font-sans text-sm font-bold text-on-surface">{value}</Text>
    </View>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  containerClassName,
  autoFocus,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad';
  containerClassName?: string;
  autoFocus?: boolean;
}) {
  return (
    <View className={`gap-1 ${containerClassName ?? ''}`}>
      <Text className="font-sans text-xs font-semibold uppercase tracking-wide text-on-surface-muted">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLOR_ON_SURFACE_MUTED}
        keyboardType={keyboardType ?? 'default'}
        autoFocus={autoFocus}
        style={keyboardType === 'decimal-pad' ? { fontVariant: ['tabular-nums'] } : undefined}
        className="h-12 rounded-lg bg-surface px-3 font-sans text-base text-on-surface"
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Lebensmittel-Picker (Konzept Abschnitt 6): Suche (online + lokaler
// Offline-Fallback in EINER Liste, siehe Kommentar bei localResults unten) →
// Mengen-Eingabe → Hinzufügen. Manueller Schnelleintrag ganz unten als
// Offline-/Kein-Treffer-Fallback (Konzept Abschnitt 3.4).
// ---------------------------------------------------------------------------

type PickerStep = 'search' | 'amount' | 'manual';

const SEARCH_DEBOUNCE_MS = 400;
const MIN_ONLINE_SEARCH_LENGTH = 2;

function FoodPickerModal({
  visible,
  mealSlot,
  loggedDate,
  ownerUserId,
  onClose,
}: {
  visible: boolean;
  mealSlot: MealSlot | null;
  loggedDate: string;
  ownerUserId: string;
  onClose: () => void;
}) {
  const [step, setStep] = useState<PickerStep>('search');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [onlineSearching, setOnlineSearching] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);

  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [amountInput, setAmountInput] = useState('100');

  const [manualName, setManualName] = useState('');
  const [manualKcal, setManualKcal] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset bei jedem Öffnen — vermeidet Reste einer vorherigen Sitzung.
  useEffect(() => {
    if (!visible) return;
    setStep('search');
    setSearchInput('');
    setDebouncedSearch('');
    setOnlineError(null);
    setSelectedFood(null);
    setAmountInput('100');
    setManualName('');
    setManualKcal('');
    setManualProtein('');
    setManualCarbs('');
    setManualFat('');
    setSaveError(null);
  }, [visible]);

  // Debounce (400ms, Konzept 3.2/3.3 — hält das Team unter dem OFF-Rate-Limit).
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Online-Suche (GET /foods?q=): spiegelt Treffer SOFORT lokal (siehe
  // searchFoodsOnline in src/data/nutrition.ts) — die lokale useLiveQuery
  // unten (Basistabelle `foods`) pickt neue/aktualisierte Zeilen automatisch
  // auf, dadurch genügt EINE einzige Trefferliste für online+offline.
  useEffect(() => {
    if (!visible || debouncedSearch.length < MIN_ONLINE_SEARCH_LENGTH) {
      setOnlineError(null);
      return;
    }
    let cancelled = false;
    setOnlineSearching(true);
    setOnlineError(null);
    searchFoodsOnline(debouncedSearch)
      .catch((err: unknown) => {
        if (!cancelled) setOnlineError(err instanceof Error ? err.message : 'Suche fehlgeschlagen.');
      })
      .finally(() => {
        if (!cancelled) setOnlineSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, debouncedSearch]);

  const { data: localResults } = useLiveQuery(
    buildLocalFoodSearchQuery(ownerUserId, debouncedSearch, 30),
    [ownerUserId, debouncedSearch],
  );

  function selectFood(food: Food) {
    setSelectedFood(food);
    setAmountInput(food.servingSizeG != null ? String(food.servingSizeG) : '100');
    setSaveError(null);
    setStep('amount');
  }

  async function confirmAddFood() {
    if (!selectedFood || !mealSlot) return;
    const amountG = parseNumberInput(amountInput);
    if (amountG === undefined || amountG <= 0) {
      setSaveError('Bitte eine gültige Menge in Gramm eingeben.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await addFoodEntry({ foodId: selectedFood.id, amountG, mealSlot, loggedDate });
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Eintrag konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmManualAdd() {
    if (!mealSlot) return;
    const name = manualName.trim();
    const kcal = parseNumberInput(manualKcal);
    if (!name || kcal === undefined || kcal < 0) {
      setSaveError('Bitte Name und kcal ausfüllen.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await addManualFoodEntry({
        name,
        kcal,
        proteinG: parseNumberInput(manualProtein),
        carbsG: parseNumberInput(manualCarbs),
        fatG: parseNumberInput(manualFat),
        mealSlot,
        loggedDate,
      });
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Eintrag konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  }

  const previewAmountG = parseNumberInput(amountInput);
  const preview = selectedFood && previewAmountG !== undefined && previewAmountG > 0 ? computeSnapshot(selectedFood, previewAmountG) : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="max-h-[88%] rounded-t-2xl bg-surface-container p-5">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="font-sans text-lg font-bold text-on-surface">
              {mealSlot ? `${mealSlotLabelDe(mealSlot)} hinzufügen` : 'Hinzufügen'}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} className="h-12 w-12 items-center justify-center">
              <Ionicons name="close" size={22} color={COLOR_ON_SURFACE_MUTED} />
            </Pressable>
          </View>

          {step === 'search' && (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-3 pb-4">
              <View className="relative justify-center">
                <View className="absolute left-3 z-10">
                  <Ionicons name="search" size={18} color={COLOR_ON_SURFACE_MUTED} />
                </View>
                <TextInput
                  value={searchInput}
                  onChangeText={setSearchInput}
                  placeholder="Lebensmittel suchen…"
                  placeholderTextColor={COLOR_ON_SURFACE_MUTED}
                  autoFocus
                  className="h-12 rounded-lg bg-surface pl-10 pr-3 font-sans text-base text-on-surface"
                />
              </View>

              {onlineSearching && (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color={COLOR_ON_SURFACE_MUTED} />
                  <Text className="font-sans text-xs text-on-surface-muted">Sucht online…</Text>
                </View>
              )}
              {onlineError && <Text className="font-sans text-xs text-error">{onlineError}</Text>}

              {localResults.length === 0 && !onlineSearching && debouncedSearch.length > 0 && (
                <Text className="font-sans text-sm text-on-surface-muted">Keine Treffer gefunden.</Text>
              )}

              {localResults.map((food) => (
                <Pressable
                  key={food.id}
                  onPress={() => selectFood(food)}
                  android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
                  className="min-h-[56px] flex-row items-center justify-between rounded-lg bg-surface px-4 py-2 active:opacity-90"
                >
                  <View className="flex-1 pr-2">
                    <Text numberOfLines={1} className="font-sans text-base font-bold text-on-surface">
                      {food.name}
                    </Text>
                    {food.brand && (
                      <Text numberOfLines={1} className="font-sans text-xs text-on-surface-muted">
                        {food.brand}
                      </Text>
                    )}
                  </View>
                  <Text className="tabular-nums font-sans text-sm text-on-surface-muted">
                    {kcalFormatter.format(food.kcalPer100)} kcal/100g
                  </Text>
                </Pressable>
              ))}

              <Pressable
                onPress={() => {
                  setSaveError(null);
                  setStep('manual');
                }}
                android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
                className="mt-2 min-h-[48px] flex-row items-center justify-center gap-2 rounded-lg border border-outline px-4"
              >
                <Ionicons name="create-outline" size={18} color={COLOR_ON_SURFACE} />
                <Text className="font-sans font-semibold text-on-surface">Manuell erfassen</Text>
              </Pressable>
            </ScrollView>
          )}

          {step === 'amount' && selectedFood && (
            <View className="gap-4">
              <View className="rounded-lg bg-surface p-4">
                <Text className="font-sans text-base font-bold text-on-surface">{selectedFood.name}</Text>
                {selectedFood.brand && <Text className="font-sans text-xs text-on-surface-muted">{selectedFood.brand}</Text>}
              </View>

              <LabeledInput label="Menge (g)" value={amountInput} onChangeText={setAmountInput} keyboardType="decimal-pad" autoFocus />

              {preview && (
                <View className="flex-row justify-between rounded-lg bg-surface p-3">
                  <NutrientPreview label="kcal" value={kcalFormatter.format(preview.kcal)} />
                  <NutrientPreview label="Protein" value={`${gramFormatter.format(preview.proteinG ?? 0)} g`} />
                  <NutrientPreview label="KH" value={`${gramFormatter.format(preview.carbsG ?? 0)} g`} />
                  <NutrientPreview label="Fett" value={`${gramFormatter.format(preview.fatG ?? 0)} g`} />
                </View>
              )}

              {saveError && <Text className="font-sans text-sm text-error">{saveError}</Text>}

              <View className="flex-row gap-2">
                <Pressable onPress={() => setStep('search')} className="h-12 flex-1 items-center justify-center rounded-lg border border-outline">
                  <Text className="font-sans font-semibold text-on-surface">Zurück</Text>
                </Pressable>
                <Pressable
                  onPress={() => void confirmAddFood()}
                  disabled={saving}
                  className={`h-12 flex-1 items-center justify-center rounded-lg ${saving ? 'bg-primary/40' : 'bg-primary'}`}
                >
                  {saving ? <ActivityIndicator color={COLOR_ON_PRIMARY} /> : <Text className="font-sans font-bold text-on-primary">Hinzufügen</Text>}
                </Pressable>
              </View>
            </View>
          )}

          {step === 'manual' && (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-3 pb-4">
              <Text className="font-sans text-xs text-on-surface-muted">Kein Treffer oder offline? Trag die Werte direkt ein.</Text>
              <LabeledInput label="Name" value={manualName} onChangeText={setManualName} placeholder="z. B. Apfel" autoFocus />
              <View className="flex-row gap-2">
                <LabeledInput
                  label="kcal"
                  value={manualKcal}
                  onChangeText={setManualKcal}
                  keyboardType="decimal-pad"
                  containerClassName="flex-1"
                />
                <LabeledInput
                  label="Protein (g)"
                  value={manualProtein}
                  onChangeText={setManualProtein}
                  keyboardType="decimal-pad"
                  containerClassName="flex-1"
                />
              </View>
              <View className="flex-row gap-2">
                <LabeledInput
                  label="KH (g)"
                  value={manualCarbs}
                  onChangeText={setManualCarbs}
                  keyboardType="decimal-pad"
                  containerClassName="flex-1"
                />
                <LabeledInput
                  label="Fett (g)"
                  value={manualFat}
                  onChangeText={setManualFat}
                  keyboardType="decimal-pad"
                  containerClassName="flex-1"
                />
              </View>

              {saveError && <Text className="font-sans text-sm text-error">{saveError}</Text>}

              <View className="flex-row gap-2">
                <Pressable onPress={() => setStep('search')} className="h-12 flex-1 items-center justify-center rounded-lg border border-outline">
                  <Text className="font-sans font-semibold text-on-surface">Zurück</Text>
                </Pressable>
                <Pressable
                  onPress={() => void confirmManualAdd()}
                  disabled={saving}
                  className={`h-12 flex-1 items-center justify-center rounded-lg ${saving ? 'bg-primary/40' : 'bg-primary'}`}
                >
                  {saving ? <ActivityIndicator color={COLOR_ON_PRIMARY} /> : <Text className="font-sans font-bold text-on-primary">Hinzufügen</Text>}
                </Pressable>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ziele-Formular (Konzept Abschnitt 6): kcalTarget Pflicht, Rest optional.
// ---------------------------------------------------------------------------

function GoalModal({
  visible,
  onClose,
  currentGoal,
}: {
  visible: boolean;
  onClose: () => void;
  currentGoal: NutritionGoal | null;
}) {
  const [kcalTarget, setKcalTarget] = useState('');
  const [proteinTarget, setProteinTarget] = useState('');
  const [carbsTarget, setCarbsTarget] = useState('');
  const [fatTarget, setFatTarget] = useState('');
  const [waterTarget, setWaterTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setKcalTarget(currentGoal ? String(currentGoal.kcalTarget) : '');
    setProteinTarget(currentGoal?.proteinTargetG != null ? String(currentGoal.proteinTargetG) : '');
    setCarbsTarget(currentGoal?.carbsTargetG != null ? String(currentGoal.carbsTargetG) : '');
    setFatTarget(currentGoal?.fatTargetG != null ? String(currentGoal.fatTargetG) : '');
    setWaterTarget(currentGoal?.waterTargetMl != null ? String(currentGoal.waterTargetMl) : '');
    setError(null);
  }, [visible, currentGoal]);

  async function handleSave() {
    const kcal = parseNumberInput(kcalTarget);
    if (kcal === undefined || kcal <= 0) {
      setError('Bitte ein gültiges kcal-Ziel eingeben.');
      return;
    }
    const waterMl = parseNumberInput(waterTarget);

    setSaving(true);
    setError(null);
    try {
      await setNutritionGoal({
        kcalTarget: Math.round(kcal),
        proteinTargetG: parseNumberInput(proteinTarget),
        carbsTargetG: parseNumberInput(carbsTarget),
        fatTargetG: parseNumberInput(fatTarget),
        waterTargetMl: waterMl !== undefined ? Math.round(waterMl) : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ziel konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <View className="w-full gap-4 rounded-xl bg-surface-container p-5">
          <Text className="font-sans text-xl font-bold text-on-surface">Ernährungsziel</Text>

          <LabeledInput label="Kalorien (kcal) *" value={kcalTarget} onChangeText={setKcalTarget} keyboardType="decimal-pad" />
          <View className="flex-row gap-2">
            <LabeledInput label="Protein (g)" value={proteinTarget} onChangeText={setProteinTarget} keyboardType="decimal-pad" containerClassName="flex-1" />
            <LabeledInput label="KH (g)" value={carbsTarget} onChangeText={setCarbsTarget} keyboardType="decimal-pad" containerClassName="flex-1" />
          </View>
          <View className="flex-row gap-2">
            <LabeledInput label="Fett (g)" value={fatTarget} onChangeText={setFatTarget} keyboardType="decimal-pad" containerClassName="flex-1" />
            <LabeledInput label="Wasser (ml)" value={waterTarget} onChangeText={setWaterTarget} keyboardType="decimal-pad" containerClassName="flex-1" />
          </View>

          {error && <Text className="font-sans text-sm text-error">{error}</Text>}

          <View className="mt-1 flex-row justify-end gap-2">
            <Pressable onPress={onClose} disabled={saving} className="h-12 items-center justify-center px-4 active:opacity-70">
              <Text className="font-sans text-base text-on-surface-muted">Abbrechen</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleSave()}
              disabled={saving}
              android_ripple={{ color: '#21360033' }}
              className={`h-12 items-center justify-center rounded-lg px-5 active:opacity-90 ${saving ? 'bg-primary/40' : 'bg-primary'}`}
            >
              {saving ? <ActivityIndicator color={COLOR_ON_PRIMARY} /> : <Text className="font-sans text-base font-bold text-on-primary">Speichern</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
