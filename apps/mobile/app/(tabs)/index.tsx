import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { PLAN_TEMPLATES } from '@ascent/shared';
import type { PlanTemplate } from '@ascent/shared';

import { Screen } from '../../src/ui/Screen';
import { buildPlanExerciseCountsQuery, buildPlansQuery, instantiateTemplate } from '../../src/data/plans';
import {
  getActiveWorkout,
  getFinishedWorkoutSummaries,
  getWeeklySetStats,
  getWeeklyWorkoutCount,
  startWorkout,
} from '../../src/data/workouts';
import { useOwnerUserId } from '../../src/lib/owner';

// Home-Screen (Design: design/dashboard). Begrüssung + Datum (jetzt über den
// gemeinsamen Screen-Wrapper — der Gerätetest zeigte "Hallo!" unter der
// Statusleiste), aktives Workout (Banner) oder Start-CTA (Plan-Auswahl-Modal),
// Wochen-Kennzahlen, zuletzt abgeschlossene Trainings.

const todayLabel = new Intl.DateTimeFormat('de-CH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}).format(new Date());

const dateFormatter = new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
const numberFormatter = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });

/**
 * Anzahl (nicht gelöschter) Plan-Übungen je Plan für den Start-Picker.
 * Basistabelle `plan_exercises` (analog zu (tabs)/plans.tsx) statt des
 * vorherigen leftJoin-Counts mit `plans` als Basistabelle — das war der im
 * Gerätetest gefundene Zähl-Bug: useLiveQuery reagiert NUR auf die
 * FROM-Basistabelle, Änderungen an plan_exercises lösten also nie ein
 * Update des Modals aus ("Pull — 0 Übungen" trotz 1 Übung im Pläne-Tab).
 */
function usePlanExerciseCounts(): Map<string, number> {
  const { data } = useLiveQuery(buildPlanExerciseCountsQuery());
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of data) {
      counts.set(row.planId, (counts.get(row.planId) ?? 0) + 1);
    }
    return counts;
  }, [data]);
}

function formatExerciseCount(count: number): string {
  return count === 1 ? '1 Übung' : `${count} Übungen`;
}

export default function HomeScreen() {
  const [pickerVisible, setPickerVisible] = useState(false);
  const [starting, setStarting] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // Owner-Id reaktiv aus der Session — sofort verfügbar, keine Race Condition
  // (frühere Ursache für "keine eigenen Pläne" direkt nach dem Login).
  const ownerUserId = useOwnerUserId();

  const { data: activeWorkouts } = useLiveQuery(getActiveWorkout());
  // Placeholder-Query ('' matcht nie eine echte userId) solange ownerUserId
  // noch lädt — hält die Hook-Reihenfolge stabil (kein bedingter Hook-Aufruf).
  const { data: ownPlans } = useLiveQuery(buildPlansQuery(ownerUserId ?? ''), [ownerUserId]);
  const exerciseCounts = usePlanExerciseCounts();
  const { data: recentWorkouts } = useLiveQuery(getFinishedWorkoutSummaries(3));
  const { data: weeklyWorkoutRows } = useLiveQuery(getWeeklyWorkoutCount());
  const { data: weeklySetRows } = useLiveQuery(getWeeklySetStats());

  const activeWorkout = activeWorkouts?.[0];
  const weeklyWorkoutCount = weeklyWorkoutRows?.[0]?.count ?? 0;
  const weeklySetCount = weeklySetRows?.[0]?.setCount ?? 0;
  const weeklyVolumeKg = weeklySetRows?.[0]?.volumeKg ?? 0;

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

  // Vorlage: erst als eigenen (bearbeitbaren) Plan klonen, dann damit starten.
  async function handleStartTemplate(template: PlanTemplate): Promise<void> {
    if (starting) return;
    setStarting(true);
    try {
      const plan = await instantiateTemplate(template);
      await startWorkout(plan.id);
      setPickerVisible(false);
      router.push('/workout/active');
    } catch (err) {
      console.log('[Home] Vorlage starten fehlgeschlagen:', err);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Screen title="Hallo!" subtitle={todayLabel}>
      {/* Einziger Lime-CTA des Screens: entweder Fortsetzen-Banner ODER Start-CTA. */}
      {activeWorkout ? (
        <Pressable
          onPress={() => router.push('/workout/active')}
          android_ripple={{ color: 'rgba(0,0,0,0.1)' }}
          className="min-h-[56px] rounded-lg bg-primary p-4 active:opacity-90"
        >
          <Text className="font-sans text-xs font-semibold uppercase tracking-widest text-on-primary">
            Training läuft
          </Text>
          <View className="mt-2 flex-row items-center justify-between">
            <Text className="flex-1 pr-2 font-sans text-xl font-extrabold text-on-primary" numberOfLines={1}>
              {activeWorkout.planName ?? 'Freies Training'} — fortsetzen
            </Text>
            <Ionicons name="arrow-forward" size={24} color="#213600" />
          </View>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => setPickerVisible(true)}
          android_ripple={{ color: 'rgba(0,0,0,0.1)' }}
          className="h-14 flex-row items-center justify-center gap-2 rounded-lg bg-primary active:opacity-90"
        >
          <Ionicons name="play" size={22} color="#213600" />
          <Text className="font-sans text-lg font-extrabold uppercase tracking-wide text-on-primary">
            Training starten
          </Text>
        </Pressable>
      )}

      <View className="gap-3">
        <Text className="font-sans text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
          Diese Woche
        </Text>
        <View className="flex-row gap-3">
          <StatTile label="Trainings" value={String(weeklyWorkoutCount)} />
          <StatTile label="Sätze" value={String(weeklySetCount)} />
          <StatTile label="Volumen" value={`${numberFormatter.format(weeklyVolumeKg)} kg`} />
        </View>
      </View>

      <View className="gap-3">
        <Text className="font-sans text-xs font-semibold uppercase tracking-widest text-on-surface-muted">
          Letzte Trainings
        </Text>

        {recentWorkouts !== undefined && recentWorkouts.length === 0 ? (
          <View className="items-center gap-2 rounded-lg bg-surface-container p-6">
            <Ionicons name="barbell-outline" size={28} color="#a0a0a0" />
            <Text className="text-center font-sans text-on-surface-muted">
              Noch keine abgeschlossenen Trainings — leg los, sobald du bereit bist!
            </Text>
          </View>
        ) : null}

        {recentWorkouts?.map((workout) => (
          <Pressable
            key={workout.id}
            onPress={() => router.push(`/workout/${workout.id}`)}
            android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
            className="min-h-[48px] flex-row items-center gap-3 rounded-lg bg-surface-container p-4 active:opacity-80"
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-container-high">
              <Ionicons name="barbell" size={18} color="#e5e2e1" />
            </View>
            <View className="flex-1">
              <View className="flex-row items-center justify-between">
                <Text className="flex-1 pr-2 font-sans font-bold text-on-surface" numberOfLines={1}>
                  {workout.planName ?? 'Freies Training'}
                </Text>
                <Text className="font-sans text-sm text-on-surface-muted">
                  {workout.finishedAt ? dateFormatter.format(new Date(workout.finishedAt)) : ''}
                </Text>
              </View>
              <Text
                className="mt-1 font-sans text-sm text-on-surface-muted"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {workout.setCount} {workout.setCount === 1 ? 'Satz' : 'Sätze'} ·{' '}
                {numberFormatter.format(workout.volumeKg)} kg
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
      >
        <Pressable className="flex-1 justify-end bg-black/60" onPress={() => setPickerVisible(false)}>
          <Pressable className="rounded-t-xl bg-surface-container p-4 pb-8" onPress={() => {}}>
            <Text className="mb-3 font-sans text-lg font-bold text-on-surface">Training starten</Text>

            <FlatList
              data={ownPlans ?? []}
              keyExtractor={(item) => item.id}
              ItemSeparatorComponent={() => <View className="h-2" />}
              renderItem={({ item }) => (
                <Pressable
                  disabled={starting}
                  onPress={() => handleStart(item.id)}
                  android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
                  className="min-h-[48px] flex-row items-center justify-between rounded-lg bg-surface-container-high px-4 py-3 active:opacity-80"
                >
                  <Text className="font-sans font-semibold text-on-surface">{item.name}</Text>
                  <Text className="font-sans text-sm text-on-surface-muted">
                    {formatExerciseCount(exerciseCounts.get(item.id) ?? 0)}
                  </Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text className="px-1 py-2 font-sans text-sm text-on-surface-muted">Noch keine eigenen Pläne.</Text>
              }
            />

            <Pressable
              disabled={starting}
              onPress={() => handleStart(undefined)}
              android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
              className="mt-2 min-h-[48px] items-center justify-center rounded-lg border border-outline px-4 py-3 active:opacity-80"
            >
              <Text className="font-sans font-semibold text-on-surface">Freies Training</Text>
            </Pressable>

            {/* Vorlagen bewusst eingeklappt, damit die eigenen Pläne oben im
                Fokus bleiben. Auswahl klont die Vorlage in einen eigenen Plan
                und startet damit direkt ein Training. */}
            <Pressable
              onPress={() => setTemplatesOpen((v) => !v)}
              android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
              className="mt-3 min-h-[48px] flex-row items-center justify-between px-1 py-2"
            >
              <Text className="font-sans text-sm font-semibold uppercase tracking-widest text-on-surface-muted">
                Vorlagen
              </Text>
              <Ionicons name={templatesOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#a0a0a0" />
            </Pressable>

            {templatesOpen ? (
              <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
                {PLAN_TEMPLATES.map((template) => (
                  <Pressable
                    key={template.slug}
                    disabled={starting}
                    onPress={() => handleStartTemplate(template)}
                    android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
                    className="mb-2 min-h-[48px] rounded-lg border border-surface-container-high bg-surface px-4 py-3 active:opacity-80"
                  >
                    <Text className="font-sans font-semibold text-on-surface">{template.name}</Text>
                    <Text className="mt-0.5 font-sans text-xs text-on-surface-muted">{template.goal}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-1 rounded-lg bg-surface-container p-3">
      <Text
        className="font-sans text-xl font-extrabold text-on-surface"
        style={{ fontVariant: ['tabular-nums'] }}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text className="font-sans text-xs text-on-surface-muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
