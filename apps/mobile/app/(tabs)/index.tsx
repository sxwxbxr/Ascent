import { useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { and, asc, eq, sql } from 'drizzle-orm';
import { planExercises, plans } from '@ascent/shared';

import { db } from '../../src/db/client';
import { getActiveWorkout, getFinishedWorkoutSummaries, startWorkout } from '../../src/data/workouts';

// Home-Screen (Design: design/dashboard). Begrüssung + Datum, aktives Workout
// (Banner) oder Start-CTA (Plan-Auswahl-Modal), zuletzt abgeschlossene Trainings.

const todayLabel = new Intl.DateTimeFormat('de-CH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}).format(new Date());

const dateFormatter = new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
const numberFormatter = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });

function ownPlansQuery() {
  return db
    .select({
      id: plans.id,
      name: plans.name,
      exerciseCount: sql<number>`count(${planExercises.id})`.as('exercise_count'),
    })
    .from(plans)
    .leftJoin(planExercises, and(eq(planExercises.planId, plans.id), eq(planExercises.deleted, false)))
    .where(eq(plans.deleted, false))
    .groupBy(plans.id)
    .orderBy(asc(plans.name));
}

export default function HomeScreen() {
  const [pickerVisible, setPickerVisible] = useState(false);
  const [starting, setStarting] = useState(false);

  const { data: activeWorkouts } = useLiveQuery(getActiveWorkout());
  const { data: ownPlans } = useLiveQuery(ownPlansQuery());
  const { data: recentWorkouts } = useLiveQuery(getFinishedWorkoutSummaries(3));

  const activeWorkout = activeWorkouts?.[0];

  async function handleStart(planId?: string): Promise<void> {
    if (starting) return;
    setStarting(true);
    try {
      await startWorkout(planId);
      setPickerVisible(false);
      router.push('/workout/active');
    } finally {
      setStarting(false);
    }
  }

  return (
    <View className="flex-1 bg-surface">
      <ScrollView className="flex-1" contentContainerClassName="p-4 gap-6" contentInsetAdjustmentBehavior="automatic">
        <View className="gap-1 pt-2">
          <Text className="text-3xl font-extrabold text-on-surface">Hallo!</Text>
          <Text className="text-base text-on-surface-muted">{todayLabel}</Text>
        </View>

        {activeWorkout ? (
          <Pressable
            onPress={() => router.push('/workout/active')}
            className="min-h-[48px] rounded-lg bg-primary p-4 active:opacity-90"
          >
            <Text className="text-xs font-semibold uppercase tracking-widest text-on-primary">
              Training läuft
            </Text>
            <View className="mt-2 flex-row items-center justify-between">
              <Text className="text-xl font-extrabold text-on-primary">
                {activeWorkout.planName ?? 'Freies Training'} — fortsetzen
              </Text>
              <Text className="text-2xl font-extrabold text-on-primary">→</Text>
            </View>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setPickerVisible(true)}
            className="min-h-[56px] items-center justify-center rounded-lg bg-primary active:opacity-90"
          >
            <Text className="text-lg font-extrabold uppercase tracking-wide text-on-primary">
              Training starten
            </Text>
          </Pressable>
        )}

        <View className="gap-3">
          <Text className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
            Letzte Trainings
          </Text>

          {recentWorkouts !== undefined && recentWorkouts.length === 0 ? (
            <View className="rounded-lg bg-surface-container p-4">
              <Text className="text-on-surface-muted">
                Noch keine abgeschlossenen Trainings — leg los, sobald du bereit bist!
              </Text>
            </View>
          ) : null}

          {recentWorkouts?.map((workout) => (
            <Pressable
              key={workout.id}
              onPress={() => router.push(`/workout/${workout.id}`)}
              className="min-h-[48px] rounded-lg bg-surface-container p-4 active:opacity-80"
            >
              <View className="flex-row items-center justify-between">
                <Text className="font-bold text-on-surface">{workout.planName ?? 'Freies Training'}</Text>
                <Text className="text-sm text-on-surface-muted">
                  {workout.finishedAt ? dateFormatter.format(new Date(workout.finishedAt)) : ''}
                </Text>
              </View>
              <Text className="mt-1 text-sm text-on-surface-muted">
                {workout.setCount} {workout.setCount === 1 ? 'Satz' : 'Sätze'} ·{' '}
                {numberFormatter.format(workout.volumeKg)} kg
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
      >
        <Pressable className="flex-1 justify-end bg-black/60" onPress={() => setPickerVisible(false)}>
          <Pressable className="rounded-t-xl bg-surface-container p-4 pb-8" onPress={() => {}}>
            <Text className="mb-3 text-lg font-bold text-on-surface">Training starten</Text>

            <FlatList
              data={ownPlans ?? []}
              keyExtractor={(item) => item.id}
              ItemSeparatorComponent={() => <View className="h-2" />}
              renderItem={({ item }) => (
                <Pressable
                  disabled={starting}
                  onPress={() => handleStart(item.id)}
                  className="min-h-[48px] flex-row items-center justify-between rounded-lg bg-surface-container-high px-4 py-3 active:opacity-80"
                >
                  <Text className="font-semibold text-on-surface">{item.name}</Text>
                  <Text className="text-sm text-on-surface-muted">
                    {item.exerciseCount} {item.exerciseCount === 1 ? 'Übung' : 'Übungen'}
                  </Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text className="px-1 py-2 text-sm text-on-surface-muted">Noch keine eigenen Pläne.</Text>
              }
            />

            <Pressable
              disabled={starting}
              onPress={() => handleStart(undefined)}
              className="mt-2 min-h-[48px] items-center justify-center rounded-lg border border-outline px-4 py-3 active:opacity-80"
            >
              <Text className="font-semibold text-on-surface">Freies Training</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
