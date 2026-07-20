import { useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, Text, TextInput, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  addExerciseToPlan,
  buildPlanExercisesQuery,
  buildPlanQuery,
  movePlanExercise,
  removePlanExercise,
  updatePlan,
  updatePlanExercise,
} from '../../src/data/plans';
import type { PlanExerciseRow } from '../../src/data/plans';
import { setExercisePickHandler } from '../../src/lib/exercise-picker';

const REST_PRESETS = [30, 60, 90, 120, 180];

// Ionicons-Farben als Literale — Icon-Komponenten unterstützen keine
// className-Farbsteuerung, siehe tailwind.config.js für die Quelle der Tokens.
const COLOR_ON_SURFACE = '#e5e2e1';
const COLOR_ON_SURFACE_MUTED = '#a0a0a0';
const COLOR_ON_SURFACE_MUTED_DIM = '#4d4d4d';
const COLOR_ERROR = '#ffb4ab';

function formatPlanExerciseSummary(row: Pick<PlanExerciseRow, 'targetSets' | 'targetRepsMin' | 'targetRepsMax' | 'restSeconds'>): string {
  const parts = [`${row.targetSets} Sätze`];
  if (row.targetRepsMin != null && row.targetRepsMax != null) {
    parts.push(row.targetRepsMin === row.targetRepsMax ? `${row.targetRepsMin} Wdh.` : `${row.targetRepsMin}–${row.targetRepsMax} Wdh.`);
  } else if (row.targetRepsMin != null) {
    parts.push(`ab ${row.targetRepsMin} Wdh.`);
  } else if (row.targetRepsMax != null) {
    parts.push(`bis ${row.targetRepsMax} Wdh.`);
  }
  if (row.restSeconds != null) parts.push(`${row.restSeconds} s Pause`);
  return parts.join(' · ');
}

function ExerciseThumbnail({ uri, label }: { uri: string | null; label: string }) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        className="h-14 w-14 rounded-lg border border-surface-container-high bg-surface-container-high"
      />
    );
  }
  return (
    <View className="h-14 w-14 items-center justify-center rounded-lg border border-surface-container-high bg-surface-container-high">
      <Text className="font-sans text-lg font-bold text-on-surface-muted">{label.charAt(0).toUpperCase() || '?'}</Text>
    </View>
  );
}

function PlanExerciseRowCard({ row, isFirst, isLast }: { row: PlanExerciseRow; isFirst: boolean; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [minText, setMinText] = useState(row.targetRepsMin != null ? String(row.targetRepsMin) : '');
  const [maxText, setMaxText] = useState(row.targetRepsMax != null ? String(row.targetRepsMax) : '');
  const [restText, setRestText] = useState(row.restSeconds != null ? String(row.restSeconds) : '');
  const [repsError, setRepsError] = useState<string | null>(null);
  const [restError, setRestError] = useState<string | null>(null);

  const displayName = row.exerciseNameDe ?? row.exerciseName ?? 'Unbekannte Übung';
  const isCustomRest = row.restSeconds != null && !REST_PRESETS.includes(row.restSeconds);

  function reportError(message: string) {
    return (error: unknown) => {
      console.error(error);
      Alert.alert('Fehler', message);
    };
  }

  function adjustSets(delta: number) {
    const next = row.targetSets + delta;
    if (next < 1 || next > 20) return;
    updatePlanExercise(row.id, { targetSets: next }).catch(reportError('Sätze konnten nicht gespeichert werden.'));
  }

  function commitReps() {
    const minTrim = minText.trim();
    const maxTrim = maxText.trim();
    const min = minTrim === '' ? undefined : Number(minTrim);
    const max = maxTrim === '' ? undefined : Number(maxTrim);

    const isValid = (value: number | undefined) => value === undefined || (Number.isInteger(value) && value >= 1 && value <= 100);
    if (!isValid(min) || !isValid(max)) {
      setRepsError('Wiederholungen müssen ganze Zahlen zwischen 1 und 100 sein.');
      return;
    }
    if (min !== undefined && max !== undefined && min > max) {
      setRepsError('Min. darf Max. nicht überschreiten.');
      return;
    }
    setRepsError(null);
    updatePlanExercise(row.id, { targetRepsMin: min, targetRepsMax: max }).catch(
      reportError('Wiederholungen konnten nicht gespeichert werden.'),
    );
  }

  function commitRestFromText() {
    const trimmed = restText.trim();
    if (trimmed === '') {
      setRestError(null);
      return; // kein Clear unterstützt — leeres Feld lässt die Pause unverändert
    }
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value < 0 || value > 600) {
      setRestError('Pause muss zwischen 0 und 600 Sekunden liegen.');
      return;
    }
    setRestError(null);
    updatePlanExercise(row.id, { restSeconds: value }).catch(reportError('Pause konnte nicht gespeichert werden.'));
  }

  function selectRestPreset(seconds: number) {
    setRestText(String(seconds));
    setRestError(null);
    updatePlanExercise(row.id, { restSeconds: seconds }).catch(reportError('Pause konnte nicht gespeichert werden.'));
  }

  return (
    <View className="mb-3 rounded-lg border border-surface-container-high bg-surface-container">
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        android_ripple={{ color: '#ffffff0f' }}
        className="flex-row items-center p-3 active:opacity-90"
      >
        <ExerciseThumbnail uri={row.exerciseThumbnailUrl} label={displayName} />
        <View className="ml-3 flex-1">
          <Text numberOfLines={1} className="font-sans text-base font-bold text-on-surface">
            {displayName}
          </Text>
          <Text className="mt-0.5 font-sans text-sm text-on-surface-muted" style={{ fontVariant: ['tabular-nums'] }}>
            {formatPlanExerciseSummary(row)}
          </Text>
        </View>
        <Pressable
          disabled={isFirst}
          hitSlop={6}
          onPress={() => movePlanExercise(row.id, 'hoch').catch(reportError('Reihenfolge konnte nicht geändert werden.'))}
          className="h-11 w-11 items-center justify-center active:opacity-70"
        >
          <Ionicons name="chevron-up" size={20} color={isFirst ? COLOR_ON_SURFACE_MUTED_DIM : COLOR_ON_SURFACE_MUTED} />
        </Pressable>
        <Pressable
          disabled={isLast}
          hitSlop={6}
          onPress={() => movePlanExercise(row.id, 'runter').catch(reportError('Reihenfolge konnte nicht geändert werden.'))}
          className="h-11 w-11 items-center justify-center active:opacity-70"
        >
          <Ionicons name="chevron-down" size={20} color={isLast ? COLOR_ON_SURFACE_MUTED_DIM : COLOR_ON_SURFACE_MUTED} />
        </Pressable>
        <Pressable
          hitSlop={6}
          onPress={() => removePlanExercise(row.id).catch(reportError('Übung konnte nicht entfernt werden.'))}
          className="h-11 w-11 items-center justify-center active:opacity-70"
        >
          <Ionicons name="trash-outline" size={20} color={COLOR_ERROR} />
        </Pressable>
      </Pressable>

      {expanded && (
        <View className="border-t border-surface-container-high p-3">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="font-sans text-sm text-on-surface-muted">Sätze</Text>
            <View className="flex-row items-center">
              <Pressable
                onPress={() => adjustSets(-1)}
                disabled={row.targetSets <= 1}
                android_ripple={{ color: '#ffffff1a' }}
                className="h-12 w-12 items-center justify-center rounded-lg bg-surface-container-high active:opacity-80"
              >
                <Ionicons name="remove" size={20} color={row.targetSets <= 1 ? COLOR_ON_SURFACE_MUTED_DIM : COLOR_ON_SURFACE} />
              </Pressable>
              <Text
                className="mx-4 min-w-[32px] text-center font-sans text-2xl font-extrabold text-on-surface"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {row.targetSets}
              </Text>
              <Pressable
                onPress={() => adjustSets(1)}
                disabled={row.targetSets >= 20}
                android_ripple={{ color: '#ffffff1a' }}
                className="h-12 w-12 items-center justify-center rounded-lg bg-surface-container-high active:opacity-80"
              >
                <Ionicons name="add" size={20} color={row.targetSets >= 20 ? COLOR_ON_SURFACE_MUTED_DIM : COLOR_ON_SURFACE} />
              </Pressable>
            </View>
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Text className="mb-1 font-sans text-xs text-on-surface-muted">Wdh. Min</Text>
              <TextInput
                value={minText}
                onChangeText={setMinText}
                onBlur={commitReps}
                keyboardType="number-pad"
                placeholder="8"
                placeholderClassName="text-on-surface-muted"
                className="h-11 rounded-lg bg-surface px-3 font-sans text-on-surface"
                style={{ fontVariant: ['tabular-nums'] }}
              />
            </View>
            <View className="flex-1">
              <Text className="mb-1 font-sans text-xs text-on-surface-muted">Wdh. Max</Text>
              <TextInput
                value={maxText}
                onChangeText={setMaxText}
                onBlur={commitReps}
                keyboardType="number-pad"
                placeholder="12"
                placeholderClassName="text-on-surface-muted"
                className="h-11 rounded-lg bg-surface px-3 font-sans text-on-surface"
                style={{ fontVariant: ['tabular-nums'] }}
              />
            </View>
          </View>
          {repsError && <Text className="mt-1 font-sans text-xs text-error">{repsError}</Text>}

          <Text className="mb-1 mt-4 font-sans text-xs text-on-surface-muted">Pause</Text>
          <View className="flex-row flex-wrap items-center gap-2">
            {REST_PRESETS.map((seconds) => (
              <Pressable
                key={seconds}
                onPress={() => selectRestPreset(seconds)}
                android_ripple={{ color: '#21360033' }}
                className={`h-10 items-center justify-center rounded-full px-4 active:opacity-90 ${
                  row.restSeconds === seconds ? 'bg-primary' : 'bg-surface-container-high'
                }`}
              >
                <Text
                  className={`font-sans ${row.restSeconds === seconds ? 'font-bold text-on-primary' : 'text-on-surface'}`}
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {seconds}s
                </Text>
              </Pressable>
            ))}
            {/* "Frei"-Chip: eigenes, permanent sichtbares Label statt eines
                Placeholder-Texts als Beschriftung (siehe Abschlussbericht —
                der Gerätetest zeigte "frei" als "trei" gerendert, vermutlich
                Cursor/Placeholder-Überlappung bei zentriertem Text in einem
                sehr schmalen Feld). Das Label ist jetzt ein eigenes <Text>,
                die Zahl bekommt ein eigenes, breiteres Eingabefeld. */}
            <View
              className={`h-10 flex-row items-center gap-1.5 rounded-full px-3 ${
                isCustomRest ? 'bg-primary' : 'bg-surface-container-high'
              }`}
            >
              <Text className={`font-sans text-sm ${isCustomRest ? 'font-bold text-on-primary' : 'text-on-surface-muted'}`}>
                Frei
              </Text>
              <TextInput
                value={restText}
                onChangeText={setRestText}
                onBlur={commitRestFromText}
                keyboardType="number-pad"
                placeholder="Sek."
                placeholderClassName="text-on-surface-muted"
                className={`h-10 w-14 font-sans text-center ${isCustomRest ? 'font-bold text-on-primary' : 'text-on-surface'}`}
                style={{ fontVariant: ['tabular-nums'] }}
              />
            </View>
          </View>
          {restError && <Text className="mt-1 font-sans text-xs text-error">{restError}</Text>}
        </View>
      )}
    </View>
  );
}

export default function PlanEditorScreen() {
  const { id: planId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: planRows } = useLiveQuery(buildPlanQuery(planId), [planId]);
  const plan = planRows[0];
  const { data: exerciseRows } = useLiveQuery(buildPlanExercisesQuery(planId), [planId]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loadedPlanId, setLoadedPlanId] = useState<string | null>(null);
  const [nameFocused, setNameFocused] = useState(false);

  useEffect(() => {
    if (plan && loadedPlanId !== plan.id) {
      setName(plan.name);
      setDescription(plan.description ?? '');
      setLoadedPlanId(plan.id);
    }
  }, [plan, loadedPlanId]);

  function commitName() {
    setNameFocused(false);
    if (!plan) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setName(plan.name);
      return;
    }
    if (trimmed === plan.name) return;
    updatePlan(plan.id, { name: trimmed }).catch((error: unknown) => {
      console.error(error);
      Alert.alert('Fehler', 'Name konnte nicht gespeichert werden.');
      setName(plan.name);
    });
  }

  function commitDescription() {
    if (!plan) return;
    const trimmed = description.trim();
    if (trimmed === (plan.description ?? '')) return;
    updatePlan(plan.id, { description: trimmed || undefined }).catch((error: unknown) => {
      console.error(error);
      Alert.alert('Fehler', 'Beschreibung konnte nicht gespeichert werden.');
    });
  }

  function handleAddExercise() {
    setExercisePickHandler((exerciseId) => {
      addExerciseToPlan(planId, exerciseId).catch((error: unknown) => {
        console.error(error);
        Alert.alert('Fehler', 'Übung konnte nicht hinzugefügt werden.');
      });
    });
    router.push('/exercises');
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Plan bearbeiten' }} />
      {!plan ? (
        <View className="flex-1 items-center justify-center bg-surface">
          <Text className="font-sans text-on-surface-muted">Plan wird geladen…</Text>
        </View>
      ) : (
        <View className="flex-1 bg-surface">
          <FlatList
            data={exerciseRows}
            keyExtractor={(item) => item.id}
            contentContainerClassName="px-4 pb-8 pt-4"
            ListHeaderComponent={
              <View className="mb-4">
                <Text className="mb-1 font-sans text-xs text-on-surface-muted">Name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  onFocus={() => setNameFocused(true)}
                  onBlur={commitName}
                  onSubmitEditing={commitName}
                  returnKeyType="done"
                  className={`h-12 rounded-lg border bg-surface px-3 font-sans text-xl font-bold text-on-surface ${
                    nameFocused ? 'border-primary' : 'border-outline'
                  }`}
                  placeholder="Planname"
                  placeholderClassName="text-on-surface-muted"
                />
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  onBlur={commitDescription}
                  multiline
                  className="mt-2 min-h-[44px] rounded-lg bg-surface-container px-3 py-2 font-sans text-sm text-on-surface"
                  placeholder="Beschreibung (optional)"
                  placeholderClassName="text-on-surface-muted"
                />
              </View>
            }
            ListEmptyComponent={
              <Text className="mb-4 text-center font-sans text-sm text-on-surface-muted">Noch keine Übungen in diesem Plan.</Text>
            }
            renderItem={({ item, index }) => (
              <PlanExerciseRowCard row={item} isFirst={index === 0} isLast={index === exerciseRows.length - 1} />
            )}
            ListFooterComponent={
              <Pressable
                onPress={handleAddExercise}
                android_ripple={{ color: '#ffffff1a' }}
                className="mt-2 h-14 flex-row items-center justify-center gap-2 rounded-lg border border-outline active:opacity-80"
              >
                <Ionicons name="add" size={20} color={COLOR_ON_SURFACE} />
                <Text className="font-sans text-base font-bold text-on-surface">Übung hinzufügen</Text>
              </Pressable>
            }
          />
        </View>
      )}
    </>
  );
}
