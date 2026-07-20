import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Ionicons } from '@expo/vector-icons';

import { Screen } from '../../src/ui/Screen';
import { getFinishedWorkoutSummaries } from '../../src/data/workouts';

// Verlauf-Screen (Design: design/verlauf): abgeschlossene Trainings, neueste
// zuerst, gruppiert nach Monat. Tap auf eine Zeile öffnet das Detail.
//
// Beta-Befund: die Leer-Zustand-Karte klebte oben direkt unter der Uhr (kein
// SafeArea, kein Titel). Jetzt über Screen (SafeArea + Titelzeile) und der
// Leer-Zustand ist vertikal zentriert statt oben angeklebt.

const RIPPLE_NEUTRAL = { color: 'rgba(255,255,255,0.08)' };

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
    <Screen title="Verlauf" subtitle="Deine Trainingshistorie" scroll={false}>
      {sections.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <Ionicons name="barbell-outline" size={64} color="#a0a0a0" />
          <Text className="font-sans text-lg font-bold text-on-surface">Noch kein Verlauf</Text>
          <Text className="text-center font-sans text-on-surface-muted">
            Hier siehst du deinen Fortschritt, sobald du ein Training abgeschlossen hast.
          </Text>
          <View className="mt-2 flex-row items-center gap-2 rounded-full border border-surface-container-high bg-surface-container px-4 py-2">
            <Ionicons name="home-outline" size={14} color="#a0a0a0" />
            <Text className="font-sans text-xs text-on-surface-muted">Starte dein erstes Training auf Home</Text>
          </View>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-8 pt-2">
          {sections.map((section) => (
            <View key={section.title} className="gap-2">
              <Text className="font-sans text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
                {section.title}
              </Text>
              {section.data.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => router.push(`/workout/${item.id}`)}
                  android_ripple={RIPPLE_NEUTRAL}
                  className="min-h-[48px] rounded-lg bg-surface-container p-4 active:opacity-80"
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="font-sans text-sm text-on-surface-muted">
                      {dayFormatter.format(new Date(item.finishedAt ?? item.startedAt))}
                    </Text>
                    <Text className="font-sans font-bold text-on-surface">
                      {item.planName ?? 'Freies Training'}
                    </Text>
                  </View>
                  <Text className="tabular-nums mt-1 font-sans text-sm text-on-surface-muted">
                    {item.exerciseCount} {item.exerciseCount === 1 ? 'Übung' : 'Übungen'} · {item.setCount}{' '}
                    {item.setCount === 1 ? 'Satz' : 'Sätze'} · {numberFormatter.format(item.volumeKg)} kg
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
