import { useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, Text, TextInput, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

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
    return <Image source={{ uri }} className="h-12 w-12 rounded-lg bg-surface-container-high" />;
  }
  return (
    <View className="h-12 w-12 items-center justify-center rounded-lg bg-surface-container-high">
      <Text className="text-lg font-bold text-on-surface-muted">{label.charAt(0).toUpperCase() || '?'}</Text>
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
      <Pressable onPress={() => setExpanded((value) => !value)} className="flex-row items-center p-3">
        <ExerciseThumbnail uri={row.exerciseThumbnailUrl} label={displayName} />
        <View className="ml-3 flex-1">
          <Text numberOfLines={1} className="text-base font-bold text-primary">
            {displayName}
          </Text>
          <Text className="mt-0.5 text-xs uppercase tracking-wide text-on-surface-muted">
            {formatPlanExerciseSummary(row)}
          </Text>
        </View>
        <Pressable
          disabled={isFirst}
          onPress={() => movePlanExercise(row.id, 'hoch').catch(reportError('Reihenfolge konnte nicht geändert werden.'))}
          className="h-12 w-12 items-center justify-center"
        >
          <Text className={`text-lg ${isFirst ? 'text-on-surface-muted/30' : 'text-on-surface-muted'}`}>↑</Text>
        </Pressable>
        <Pressable
          disabled={isLast}
          onPress={() => movePlanExercise(row.id, 'runter').catch(reportError('Reihenfolge konnte nicht geändert werden.'))}
          className="h-12 w-12 items-center justify-center"
        >
          <Text className={`text-lg ${isLast ? 'text-on-surface-muted/30' : 'text-on-surface-muted'}`}>↓</Text>
        </Pressable>
        <Pressable
          onPress={() => removePlanExercise(row.id).catch(reportError('Übung konnte nicht entfernt werden.'))}
          className="h-12 w-12 items-center justify-center"
        >
          <Text className="text-lg text-error">✕</Text>
        </Pressable>
      </Pressable>

      {expanded && (
        <View className="border-t border-surface-container-high p-3">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-sm text-on-surface-muted">Sätze</Text>
            <View className="flex-row items-center">
              <Pressable
                onPress={() => adjustSets(-1)}
                disabled={row.targetSets <= 1}
                className="h-10 w-10 items-center justify-center rounded-lg bg-surface-container-high"
              >
                <Text className="text-lg text-on-surface">–</Text>
              </Pressable>
              <Text className="mx-4 min-w-[24px] text-center text-lg font-bold text-on-surface">{row.targetSets}</Text>
              <Pressable
                onPress={() => adjustSets(1)}
                disabled={row.targetSets >= 20}
                className="h-10 w-10 items-center justify-center rounded-lg bg-surface-container-high"
              >
                <Text className="text-lg text-on-surface">+</Text>
              </Pressable>
            </View>
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Text className="mb-1 text-xs text-on-surface-muted">Wdh. Min</Text>
              <TextInput
                value={minText}
                onChangeText={setMinText}
                onBlur={commitReps}
                keyboardType="number-pad"
                className="h-11 rounded-lg bg-surface px-3 text-on-surface"
              />
            </View>
            <View className="flex-1">
              <Text className="mb-1 text-xs text-on-surface-muted">Wdh. Max</Text>
              <TextInput
                value={maxText}
                onChangeText={setMaxText}
                onBlur={commitReps}
                keyboardType="number-pad"
                className="h-11 rounded-lg bg-surface px-3 text-on-surface"
              />
            </View>
          </View>
          {repsError && <Text className="mt-1 text-xs text-error">{repsError}</Text>}

          <Text className="mb-1 mt-4 text-xs text-on-surface-muted">Pause</Text>
          <View className="flex-row flex-wrap gap-2">
            {REST_PRESETS.map((seconds) => (
              <Pressable
                key={seconds}
                onPress={() => selectRestPreset(seconds)}
                className={`h-10 items-center justify-center rounded-full px-4 ${
                  row.restSeconds === seconds ? 'bg-primary' : 'bg-surface-container-high'
                }`}
              >
                <Text className={row.restSeconds === seconds ? 'font-bold text-on-primary' : 'text-on-surface'}>{seconds}s</Text>
              </Pressable>
            ))}
            <TextInput
              value={restText}
              onChangeText={setRestText}
              onBlur={commitRestFromText}
              keyboardType="number-pad"
              placeholder="frei"
              placeholderClassName="text-on-surface-muted"
              className="h-10 w-20 rounded-full bg-surface-container-high px-3 text-center text-on-surface"
            />
          </View>
          {restError && <Text className="mt-1 text-xs text-error">{restError}</Text>}
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

  useEffect(() => {
    if (plan && loadedPlanId !== plan.id) {
      setName(plan.name);
      setDescription(plan.description ?? '');
      setLoadedPlanId(plan.id);
    }
  }, [plan, loadedPlanId]);

  function commitName() {
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
          <Text className="text-on-surface-muted">Plan wird geladen…</Text>
        </View>
      ) : (
        <View className="flex-1 bg-surface">
          <FlatList
            data={exerciseRows}
            keyExtractor={(item) => item.id}
            contentContainerClassName="px-4 pb-8 pt-4"
            ListHeaderComponent={
              <View className="mb-4">
                <TextInput
                  value={name}
                  onChangeText={setName}
                  onBlur={commitName}
                  onSubmitEditing={commitName}
                  returnKeyType="done"
                  className="h-12 rounded-lg border-b-2 border-primary bg-surface-container px-3 text-xl font-bold text-on-surface"
                  placeholder="Planname"
                  placeholderClassName="text-on-surface-muted"
                />
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  onBlur={commitDescription}
                  multiline
                  className="mt-2 min-h-[44px] rounded-lg bg-surface-container px-3 py-2 text-sm text-on-surface"
                  placeholder="Beschreibung (optional)"
                  placeholderClassName="text-on-surface-muted"
                />
              </View>
            }
            ListEmptyComponent={
              <Text className="mb-4 text-center text-sm text-on-surface-muted">Noch keine Übungen in diesem Plan.</Text>
            }
            renderItem={({ item, index }) => (
              <PlanExerciseRowCard row={item} isFirst={index === 0} isLast={index === exerciseRows.length - 1} />
            )}
            ListFooterComponent={
              <Pressable onPress={handleAddExercise} className="mt-2 h-14 items-center justify-center rounded-lg border border-primary">
                <Text className="text-base font-bold text-primary">+ Übung hinzufügen</Text>
              </Pressable>
            }
          />
        </View>
      )}
    </>
  );
}
