import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';
import { exercises } from '@ascent/shared';

import { db } from '../../src/db/client';
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

const DEFAULT_REST_SECONDS = 90;

const numberFormatter = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });

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

export default function ActiveWorkoutScreen() {
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
  const [now, setNow] = useState(() => Date.now());

  const restTimer = useRestTimer();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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

    const durationMin = Math.max(0, Math.round((now - activeWorkout.startedAt) / 60000));
    setSummary({
      durationMin,
      exerciseCount: setsByExercise.size,
      setCount: allSets.length,
      volumeKg: sumVolume(allSets),
    });
    setSummaryVisible(true);
  }, [activeWorkout, allSets, now, setsByExercise]);

  const handleConfirmFinish = useCallback(() => {
    if (!activeWorkout) return;
    void finishWorkout(activeWorkout.id).then(() => {
      setSummaryVisible(false);
      router.replace('/');
    });
  }, [activeWorkout]);

  if (!activeWorkout) {
    return (
      <View className="flex-1 items-center justify-center bg-surface">
        <Text className="text-on-surface-muted">Lade Training…</Text>
      </View>
    );
  }

  const elapsedMs = now - activeWorkout.startedAt;

  return (
    <View className="flex-1 bg-surface">
      <View className="flex-row items-center justify-between bg-surface-container px-4 py-3">
        <View>
          <Text className="text-lg font-bold text-on-surface">{activeWorkout.planName ?? 'Freies Training'}</Text>
          <Text className="text-2xl font-extrabold tabular-nums text-on-surface">{formatElapsed(elapsedMs)}</Text>
        </View>
        <Pressable
          onPress={handleFinishPress}
          className="min-h-[48px] min-w-[48px] items-center justify-center rounded-lg bg-surface-container-high px-4"
        >
          <Text className="font-semibold text-on-surface">Beenden</Text>
        </Pressable>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4 pb-8">
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
          className="min-h-[48px] items-center justify-center rounded-lg border border-outline px-4 py-3 active:opacity-80"
        >
          <Text className="font-semibold text-on-surface">+ Übung hinzufügen</Text>
        </Pressable>
      </ScrollView>

      {restTimer.isRunning ? (
        <View className="gap-2 border-t border-outline bg-surface-container px-4 py-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">Pause</Text>
            <Text className="text-3xl font-extrabold tabular-nums text-primary">
              {formatElapsed(restTimer.remainingSeconds * 1000)}
            </Text>
          </View>
          <View className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
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
            className="min-h-[48px] items-center justify-center rounded-lg border border-outline"
          >
            <Text className="font-semibold text-on-surface">Überspringen</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal visible={summaryVisible} transparent animationType="fade">
        <View className="flex-1 items-center justify-center bg-black/70 p-6">
          <View className="w-full gap-4 rounded-xl bg-surface-container p-6">
            <Text className="text-center text-xl font-extrabold text-on-surface">Training beendet</Text>
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
            <Pressable
              onPress={handleConfirmFinish}
              className="mt-2 min-h-[56px] items-center justify-center rounded-lg bg-primary"
            >
              <Text className="text-lg font-extrabold uppercase tracking-wide text-on-primary">Fertig</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 items-center gap-1">
      <Text className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">{label}</Text>
      <Text className="text-2xl font-extrabold tabular-nums text-primary">{value}</Text>
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

function ExerciseBlock({
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
  const [drafts, setDrafts] = useState<Record<number, { weight: string; reps: string }>>({});
  const [editingSetNumber, setEditingSetNumber] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState({ weight: '', reps: '' });

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
    setEditingSetNumber(n);
    setEditDraft({ weight: formatWeight(committed.weightKg), reps: String(committed.reps) });
  }

  function commitEdit(committed: SetRow): void {
    const weight = parseNumberInput(editDraft.weight);
    const reps = parseNumberInput(editDraft.reps);
    if (weight !== undefined && weight > 0 && reps !== undefined && reps > 0) {
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
            if (editingSetNumber === committed.setNumber) setEditingSetNumber(null);
          },
        },
      ],
    );
  }

  function commitRow(n: number, placeholder?: { weightKg: number; reps: number }): void {
    const draft = drafts[n] ?? { weight: '', reps: '' };
    const weight = parseNumberInput(draft.weight) ?? placeholder?.weightKg;
    const reps = parseNumberInput(draft.reps) ?? placeholder?.reps;
    if (weight === undefined || weight <= 0 || reps === undefined || reps <= 0) {
      return;
    }
    void addSet({ workoutId, exerciseId, setNumber: n, weightKg: weight, reps: Math.round(reps) }).then(() => {
      onSetLogged(restSeconds);
    });
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[n];
      return next;
    });
  }

  return (
    <View className="gap-3 rounded-xl bg-surface-container p-4">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-lg font-bold text-on-surface">{displayName}</Text>
        {target ? <Text className="text-sm font-semibold text-primary">{target}</Text> : null}
      </View>

      <View className="gap-2">
        {rowNumbers.map((n) => {
          const committed = sets.find((s) => s.setNumber === n);

          if (committed && editingSetNumber === n) {
            return (
              <View key={n} className="flex-row items-center gap-1">
                <Text className="w-6 text-center text-on-surface-muted">{n}</Text>
                <TextInput
                  value={editDraft.weight}
                  onChangeText={(text) => setEditDraft((d) => ({ ...d, weight: text }))}
                  keyboardType="decimal-pad"
                  className="min-h-[48px] flex-1 rounded-lg bg-surface px-2 text-center text-lg font-bold tabular-nums text-on-surface"
                />
                <TextInput
                  value={editDraft.reps}
                  onChangeText={(text) => setEditDraft((d) => ({ ...d, reps: text }))}
                  keyboardType="number-pad"
                  className="min-h-[48px] w-14 rounded-lg bg-surface px-2 text-center text-lg font-bold tabular-nums text-on-surface"
                />
                <Pressable
                  onPress={() => commitEdit(committed)}
                  className="h-12 w-12 items-center justify-center rounded-lg bg-primary"
                >
                  <Text className="text-lg font-extrabold text-on-primary">✓</Text>
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(committed)}
                  className="h-12 w-12 items-center justify-center rounded-lg border border-error"
                >
                  <Text className="text-lg font-extrabold text-error">✕</Text>
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
                className="flex-row items-center gap-2 rounded-lg bg-surface-container-high px-3 py-2 active:opacity-80"
              >
                <Text className="w-6 text-center text-on-surface-muted">{n}</Text>
                <Text className="flex-1 text-lg font-bold tabular-nums text-on-surface">
                  {formatWeight(committed.weightKg)} kg × {committed.reps}
                </Text>
                <View className="h-12 w-12 items-center justify-center rounded-lg bg-primary">
                  <Text className="text-lg font-extrabold text-on-primary">✓</Text>
                </View>
              </Pressable>
            );
          }

          const placeholder = lastSets.find((s) => s.setNumber === n);
          const draft = drafts[n] ?? { weight: '', reps: '' };

          return (
            <View key={n} className="flex-row items-center gap-2">
              <Text className="w-6 text-center text-on-surface-muted">{n}</Text>
              <TextInput
                value={draft.weight}
                onChangeText={(text) => setDrafts((d) => ({ ...d, [n]: { weight: text, reps: draft.reps } }))}
                placeholder={placeholder ? formatWeight(placeholder.weightKg) : 'kg'}
                placeholderTextColor="#a0a0a0"
                keyboardType="decimal-pad"
                className="min-h-[48px] flex-1 rounded-lg bg-surface px-2 text-center text-lg font-bold tabular-nums text-on-surface"
              />
              <TextInput
                value={draft.reps}
                onChangeText={(text) => setDrafts((d) => ({ ...d, [n]: { weight: draft.weight, reps: text } }))}
                placeholder={placeholder ? String(placeholder.reps) : 'Wdh'}
                placeholderTextColor="#a0a0a0"
                keyboardType="number-pad"
                className="min-h-[48px] w-16 rounded-lg bg-surface px-2 text-center text-lg font-bold tabular-nums text-on-surface"
              />
              <Pressable
                onPress={() => commitRow(n, placeholder)}
                className="h-12 w-12 items-center justify-center rounded-lg border border-outline bg-surface-container-high active:opacity-80"
              >
                <Text className="text-lg font-extrabold text-on-surface-muted">✓</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <Pressable
        onPress={() => setExtraRows((prev) => prev + 1)}
        className="min-h-[48px] items-center justify-center rounded-lg border border-outline"
      >
        <Text className="font-semibold text-on-surface-muted">+ Satz</Text>
      </Pressable>
    </View>
  );
}
