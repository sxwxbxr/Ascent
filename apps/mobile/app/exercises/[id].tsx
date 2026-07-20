import { useMemo, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { epley1Rm } from '@ascent/shared';

import {
  buildExerciseByIdQuery,
  capitalizeWords,
  categoryLabelDe,
  EXERCISE_CATEGORIES,
  muscleLabelDe,
  softDeleteOwnExercise,
  updateOwnExercise,
} from '../../src/data/exercises';
import { getRecentSessionsForExercise } from '../../src/data/workouts';

// Ionicons-Farben als Literale — Icon-Komponenten unterstützen keine
// className-Farbsteuerung, siehe tailwind.config.js für die Quelle der Tokens.
const COLOR_ON_SURFACE = '#e5e2e1';
const COLOR_ERROR = '#ffb4ab';

const historyDateFormatter = new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
const oneDecimalFormatter = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 });

function formatWeight(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : oneDecimalFormatter.format(kg);
}

type MuscleChip = { key: string; label: string; isPrimary: boolean };

/**
 * Chips für die Sektion "Beteiligte Muskeln": Zielmuskel (primaryMuscle, immer
 * zuerst und markiert) + Synergist (muscleGroup) + sekundäre Muskeln
 * (secondaryMuscles, JSON-Array), dedupliziert über den kleingeschriebenen
 * Rohwert. Bestandsdaten (vor der Migration importierte Übungen) können
 * muscleGroup/secondaryMuscles = NULL haben oder — theoretisch — ungültiges
 * JSON enthalten; das try/catch verhindert, dass ein defekter Datensatz die
 * ganze Detailseite zum Absturz bringt (es fallen dann nur die zusätzlichen
 * Chips weg, primaryMuscle bleibt erhalten).
 */
function buildMuscleChips(
  exercise:
    | { primaryMuscle: string | null; muscleGroup: string | null; secondaryMuscles: string | null }
    | undefined,
): MuscleChip[] {
  if (!exercise) return [];
  const seen = new Set<string>();
  const chips: MuscleChip[] = [];

  function addChip(raw: string | null | undefined, isPrimary: boolean) {
    if (!raw) return;
    const key = raw.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    chips.push({ key, label: muscleLabelDe(raw) ?? raw, isPrimary });
  }

  addChip(exercise.primaryMuscle, true);
  addChip(exercise.muscleGroup, false);

  if (exercise.secondaryMuscles) {
    try {
      const parsed = JSON.parse(exercise.secondaryMuscles) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') addChip(item, false);
        }
      }
    } catch {
      // Ungültiges JSON in Bestandsdaten — Sektion bleibt robust, nur die
      // sekundären Muskeln fallen weg.
    }
  }

  return chips;
}

/**
 * Nummerierte EN-Ausführungsschritte aus instructionStepsEn (JSON-Array), oder
 * `null` falls das Feld fehlt, kein gültiges JSON enthält oder nach dem
 * Filtern leer bleibt — der Aufrufer fällt dann auf instructionsEn zurück.
 */
function parseInstructionSteps(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const steps = parsed.filter((step): step is string => typeof step === 'string' && step.trim().length > 0);
    return steps.length > 0 ? steps : null;
  } catch {
    return null;
  }
}

type HistorySession = {
  workoutId: string;
  finishedAt: number;
  setCount: number;
  bestWeightKg: number;
  bestReps: number;
};

export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: rows } = useLiveQuery(buildExerciseByIdQuery(id), [id]);
  const exercise = rows[0];

  // Basistabelle der Query ist workout_sets (siehe getRecentSessionsForExercise
  // in src/data/workouts.ts) — reagiert also live auf jeden neu erfassten Satz
  // dieser Übung. deps=[id] analog zur Übungs-Query oben.
  const { data: historyRows } = useLiveQuery(getRecentSessionsForExercise(id, 5), [id]);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [primaryMuscle, setPrimaryMuscle] = useState('');
  const [equipment, setEquipment] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [mediaModalVisible, setMediaModalVisible] = useState(false);

  const muscleChips = useMemo(
    () => buildMuscleChips(exercise),
    [exercise?.primaryMuscle, exercise?.muscleGroup, exercise?.secondaryMuscles],
  );

  const instructionSteps = useMemo(
    () => parseInstructionSteps(exercise?.instructionStepsEn),
    [exercise?.instructionStepsEn],
  );

  const historySessions = useMemo<HistorySession[]>(() => {
    const map = new Map<string, HistorySession>();
    for (const row of historyRows) {
      if (row.finishedAt == null) continue;
      const existing = map.get(row.workoutId);
      if (existing) {
        existing.setCount += 1;
        if (row.weightKg > existing.bestWeightKg) {
          existing.bestWeightKg = row.weightKg;
          existing.bestReps = row.reps;
        }
      } else {
        map.set(row.workoutId, {
          workoutId: row.workoutId,
          finishedAt: row.finishedAt,
          setCount: 1,
          bestWeightKg: row.weightKg,
          bestReps: row.reps,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.finishedAt - a.finishedAt);
  }, [historyRows]);

  function startEditing() {
    if (!exercise) return;
    setName(exercise.name);
    setCategory(exercise.category);
    setPrimaryMuscle(exercise.primaryMuscle ?? '');
    setEquipment(exercise.equipment ?? '');
    setInstructions(exercise.instructionsDe ?? '');
    setEditing(true);
  }

  async function handleSave() {
    if (!exercise) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Fehler', 'Name ist erforderlich.');
      return;
    }
    setSaving(true);
    try {
      await updateOwnExercise(exercise.id, {
        name: trimmedName,
        category: category ?? undefined,
        primaryMuscle: primaryMuscle.trim() || undefined,
        equipment: equipment.trim() || undefined,
        instructionsDe: instructions.trim() || undefined,
      });
      setEditing(false);
    } catch (error) {
      console.error(error);
      Alert.alert('Fehler', 'Übung konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!exercise) return;
    Alert.alert('Übung löschen?', `„${exercise.name}“ wird endgültig gelöscht.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          try {
            await softDeleteOwnExercise(exercise.id);
            router.back();
          } catch (error) {
            console.error(error);
            Alert.alert('Fehler', 'Übung konnte nicht gelöscht werden.');
          }
        },
      },
    ]);
  }

  if (!exercise) {
    return (
      <View className="flex-1 items-center justify-center bg-surface">
        <Stack.Screen options={{ title: 'Übung' }} />
        <Text className="font-sans text-on-surface-muted">Übung wird geladen…</Text>
      </View>
    );
  }

  const displayName = exercise.nameDe ?? exercise.name;
  const isOwn = exercise.userId != null;
  const hasDistinctEnName = !!exercise.nameDe && exercise.nameDe !== exercise.name;

  // Übersetzung bevorzugen (immer bei eigenen Übungen, sonst sobald jemand die
  // DE-Anleitung nachgetragen hat) — nummerierte Schritte/EN-Fallback nur ohne DE-Text.
  const preferDeInstructions = !!exercise.instructionsDe;
  const stepsToShow = !preferDeInstructions ? instructionSteps : null;

  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen options={{ title: displayName }} />
      <ScrollView contentContainerClassName="pb-8">
        <View className="px-4 pt-4">
          {exercise.gifUrl ? (
            <Pressable
              onPress={() => setMediaModalVisible(true)}
              android_ripple={{ color: '#ffffff1a' }}
              className="active:opacity-90"
            >
              <Image
                source={{ uri: exercise.gifUrl }}
                className="aspect-square w-full rounded-xl border border-surface-container-high bg-surface-container"
                resizeMode="cover"
              />
              <View className="absolute bottom-3 right-3 h-9 w-9 items-center justify-center rounded-full bg-black/50">
                <Ionicons name="expand-outline" size={18} color={COLOR_ON_SURFACE} />
              </View>
            </Pressable>
          ) : (
            <View className="aspect-square w-full items-center justify-center rounded-xl border border-surface-container-high bg-surface-container">
              <Text className="font-sans text-6xl font-bold text-on-surface-muted">{displayName.charAt(0).toUpperCase() || '?'}</Text>
            </View>
          )}
        </View>

        <View className="px-4 pt-4">
          <Text className="font-sans text-2xl font-extrabold text-on-surface">{displayName}</Text>
          {hasDistinctEnName && (
            <Text className="mt-0.5 font-sans text-sm text-on-surface-muted">{exercise.name}</Text>
          )}

          <View className="mt-3 flex-row flex-wrap gap-2">
            {exercise.category && (
              <View className="rounded-full bg-surface-container-high px-3 py-1.5">
                <Text className="font-sans text-xs font-bold uppercase text-on-surface">{categoryLabelDe(exercise.category)}</Text>
              </View>
            )}
            {exercise.primaryMuscle && (
              <View className="rounded-full bg-surface-container-high px-3 py-1.5">
                <Text className="font-sans text-xs font-bold uppercase text-on-surface">{muscleLabelDe(exercise.primaryMuscle)}</Text>
              </View>
            )}
            {exercise.equipment && (
              <View className="rounded-full bg-surface-container-high px-3 py-1.5">
                <Text className="font-sans text-xs font-bold uppercase text-on-surface">{capitalizeWords(exercise.equipment)}</Text>
              </View>
            )}
          </View>

          {muscleChips.length > 0 && (
            <View className="mt-6">
              <Text className="mb-2 font-sans text-sm font-bold uppercase tracking-wide text-primary">Beteiligte Muskeln</Text>
              <View className="flex-row flex-wrap gap-2">
                {muscleChips.map((chip) => (
                  <View
                    key={chip.key}
                    className="flex-row items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5"
                  >
                    {chip.isPrimary && <View className="h-1.5 w-1.5 rounded-full bg-primary" />}
                    <Text className="font-sans text-xs font-bold uppercase text-on-surface">{chip.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <Text className="mb-1 mt-6 font-sans text-sm font-bold uppercase tracking-wide text-primary">Ausführung</Text>
          {preferDeInstructions ? (
            <Text className="font-sans text-base leading-6 text-on-surface-muted">{exercise.instructionsDe}</Text>
          ) : stepsToShow ? (
            <View className="gap-3">
              <Text className="font-sans text-xs italic text-on-surface-muted">Auf Englisch — Übersetzung folgt</Text>
              {stepsToShow.map((step, index) => (
                <View key={index} className="flex-row gap-3">
                  <View className="h-6 w-6 items-center justify-center rounded-full bg-surface-container-high">
                    <Text className="tabular-nums font-sans text-xs font-bold text-on-surface-muted">{index + 1}</Text>
                  </View>
                  <Text className="flex-1 font-sans text-base leading-7 text-on-surface-muted">{step}</Text>
                </View>
              ))}
            </View>
          ) : exercise.instructionsEn ? (
            <>
              <Text className="mb-2 font-sans text-xs italic text-on-surface-muted">Auf Englisch — Übersetzung folgt</Text>
              <Text className="font-sans text-base leading-6 text-on-surface-muted">{exercise.instructionsEn}</Text>
            </>
          ) : (
            <Text className="font-sans text-base text-on-surface-muted">Keine Anleitung vorhanden.</Text>
          )}

          <Text className="mb-1 mt-6 font-sans text-sm font-bold uppercase tracking-wide text-primary">Deine Historie</Text>
          {historySessions.length === 0 ? (
            <Text className="font-sans text-sm text-on-surface-muted">Noch keine Trainings mit dieser Übung.</Text>
          ) : (
            <View className="gap-2">
              {historySessions.map((session) => (
                <View
                  key={session.workoutId}
                  className="flex-row items-center justify-between rounded-lg bg-surface-container p-3"
                >
                  <View className="flex-1 pr-3">
                    <Text className="font-sans text-xs text-on-surface-muted">
                      {historyDateFormatter.format(new Date(session.finishedAt))}
                    </Text>
                    <Text className="tabular-nums mt-0.5 font-sans text-sm font-bold text-on-surface">
                      {session.setCount} {session.setCount === 1 ? 'Satz' : 'Sätze'} · Bester:{' '}
                      {formatWeight(session.bestWeightKg)} kg × {session.bestReps}
                    </Text>
                  </View>
                  <Text className="tabular-nums font-sans text-sm font-bold text-on-surface">
                    1RM ~{formatWeight(epley1Rm(session.bestWeightKg, session.bestReps))} kg
                  </Text>
                </View>
              ))}
            </View>
          )}

          {isOwn && !editing && (
            <View className="mt-6 flex-row gap-3">
              <Pressable
                onPress={startEditing}
                android_ripple={{ color: '#ffffff1a' }}
                className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-lg border border-outline active:opacity-80"
              >
                <Ionicons name="pencil-outline" size={18} color={COLOR_ON_SURFACE} />
                <Text className="font-sans font-bold text-on-surface">Bearbeiten</Text>
              </Pressable>
              <Pressable
                onPress={handleDelete}
                android_ripple={{ color: '#ffffff1a' }}
                className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-lg border border-outline active:opacity-80"
              >
                <Ionicons name="trash-outline" size={18} color={COLOR_ERROR} />
                <Text className="font-sans font-bold text-on-surface">Löschen</Text>
              </Pressable>
            </View>
          )}

          {isOwn && editing && (
            <View className="mt-6">
              <Text className="mb-1 font-sans text-sm text-on-surface-muted">Name *</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                className="h-12 rounded-lg bg-surface-container px-3 font-sans text-base text-on-surface"
              />

              <Text className="mb-1 mt-4 font-sans text-sm text-on-surface-muted">Kategorie</Text>
              <View className="flex-row flex-wrap gap-2">
                <Pressable
                  onPress={() => setCategory(null)}
                  className={`h-10 items-center justify-center rounded-full px-4 active:opacity-90 ${
                    category === null ? 'bg-primary' : 'bg-surface-container-high'
                  }`}
                >
                  <Text className={`font-sans ${category === null ? 'font-bold text-on-primary' : 'text-on-surface'}`}>Keine</Text>
                </Pressable>
                {EXERCISE_CATEGORIES.map((item) => (
                  <Pressable
                    key={item.value}
                    onPress={() => setCategory(item.value)}
                    className={`h-10 items-center justify-center rounded-full px-4 active:opacity-90 ${
                      category === item.value ? 'bg-primary' : 'bg-surface-container-high'
                    }`}
                  >
                    <Text className={`font-sans ${category === item.value ? 'font-bold text-on-primary' : 'text-on-surface'}`}>
                      {item.labelDe}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text className="mb-1 mt-4 font-sans text-sm text-on-surface-muted">Zielmuskel</Text>
              <TextInput
                value={primaryMuscle}
                onChangeText={setPrimaryMuscle}
                className="h-12 rounded-lg bg-surface-container px-3 font-sans text-base text-on-surface"
              />

              <Text className="mb-1 mt-4 font-sans text-sm text-on-surface-muted">Equipment</Text>
              <TextInput
                value={equipment}
                onChangeText={setEquipment}
                className="h-12 rounded-lg bg-surface-container px-3 font-sans text-base text-on-surface"
              />

              <Text className="mb-1 mt-4 font-sans text-sm text-on-surface-muted">Anleitung</Text>
              <TextInput
                value={instructions}
                onChangeText={setInstructions}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                className="min-h-[120px] rounded-lg bg-surface-container px-3 py-2 font-sans text-base text-on-surface"
              />

              <View className="mt-4 flex-row gap-3">
                <Pressable
                  onPress={() => setEditing(false)}
                  className="h-12 flex-1 items-center justify-center rounded-lg border border-outline active:opacity-80"
                >
                  <Text className="font-sans font-bold text-on-surface-muted">Abbrechen</Text>
                </Pressable>
                <Pressable
                  onPress={handleSave}
                  disabled={saving}
                  android_ripple={{ color: '#21360033' }}
                  className={`h-12 flex-1 items-center justify-center rounded-lg active:opacity-90 ${saving ? 'bg-primary/50' : 'bg-primary'}`}
                >
                  <Text className="font-sans font-bold text-on-primary">Speichern</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={mediaModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMediaModalVisible(false)}
      >
        <Pressable className="flex-1 items-center justify-center bg-black" onPress={() => setMediaModalVisible(false)}>
          <Pressable onPress={() => {}} className="w-full">
            {exercise.gifUrl && (
              <Image source={{ uri: exercise.gifUrl }} className="aspect-square w-full" resizeMode="contain" />
            )}
          </Pressable>

          <Pressable
            onPress={() => setMediaModalVisible(false)}
            android_ripple={{ color: 'rgba(255,255,255,0.15)', borderless: true }}
            className="absolute right-4 h-12 w-12 items-center justify-center rounded-full"
            style={{ top: insets.top + 8 }}
          >
            <Ionicons name="close" size={28} color={COLOR_ON_SURFACE} />
          </Pressable>

          <Text className="absolute bottom-8 font-sans text-xs text-on-surface-muted">Animation © Gymvisual</Text>
        </Pressable>
      </Modal>
    </View>
  );
}
