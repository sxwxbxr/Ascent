import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { epley1Rm } from '@ascent/shared';

import { Screen } from '../../src/ui/Screen';
import {
  cancelWorkout,
  getWorkoutSetsWithExercise,
  getWorkoutWithPlan,
  updateWorkoutNotes,
} from '../../src/data/workouts';

// Readonly-Detail eines abgeschlossenen Workouts (Aufruf aus Home/Verlauf).
// M6-Überarbeitung: Screen-Wrapper (Titel = Datum, Untertitel = Plan + Dauer —
// vorher gab es hier gar keinen SafeArea-Header), Akzent-Diät (bester Satz
// jetzt dezent mit Primary-Punkt statt Lime-Text), Zahlen tabular, Notizen-Feld
// mit sichtbarem Rahmen, Löschen als text-error-Ghost mit Icon.

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

  const durationMs = workout ? (workout.finishedAt ?? workout.startedAt) - workout.startedAt : 0;

  return (
    <Screen
      title={workout ? dateFormatter.format(new Date(workout.startedAt)) : 'Training'}
      subtitle={workout ? `${workout.planName ?? 'Freies Training'} · ${formatDuration(durationMs)}` : undefined}
    >
      {!workout ? (
        <Text className="font-sans text-on-surface-muted">Lade…</Text>
      ) : (
        <>
          <View className="gap-4">
            {exerciseGroups.map((group) => {
              const best = group.sets.reduce((a, b) =>
                epley1Rm(b.weightKg, b.reps) > epley1Rm(a.weightKg, a.reps) ? b : a,
              );
              return (
                <View key={group.exerciseId} className="gap-2 rounded-xl bg-surface-container p-4">
                  <Text className="font-sans text-lg font-bold text-on-surface">{group.name}</Text>
                  <View className="gap-1">
                    {group.sets.map((set) => (
                      <View key={set.id} className="flex-row items-center justify-between">
                        <Text
                          className="font-sans text-on-surface-muted"
                          style={{ fontVariant: ['tabular-nums'] }}
                        >
                          Satz {set.setNumber}
                        </Text>
                        <Text
                          className="font-sans font-bold text-on-surface"
                          style={{ fontVariant: ['tabular-nums'] }}
                        >
                          {formatWeight(set.weightKg)} kg × {set.reps}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View className="flex-row items-center gap-2">
                    <View className="h-1.5 w-1.5 rounded-full bg-primary" />
                    <Text className="flex-1 font-sans text-xs text-on-surface-muted">
                      Bester Satz: {formatWeight(best.weightKg)} kg × {best.reps} · geschätztes 1RM ≈{' '}
                      {formatWeight(epley1Rm(best.weightKg, best.reps))} kg
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          <View className="gap-2">
            <Text className="font-sans text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
              Notizen
            </Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="Wie lief's? Was beim nächsten Mal ändern?"
              placeholderTextColor="#a0a0a0"
              textAlignVertical="top"
              className="min-h-[96px] rounded-lg border border-outline bg-surface-container p-3 font-sans text-on-surface"
            />
            <Pressable
              onPress={handleSaveNotes}
              disabled={savingNotes}
              android_ripple={{ color: 'rgba(0,0,0,0.15)' }}
              className={`min-h-[48px] items-center justify-center rounded-lg bg-primary active:opacity-90 ${
                savingNotes ? 'opacity-60' : ''
              }`}
            >
              <Text className="font-sans font-bold uppercase text-on-primary">Speichern</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={handleDelete}
            android_ripple={{ color: 'rgba(255,180,171,0.12)' }}
            className="min-h-[48px] flex-row items-center justify-center gap-2 rounded-lg border border-error px-4 py-3 active:opacity-80"
          >
            <Ionicons name="trash-outline" size={18} color="#ffb4ab" />
            <Text className="font-sans font-semibold text-error">Training löschen</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}
