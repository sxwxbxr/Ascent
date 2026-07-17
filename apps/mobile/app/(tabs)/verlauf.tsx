import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { getFinishedWorkoutSummaries } from '../../src/data/workouts';

// Verlauf-Screen (Design: design/verlauf): abgeschlossene Trainings, neueste
// zuerst, gruppiert nach Monat. Tap auf eine Zeile öffnet das Detail.

const monthFormatter = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric' });
const dayFormatter = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit' });
const numberFormatter = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });

function groupByMonth<T extends { finishedAt: number | null; startedAt: number }>(
  rows: readonly T[],
): Array<{ title: string; data: T[] }> {
  const sections: Array<{ title: string; data: T[] }> = [];
  let currentKey = '';

  for (const row of rows) {
    const date = new Date(row.finishedAt ?? row.startedAt);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (key !== currentKey) {
      currentKey = key;
      sections.push({ title: monthFormatter.format(date), data: [] });
    }
    sections[sections.length - 1]?.data.push(row);
  }

  return sections;
}

export default function VerlaufScreen() {
  const { data: finishedWorkouts } = useLiveQuery(getFinishedWorkoutSummaries());
  const sections = useMemo(() => groupByMonth(finishedWorkouts), [finishedWorkouts]);

  return (
    <View className="flex-1 bg-surface">
      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4">
        {sections.length === 0 ? (
          <View className="mt-8 items-center gap-2 rounded-lg bg-surface-container p-6">
            <Text className="text-lg font-bold text-on-surface">Noch kein Verlauf</Text>
            <Text className="text-center text-on-surface-muted">
              Starte dein erstes Training — hier siehst du danach deinen Fortschritt.
            </Text>
          </View>
        ) : null}

        {sections.map((section) => (
          <View key={section.title} className="gap-2">
            <Text className="text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
              {section.title}
            </Text>
            {section.data.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => router.push(`/workout/${item.id}`)}
                className="min-h-[48px] rounded-lg bg-surface-container p-4 active:opacity-80"
              >
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm text-on-surface-muted">
                    {dayFormatter.format(new Date(item.finishedAt ?? item.startedAt))}
                  </Text>
                  <Text className="font-bold text-on-surface">{item.planName ?? 'Freies Training'}</Text>
                </View>
                <Text className="mt-1 text-sm text-on-surface-muted">
                  {item.exerciseCount} {item.exerciseCount === 1 ? 'Übung' : 'Übungen'} · {item.setCount}{' '}
                  {item.setCount === 1 ? 'Satz' : 'Sätze'} · {numberFormatter.format(item.volumeKg)} kg
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
