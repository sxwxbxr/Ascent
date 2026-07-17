import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { epley1Rm } from '@ascent/shared';

import {
  cancelWorkout,
  getWorkoutSetsWithExercise,
  getWorkoutWithPlan,
  updateWorkoutNotes,
} from '../../src/data/workouts';

// Readonly-Detail eines abgeschlossenen Workouts (Aufruf aus Home/Verlauf):
// Datum/Dauer, Sätze je Übung (bester Satz mit geschätztem 1RM), editierbare
// Notiz, "Training löschen" (Soft-Delete mit Bestätigung).

const dateFormatter = new Intl.DateTimeFormat('de-CH', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const oneDecimalFormatter = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 });

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} Min` : `${minutes} Min`;
}

function formatWeight(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : oneDecimalFormatter.format(kg);
}

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workoutId = typeof id === 'string' ? id : '';

  const { data: workoutRows } = useLiveQuery(getWorkoutWithPlan(workoutId), [workoutId]);
  const { data: sets } = useLiveQuery(getWorkoutSetsWithExercise(workoutId), [workoutId]);

  const workout = workoutRows[0];

  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    setNotes(workout?.notes ?? '');
  }, [workout?.notes]);

  const exerciseGroups = useMemo(() => {
    const map = new Map<string, { exerciseId: string; name: string; sets: typeof sets }>();
    for (const set of sets) {
      const existing = map.get(set.exerciseId);
      if (existing) {
        existing.sets.push(set);
      } else {
        map.set(set.exerciseId, {
          exerciseId: set.exerciseId,
          name: set.exerciseNameDe ?? set.exerciseName,
          sets: [set],
        });
      }
    }
    return [...map.values()];
  }, [sets]);

  async function handleSaveNotes(): Promise<void> {
    if (!workout) return;
    setSavingNotes(true);
    try {
      await updateWorkoutNotes(workout.id, notes.trim() === '' ? null : notes.trim());
    } finally {
      setSavingNotes(false);
    }
  }

  function handleDelete(): void {
    if (!workout) return;
    Alert.alert('Training löschen?', 'Dieses Training wird endgültig aus deinem Verlauf entfernt.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => {
          void cancelWorkout(workout.id).then(() => router.replace('/verlauf'));
        },
      },
    ]);
  }

  if (!workout) {
    return (
      <View className="flex-1 items-center justify-center bg-surface">
        <Text className="text-on-surface-muted">Lade…</Text>
      </View>
    );
  }

  const durationMs = (workout.finishedAt ?? workout.startedAt) - workout.startedAt;

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="gap-6 p-4 pb-12">
      <View className="gap-1 pt-2">
        <Text className="text-lg font-bold text-on-surface">{workout.planName ?? 'Freies Training'}</Text>
        <Text className="text-on-surface-muted">{dateFormatter.format(new Date(workout.startedAt))}</Text>
        <Text className="text-on-surface-muted">Dauer: {formatDuration(durationMs)}</Text>
      </View>

      <View className="gap-4">
        {exerciseGroups.map((group) => {
          const best = group.sets.reduce((a, b) =>
            epley1Rm(b.weightKg, b.reps) > epley1Rm(a.weightKg, a.reps) ? b : a,
          );
          return (
            <View key={group.exerciseId} className="gap-2 rounded-xl bg-surface-container p-4">
              <Text className="text-lg font-bold text-on-surface">{group.name}</Text>
              <View className="gap-1">
                {group.sets.map((set) => (
                  <View key={set.id} className="flex-row items-center justify-between">
                    <Text className="text-on-surface-muted">Satz {set.setNumber}</Text>
                    <Text className="font-bold tabular-nums text-on-surface">
                      {formatWeight(set.weightKg)} kg × {set.reps}
                    </Text>
                  </View>
                ))}
              </View>
              <Text className="text-xs text-on-surface-muted">
                Bester Satz: {formatWeight(best.weightKg)} kg × {best.reps} · geschätztes 1RM ≈{' '}
                {formatWeight(epley1Rm(best.weightKg, best.reps))} kg
              </Text>
            </View>
          );
        })}
      </View>

      <View className="gap-2">
        <Text className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">Notizen</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Wie lief's? Was beim nächsten Mal ändern?"
          placeholderTextColor="#a0a0a0"
          textAlignVertical="top"
          className="min-h-[96px] rounded-lg bg-surface-container p-3 text-on-surface"
        />
        <Pressable
          onPress={handleSaveNotes}
          disabled={savingNotes}
          className="min-h-[48px] items-center justify-center rounded-lg bg-primary active:opacity-90"
        >
          <Text className="font-bold uppercase text-on-primary">Speichern</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={handleDelete}
        className="min-h-[48px] items-center justify-center rounded-lg border border-error px-4 py-3 active:opacity-80"
      >
        <Text className="font-semibold text-error">Training löschen</Text>
      </Pressable>
    </ScrollView>
  );
}
