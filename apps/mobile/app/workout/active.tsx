import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';
import { exercises } from '@ascent/shared';

import { db } from '../../src/db/client';
import { createBodyMetric, getLatestBodyMetricWeight } from '../../src/data/body-metrics';
import {
  addSet,
  cancelWorkout,
  deleteSet,
  finishWorkout,
  getActiveWorkout,
  getLastSetsForExercise,
  getPlanExerciseBlocks,
  getWorkoutSetsWithExercise,
  sumVolume,
  updateSet,
} from '../../src/data/workouts';
import { useRestTimer } from '../../src/lib/rest-timer';
import { setExercisePickHandler } from '../../src/lib/exercise-picker';

// Aktives Training (Design: design/aktives_training) — Herzstück der App.
// Übungsblöcke aus dem Plan (falls vorhanden) + frei erfasste Übungen,
// Satz-Erfassung mit Prefill vom letzten Mal, Pausentimer, Abschluss-Summary.
//
// M6-Überarbeitung nach Gerätetest ("sieht nach Alpha einer Alpha aus"):
// - Eigener SafeArea-Header (kein Screen-Wrapper — brauchte einen speziellen
//   Dreiteiler X/Titel+Uhr/Beenden statt Screen.tsx's title+subtitle-Zeile).
//   "Beenden" fehlte vorher jedes Top-Inset und lag unter der Statusleiste.
// - Performance ("Bildschirm reagiert kaum"): Ursache war der Sekunden-
//   Ticker der Dauer als useState IM SCREEN — re-rendert vorher jede Sekunde
//   die komplette Baumstruktur inkl. aller TextInputs. Jetzt tickt NUR die
//   isolierte, memoisierte <WorkoutClock>; ExerciseBlock ist memo(); die
//   kg/Wdh-Felder sind unkontrolliert (Refs statt Screen-State pro Tastendruck).
export const numberFormatter = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });

const DEFAULT_REST_SECONDS = 90;

interface SetRow {
  id: string;
  exerciseId: string;
  exerciseName: string;
  exerciseNameDe: string | null;
  setNumber: number;
  weightKg: number;
  reps: number;
  completedAt: number;
}

interface Block {
  exerciseId: string;
  displayName: string;
  target: string | null;
  targetSets: number;
  restSeconds: number;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatWeight(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(1);
}

function formatTarget(targetSets: number, min: number | null, max: number | null): string {
  if (min !== null && max !== null) {
    return `${targetSets}×${min}–${max}`;
  }
  if (min !== null) {
    return `${targetSets}×${min}+`;
  }
  return `${targetSets} ${targetSets === 1 ? 'Satz' : 'Sätze'}`;
}

function parseNumberInput(text: string): number | undefined {
  const normalized = text.trim().replace(',', '.');
  if (normalized === '') return undefined;
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Eigenständige Uhr: NUR diese Komponente tickt jede Sekunde (eigener
 * useState/useEffect). memo() ohne Vergleichsfunktion reicht, weil `startedAt`
 * über die Lebensdauer eines aktiven Trainings konstant bleibt — der Rest des
 * Screens (Übungsblöcke, Eingabefelder) rendert dadurch nie wegen der Zeit neu.
 */
const WorkoutClock = memo(function WorkoutClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Text
      className="font-sans text-xl font-extrabold text-on-surface"
      style={{ fontVariant: ['tabular-nums'] }}
    >
      {formatElapsed(now - startedAt)}
    </Text>
  );
});

export default function ActiveWorkoutScreen() {
  const insets = useSafeAreaInsets();

  const { data: activeWorkouts, updatedAt } = useLiveQuery(getActiveWorkout());
  const activeWorkout = activeWorkouts[0];

  const { data: planBlocks } = useLiveQuery(
    getPlanExerciseBlocks(activeWorkout?.planId ?? ''),
    [activeWorkout?.planId],
  );
  const { data: allSets } = useLiveQuery(
    getWorkoutSetsWithExercise(activeWorkout?.id ?? ''),
    [activeWorkout?.id],
  );

  const [pendingExercises, setPendingExercises] = useState<Array<{ id: string; name: string }>>([]);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [summary, setSummary] = useState<{
    durationMin: number;
    exerciseCount: number;
    setCount: number;
    volumeKg: number;
  } | null>(null);

  // Optionales Körpergewicht im Abschluss-Summary (Beenden-Flow). Uncontrolled
  // wie die Satz-Felder in ExerciseBlock (Ref statt Screen-State pro
  // Tastendruck) — unproblematisch hier, weil das Modal nur beim Abschluss
  // kurz sichtbar ist, aber konsistent mit dem übrigen Datei-Muster.
  const bodyWeightDraftRef = useRef<string>('');
  const [bodyWeightPlaceholder, setBodyWeightPlaceholder] = useState<number | null>(null);

  const restTimer = useRestTimer();

  // Kein aktives Workout (mehr) und kein Abschluss-Dialog offen → zurück zu Home.
  useEffect(() => {
    if (updatedAt && !activeWorkout && !summaryVisible) {
      router.replace('/');
    }
  }, [updatedAt, activeWorkout, summaryVisible]);

  const setsByExercise = useMemo(() => {
    const map = new Map<string, SetRow[]>();
    for (const row of allSets) {
      const list = map.get(row.exerciseId);
      if (list) {
        list.push(row);
      } else {
        map.set(row.exerciseId, [row]);
      }
    }
    return map;
  }, [allSets]);

  const blocks = useMemo<Block[]>(() => {
    const result: Block[] = [];
    const seen = new Set<string>();

    for (const planExercise of planBlocks) {
      seen.add(planExercise.exerciseId);
      result.push({
        exerciseId: planExercise.exerciseId,
        displayName: planExercise.exerciseNameDe ?? planExercise.exerciseName,
        target: formatTarget(planExercise.targetSets, planExercise.targetRepsMin, planExercise.targetRepsMax),
        targetSets: planExercise.targetSets,
        restSeconds: planExercise.restSeconds ?? DEFAULT_REST_SECONDS,
      });
    }

    const adhocIds = [...setsByExercise.keys()].filter((id) => !seen.has(id));
    adhocIds.sort((a, b) => {
      const aFirst = Math.min(...(setsByExercise.get(a) ?? []).map((s) => s.completedAt));
      const bFirst = Math.min(...(setsByExercise.get(b) ?? []).map((s) => s.completedAt));
      return aFirst - bFirst;
    });
    for (const id of adhocIds) {
      seen.add(id);
      const first = setsByExercise.get(id)?.[0];
      if (!first) continue;
      result.push({
        exerciseId: id,
        displayName: first.exerciseNameDe ?? first.exerciseName,
        target: null,
        targetSets: 1,
        restSeconds: DEFAULT_REST_SECONDS,
      });
    }

    for (const pending of pendingExercises) {
      if (!seen.has(pending.id)) {
        seen.add(pending.id);
        result.push({
          exerciseId: pending.id,
          displayName: pending.name,
          target: null,
          targetSets: 1,
          restSeconds: DEFAULT_REST_SECONDS,
        });
      }
    }

    return result;
  }, [planBlocks, setsByExercise, pendingExercises]);

  const handleAddExercise = useCallback(() => {
    setExercisePickHandler((exerciseId) => {
      void db
        .select({ name: exercises.name, nameDe: exercises.nameDe })
        .from(exercises)
        .where(eq(exercises.id, exerciseId))
        .limit(1)
        .then((rows) => {
          const row = rows[0];
          setPendingExercises((prev) => [...prev, { id: exerciseId, name: row?.nameDe ?? row?.name ?? 'Übung' }]);
        });
    });
    router.push('/exercises');
  }, []);

  // X-Icon im Header: bricht das Training ab (verwirft es). Ohne erfasste
  // Sätze gibt es nichts zu verlieren → kein Dialog nötig; sonst Bestätigung,
  // weil das Verwerfen alle bisherigen Sätze löscht (anders als "Beenden").
  const handleCancelPress = useCallback(() => {
    if (!activeWorkout) return;

    if (allSets.length === 0) {
      void cancelWorkout(activeWorkout.id).then(() => router.replace('/'));
      return;
    }

    Alert.alert(
      'Training abbrechen?',
      'Alle bisher in diesem Training erfassten Sätze gehen verloren.',
      [
        { text: 'Weiter trainieren', style: 'cancel' },
        {
          text: 'Verwerfen',
          style: 'destructive',
          onPress: () => {
            void cancelWorkout(activeWorkout.id).then(() => router.replace('/'));
          },
        },
      ],
    );
  }, [activeWorkout, allSets]);

  const handleFinishPress = useCallback(() => {
    if (!activeWorkout) return;

    if (allSets.length === 0) {
      Alert.alert(
        'Training verwerfen?',
        'Es wurden noch keine Sätze erfasst — jetzt beenden verwirft das Training.',
        [
          { text: 'Weiter trainieren', style: 'cancel' },
          {
            text: 'Training verwerfen',
            style: 'destructive',
            onPress: () => {
              void cancelWorkout(activeWorkout.id).then(() => router.replace('/'));
            },
          },
        ],
      );
      return;
    }

    const durationMin = Math.max(0, Math.round((Date.now() - activeWorkout.startedAt) / 60000));
    setSummary({
      durationMin,
      exerciseCount: setsByExercise.size,
      setCount: allSets.length,
      volumeKg: sumVolume(allSets),
    });
    // Körpergewicht-Feld frisch aufsetzen: leerer Entwurf + jüngstes erfasstes
    // Gewicht als Placeholder (Prefill-Vorschlag, kein vorausgefüllter Wert).
    bodyWeightDraftRef.current = '';
    setBodyWeightPlaceholder(null);
    void getLatestBodyMetricWeight().then(setBodyWeightPlaceholder);
    setSummaryVisible(true);
  }, [activeWorkout, allSets, setsByExercise]);

  const handleConfirmFinish = useCallback(() => {
    if (!activeWorkout) return;
    // Gültiges Gewicht (>0) trackt zusätzlich einen body_metric-Eintrag; ein
    // Fehler dabei (z. B. > 500 kg) blockiert den Trainingsabschluss NICHT —
    // nur loggen (siehe createBodyMetric-Validierung in src/data/body-metrics.ts).
    const enteredWeight = parseNumberInput(bodyWeightDraftRef.current);
    void finishWorkout(activeWorkout.id).then(() => {
      if (enteredWeight !== undefined && enteredWeight > 0) {
        createBodyMetric({ weightKg: enteredWeight }).catch((err) => {
          console.log('[active] createBodyMetric fehlgeschlagen:', err);
        });
      }
      setSummaryVisible(false);
      router.replace('/');
    });
  }, [activeWorkout]);

  if (!activeWorkout) {
    return (
      <View className="flex-1 items-center justify-center bg-surface" style={{ paddingTop: insets.top }}>
        <Text className="font-sans text-on-surface-muted">Lade Training…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-surface" behavior="padding">
      {/* Eigener Header MIT SafeArea-Top-Inset — der Gerätetest zeigte den
          "Beenden"-Button kaum treffbar unter der Statusleiste. Bewusst NICHT
          der Screen-Wrapper (der hat kein Platz für den Dreiteiler X/Uhr/CTA). */}
      <View
        style={{ paddingTop: insets.top }}
        className="flex-row items-center justify-between border-b border-outline bg-surface-container px-2 pb-2"
      >
        <Pressable
          onPress={handleCancelPress}
          hitSlop={8}
          android_ripple={{ color: 'rgba(255,255,255,0.12)', radius: 24 }}
          className="h-12 w-12 items-center justify-center rounded-full active:opacity-70"
        >
          <Ionicons name="close" size={26} color="#e5e2e1" />
        </Pressable>

        <View className="flex-1 items-center px-2">
          <Text numberOfLines={1} className="font-sans text-base font-bold text-on-surface">
            {activeWorkout.planName ?? 'Freies Training'}
          </Text>
          <WorkoutClock startedAt={activeWorkout.startedAt} />
        </View>

        {/* DAS Kernproblem des Gerätetests: ein echter, satt grosser Primary-
            Button statt eines kaum sichtbaren neutralen Chips. */}
        <Pressable
          onPress={handleFinishPress}
          android_ripple={{ color: 'rgba(0,0,0,0.15)' }}
          className="h-12 items-center justify-center rounded-lg bg-primary px-5 active:opacity-90"
        >
          <Text className="font-sans text-base font-extrabold text-on-primary">Beenden</Text>
        </Pressable>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4 pb-8" keyboardShouldPersistTaps="handled">
        {blocks.map((block) => (
          <ExerciseBlock
            key={block.exerciseId}
            workoutId={activeWorkout.id}
            exerciseId={block.exerciseId}
            displayName={block.displayName}
            target={block.target}
            targetSets={block.targetSets}
            restSeconds={block.restSeconds}
            sets={setsByExercise.get(block.exerciseId) ?? []}
            onSetLogged={restTimer.start}
          />
        ))}

        <Pressable
          onPress={handleAddExercise}
          android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
          className="min-h-[48px] flex-row items-center justify-center gap-2 rounded-lg border border-outline px-4 py-3 active:opacity-80"
        >
          <Ionicons name="add" size={20} color="#e5e2e1" />
          <Text className="font-sans font-semibold text-on-surface">Übung hinzufügen</Text>
        </Pressable>
      </ScrollView>

      {restTimer.isRunning ? (
        <View className="gap-2 border-t border-outline bg-surface-container px-4 py-3">
          <View className="flex-row items-center justify-between">
            <Text className="font-sans text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
              Pause
            </Text>
            <Text
              className="font-sans text-4xl font-extrabold text-primary"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {formatElapsed(restTimer.remainingSeconds * 1000)}
            </Text>
          </View>
          <View className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
            <View
              className="h-full rounded-full bg-primary"
              style={{
                width: `${Math.max(
                  0,
                  Math.min(100, (restTimer.remainingSeconds / Math.max(restTimer.totalSeconds, 1)) * 100),
                )}%`,
              }}
            />
          </View>
          <Pressable
            onPress={restTimer.skip}
            android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
            className="min-h-[48px] flex-row items-center justify-center gap-2 rounded-lg border border-outline active:opacity-80"
          >
            <Ionicons name="play-skip-forward" size={18} color="#e5e2e1" />
            <Text className="font-sans font-semibold text-on-surface">Überspringen</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal visible={summaryVisible} transparent animationType="fade">
        <View className="flex-1 items-center justify-center bg-black/70 p-6">
          <View className="w-full gap-4 rounded-xl bg-surface-container p-6">
            <View className="items-center gap-2">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-primary">
                <Ionicons name="checkmark" size={26} color="#213600" />
              </View>
              <Text className="font-sans text-xl font-extrabold text-on-surface">Training beendet</Text>
            </View>
            {summary ? (
              <>
                <View className="flex-row justify-between">
                  <SummaryStat label="Dauer" value={`${summary.durationMin} Min`} />
                  <SummaryStat label="Übungen" value={String(summary.exerciseCount)} />
                </View>
                <View className="flex-row justify-between">
                  <SummaryStat label="Sätze" value={String(summary.setCount)} />
                  <SummaryStat label="Volumen" value={`${numberFormatter.format(summary.volumeKg)} kg`} />
                </View>
              </>
            ) : null}

            <View className="gap-2 border-t border-outline pt-4">
              <Text className="font-sans text-sm font-bold text-on-surface">Körpergewicht heute</Text>
              <View className="min-h-[48px] flex-row items-center gap-2 rounded-lg bg-surface px-3">
                <TextInput
                  defaultValue=""
                  onChangeText={(text) => {
                    bodyWeightDraftRef.current = text;
                  }}
                  placeholder={bodyWeightPlaceholder !== null ? formatWeight(bodyWeightPlaceholder) : undefined}
                  placeholderTextColor="#a0a0a0"
                  keyboardType="decimal-pad"
                  className="min-w-0 flex-1 py-0 font-sans text-lg font-bold text-on-surface"
                  style={{ fontVariant: ['tabular-nums'] }}
                />
                <Text className="font-sans text-xs text-on-surface-muted">kg</Text>
              </View>
              <Text className="font-sans text-xs text-on-surface-muted">
                Optional — wird in deinem Verlauf getrackt
              </Text>
            </View>

            <Pressable
              onPress={handleConfirmFinish}
              android_ripple={{ color: 'rgba(0,0,0,0.15)' }}
              className="mt-2 min-h-[56px] items-center justify-center rounded-lg bg-primary"
            >
              <Text className="font-sans text-lg font-extrabold uppercase tracking-wide text-on-primary">
                Fertig
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 items-center gap-1">
      <Text className="font-sans text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
        {label}
      </Text>
      <Text className="font-sans text-2xl font-extrabold text-primary" style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
    </View>
  );
}

interface ExerciseBlockProps {
  workoutId: string;
  exerciseId: string;
  displayName: string;
  target: string | null;
  targetSets: number;
  restSeconds: number;
  sets: SetRow[];
  onSetLogged: (restSeconds: number) => void;
}

/**
 * memo(): ohne das würde JEDE Sekunde (WorkoutClock-Tick weiter oben) und
 * jeder Tastendruck in einem ANDEREN Block diesen Block trotzdem neu rendern.
 * Die kg/Wdh-Felder selbst sind unkontrolliert (siehe draftsRef/editDraftRef
 * unten) — Tippen schreibt in eine Ref, nie in Screen- oder Block-State.
 */
const ExerciseBlock = memo(function ExerciseBlock({
  workoutId,
  exerciseId,
  displayName,
  target,
  targetSets,
  restSeconds,
  sets,
  onSetLogged,
}: ExerciseBlockProps) {
  const [lastSets, setLastSets] = useState<Array<{ setNumber: number; weightKg: number; reps: number }>>([]);
  const [extraRows, setExtraRows] = useState(0);
  const [editingSetNumber, setEditingSetNumber] = useState<number | null>(null);
  // Reset-Generation je Zeile: nach commitRow hochgezählt, um das unkontrollierte
  // TextInput (via key) wieder auf leer zu setzen — ohne dafür den Wert selbst
  // in Screen-State zu halten (das wäre wieder ein Re-Render pro Tastendruck).
  const [resetGen, setResetGen] = useState<Record<number, number>>({});

  const draftsRef = useRef<Record<number, { weight: string; reps: string }>>({});
  const editDraftRef = useRef<{ weight: string; reps: string }>({ weight: '', reps: '' });

  useEffect(() => {
    let cancelled = false;
    void getLastSetsForExercise(exerciseId, workoutId).then((rows) => {
      if (!cancelled) setLastSets(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [exerciseId, workoutId]);

  const rowCount = Math.max(targetSets, sets.length + 1) + extraRows;
  const rowNumbers = Array.from({ length: rowCount }, (_, i) => i + 1);

  function beginEdit(n: number, committed: SetRow): void {
    editDraftRef.current = { weight: formatWeight(committed.weightKg), reps: String(committed.reps) };
    setEditingSetNumber(n);
  }

  function commitEdit(committed: SetRow): void {
    const weight = parseNumberInput(editDraftRef.current.weight);
    const reps = parseNumberInput(editDraftRef.current.reps);
    // 0 kg zulässig (Körpergewichts-Übungen); nur negativ/leer wird abgelehnt.
    if (weight !== undefined && weight >= 0 && reps !== undefined && reps > 0) {
      void updateSet(committed.id, { weightKg: weight, reps: Math.round(reps) });
    }
    setEditingSetNumber(null);
  }

  function confirmDelete(committed: SetRow): void {
    Alert.alert(
      'Satz löschen?',
      `Satz ${committed.setNumber}: ${formatWeight(committed.weightKg)} kg × ${committed.reps}`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: () => {
            void deleteSet(committed.id);
            setEditingSetNumber((current) => (current === committed.setNumber ? null : current));
          },
        },
      ],
    );
  }

  function commitRow(n: number, placeholder?: { weightKg: number; reps: number }): void {
    const draft = draftsRef.current[n] ?? { weight: '', reps: '' };
    const weight = parseNumberInput(draft.weight) ?? placeholder?.weightKg;
    const reps = parseNumberInput(draft.reps) ?? placeholder?.reps;
    // 0 kg zulässig (Körpergewichts-Übungen ohne Zusatzgewicht); nur negatives
    // oder fehlendes Gewicht wird abgelehnt. Wiederholungen müssen > 0 sein.
    if (weight === undefined || weight < 0 || reps === undefined || reps <= 0) {
      return;
    }
    void addSet({ workoutId, exerciseId, setNumber: n, weightKg: weight, reps: Math.round(reps) }).then(() => {
      onSetLogged(restSeconds);
    });
    delete draftsRef.current[n];
    setResetGen((prev) => ({ ...prev, [n]: (prev[n] ?? 0) + 1 }));
  }

  return (
    <View className="gap-3 rounded-xl bg-surface-container p-4">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-sans text-lg font-bold text-on-surface">{displayName}</Text>
        {target ? <Text className="font-sans text-sm font-semibold text-on-surface-muted">{target}</Text> : null}
      </View>

      <View className="gap-2">
        {rowNumbers.map((n) => {
          const committed = sets.find((s) => s.setNumber === n);

          if (committed && editingSetNumber === n) {
            return (
              <View key={n} className="flex-row items-center gap-2" style={{ minHeight: 56 }}>
                <Text
                  className="w-6 text-center font-sans text-sm text-on-surface-muted"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {n}
                </Text>
                <View className="min-h-[48px] flex-1 flex-row items-center justify-center gap-1 rounded-lg bg-surface px-2">
                  <TextInput
                    defaultValue={editDraftRef.current.weight}
                    onChangeText={(text) => {
                      editDraftRef.current = { ...editDraftRef.current, weight: text };
                    }}
                    keyboardType="decimal-pad"
                    autoFocus
                    className="min-w-0 flex-1 py-0 text-right font-sans text-lg font-bold text-on-surface"
                    style={{ fontVariant: ['tabular-nums'] }}
                  />
                  <Text className="font-sans text-xs text-on-surface-muted">kg</Text>
                </View>
                <View className="min-h-[48px] w-20 flex-row items-center justify-center gap-1 rounded-lg bg-surface px-2">
                  <TextInput
                    defaultValue={editDraftRef.current.reps}
                    onChangeText={(text) => {
                      editDraftRef.current = { ...editDraftRef.current, reps: text };
                    }}
                    keyboardType="number-pad"
                    className="min-w-0 flex-1 py-0 text-right font-sans text-lg font-bold text-on-surface"
                    style={{ fontVariant: ['tabular-nums'] }}
                  />
                  <Text className="font-sans text-xs text-on-surface-muted">Wdh</Text>
                </View>
                <Pressable
                  onPress={() => commitEdit(committed)}
                  android_ripple={{ color: 'rgba(0,0,0,0.15)' }}
                  hitSlop={4}
                  className="h-12 w-12 items-center justify-center rounded-full bg-primary"
                >
                  <Ionicons name="checkmark" size={22} color="#213600" />
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(committed)}
                  android_ripple={{ color: 'rgba(255,180,171,0.15)' }}
                  hitSlop={4}
                  className="h-12 w-12 items-center justify-center rounded-full border-2 border-error"
                >
                  <Ionicons name="trash" size={18} color="#ffb4ab" />
                </Pressable>
              </View>
            );
          }

          if (committed) {
            return (
              <Pressable
                key={n}
                onPress={() => beginEdit(n, committed)}
                onLongPress={() => confirmDelete(committed)}
                android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
                className="flex-row items-center gap-2 rounded-lg bg-surface-container-high px-3 active:opacity-80"
                style={{ minHeight: 56 }}
              >
                <Text
                  className="w-6 text-center font-sans text-sm text-on-surface-muted"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {n}
                </Text>
                <Text
                  className="flex-1 font-sans text-lg font-bold text-on-surface"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {formatWeight(committed.weightKg)} kg × {committed.reps}
                </Text>
                <View className="h-12 w-12 items-center justify-center rounded-full bg-primary">
                  <Ionicons name="checkmark" size={22} color="#213600" />
                </View>
              </Pressable>
            );
          }

          const placeholder = lastSets.find((s) => s.setNumber === n);
          const gen = resetGen[n] ?? 0;

          return (
            <View key={n} className="flex-row items-center gap-2" style={{ minHeight: 56 }}>
              <Text
                className="w-6 text-center font-sans text-sm text-on-surface-muted"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {n}
              </Text>
              <View className="min-h-[48px] flex-1 flex-row items-center justify-center gap-1 rounded-lg bg-surface px-2">
                <TextInput
                  key={`w-${n}-${gen}`}
                  defaultValue=""
                  onChangeText={(text) => {
                    draftsRef.current[n] = { weight: text, reps: draftsRef.current[n]?.reps ?? '' };
                  }}
                  placeholder={placeholder ? formatWeight(placeholder.weightKg) : undefined}
                  placeholderTextColor="#a0a0a0"
                  keyboardType="decimal-pad"
                  className="min-w-0 flex-1 py-0 text-right font-sans text-lg font-bold text-on-surface"
                  style={{ fontVariant: ['tabular-nums'] }}
                />
                <Text className="font-sans text-xs text-on-surface-muted">kg</Text>
              </View>
              <View className="min-h-[48px] w-20 flex-row items-center justify-center gap-1 rounded-lg bg-surface px-2">
                <TextInput
                  key={`r-${n}-${gen}`}
                  defaultValue=""
                  onChangeText={(text) => {
                    draftsRef.current[n] = { weight: draftsRef.current[n]?.weight ?? '', reps: text };
                  }}
                  placeholder={placeholder ? String(placeholder.reps) : undefined}
                  placeholderTextColor="#a0a0a0"
                  keyboardType="number-pad"
                  className="min-w-0 flex-1 py-0 text-right font-sans text-lg font-bold text-on-surface"
                  style={{ fontVariant: ['tabular-nums'] }}
                />
                <Text className="font-sans text-xs text-on-surface-muted">Wdh</Text>
              </View>
              <Pressable
                onPress={() => commitRow(n, placeholder)}
                android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
                className="h-12 w-12 items-center justify-center rounded-full border-2 border-outline active:opacity-80"
              >
                <Ionicons name="checkmark" size={22} color="#a0a0a0" />
              </Pressable>
            </View>
          );
        })}
      </View>

      <Pressable
        onPress={() => setExtraRows((prev) => prev + 1)}
        android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
        className="min-h-[48px] flex-row items-center justify-center gap-2 rounded-lg border border-outline active:opacity-80"
      >
        <Ionicons name="add" size={18} color="#a0a0a0" />
        <Text className="font-sans font-semibold text-on-surface-muted">Satz</Text>
      </Pressable>
    </View>
  );
});
