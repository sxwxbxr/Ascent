import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import {
  buildExerciseByIdQuery,
  categoryLabelDe,
  EXERCISE_CATEGORIES,
  softDeleteOwnExercise,
  updateOwnExercise,
} from '../../src/data/exercises';

export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: rows } = useLiveQuery(buildExerciseByIdQuery(id), [id]);
  const exercise = rows[0];

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [primaryMuscle, setPrimaryMuscle] = useState('');
  const [equipment, setEquipment] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);

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
        <Text className="text-on-surface-muted">Übung wird geladen…</Text>
      </View>
    );
  }

  const displayName = exercise.nameDe ?? exercise.name;
  const isOwn = exercise.userId != null;
  const instructionsText = exercise.instructionsDe ?? exercise.instructionsEn;
  const isEnglishOnly = !exercise.instructionsDe && !!exercise.instructionsEn;

  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen options={{ title: displayName }} />
      <ScrollView contentContainerClassName="pb-8">
        {exercise.gifUrl ? (
          <Image source={{ uri: exercise.gifUrl }} className="aspect-square w-full bg-surface-container" resizeMode="cover" />
        ) : (
          <View className="aspect-square w-full items-center justify-center bg-surface-container">
            <Text className="text-6xl font-bold text-on-surface-muted">{displayName.charAt(0).toUpperCase() || '?'}</Text>
          </View>
        )}

        <View className="px-4 pt-4">
          <Text className="text-2xl font-bold text-on-surface">{displayName}</Text>

          <View className="mt-3 flex-row flex-wrap gap-2">
            {exercise.category && (
              <View className="rounded-full bg-surface-container-high px-3 py-1.5">
                <Text className="text-xs font-bold uppercase text-on-surface">{categoryLabelDe(exercise.category)}</Text>
              </View>
            )}
            {exercise.primaryMuscle && (
              <View className="rounded-full bg-surface-container-high px-3 py-1.5">
                <Text className="text-xs font-bold uppercase text-on-surface">{exercise.primaryMuscle}</Text>
              </View>
            )}
            {exercise.equipment && (
              <View className="rounded-full bg-surface-container-high px-3 py-1.5">
                <Text className="text-xs font-bold uppercase text-on-surface">{exercise.equipment}</Text>
              </View>
            )}
          </View>

          <Text className="mb-1 mt-6 text-sm font-bold uppercase tracking-wide text-primary">Ausführung</Text>
          {instructionsText ? (
            <>
              {isEnglishOnly && <Text className="mb-2 text-xs italic text-on-surface-muted">Auf Englisch — Übersetzung folgt</Text>}
              <Text className="text-base leading-6 text-on-surface-muted">{instructionsText}</Text>
            </>
          ) : (
            <Text className="text-base text-on-surface-muted">Keine Anleitung vorhanden.</Text>
          )}

          {isOwn && !editing && (
            <View className="mt-6 flex-row gap-3">
              <Pressable onPress={startEditing} className="h-12 flex-1 items-center justify-center rounded-lg border border-primary">
                <Text className="font-bold text-primary">Bearbeiten</Text>
              </Pressable>
              <Pressable onPress={handleDelete} className="h-12 flex-1 items-center justify-center rounded-lg border border-error">
                <Text className="font-bold text-error">Löschen</Text>
              </Pressable>
            </View>
          )}

          {isOwn && editing && (
            <View className="mt-6">
              <Text className="mb-1 text-sm text-on-surface-muted">Name *</Text>
              <TextInput value={name} onChangeText={setName} className="h-12 rounded-lg bg-surface-container px-3 text-base text-on-surface" />

              <Text className="mb-1 mt-4 text-sm text-on-surface-muted">Kategorie</Text>
              <View className="flex-row flex-wrap gap-2">
                <Pressable
                  onPress={() => setCategory(null)}
                  className={`h-10 items-center justify-center rounded-full px-4 ${
                    category === null ? 'bg-primary' : 'bg-surface-container-high'
                  }`}
                >
                  <Text className={category === null ? 'font-bold text-on-primary' : 'text-on-surface'}>Keine</Text>
                </Pressable>
                {EXERCISE_CATEGORIES.map((item) => (
                  <Pressable
                    key={item.value}
                    onPress={() => setCategory(item.value)}
                    className={`h-10 items-center justify-center rounded-full px-4 ${
                      category === item.value ? 'bg-primary' : 'bg-surface-container-high'
                    }`}
                  >
                    <Text className={category === item.value ? 'font-bold text-on-primary' : 'text-on-surface'}>{item.labelDe}</Text>
                  </Pressable>
                ))}
              </View>

              <Text className="mb-1 mt-4 text-sm text-on-surface-muted">Zielmuskel</Text>
              <TextInput
                value={primaryMuscle}
                onChangeText={setPrimaryMuscle}
                className="h-12 rounded-lg bg-surface-container px-3 text-base text-on-surface"
              />

              <Text className="mb-1 mt-4 text-sm text-on-surface-muted">Equipment</Text>
              <TextInput
                value={equipment}
                onChangeText={setEquipment}
                className="h-12 rounded-lg bg-surface-container px-3 text-base text-on-surface"
              />

              <Text className="mb-1 mt-4 text-sm text-on-surface-muted">Anleitung</Text>
              <TextInput
                value={instructions}
                onChangeText={setInstructions}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                className="min-h-[120px] rounded-lg bg-surface-container px-3 py-2 text-base text-on-surface"
              />

              <View className="mt-4 flex-row gap-3">
                <Pressable
                  onPress={() => setEditing(false)}
                  className="h-12 flex-1 items-center justify-center rounded-lg border border-outline"
                >
                  <Text className="font-bold text-on-surface-muted">Abbrechen</Text>
                </Pressable>
                <Pressable
                  onPress={handleSave}
                  disabled={saving}
                  className={`h-12 flex-1 items-center justify-center rounded-lg ${saving ? 'bg-primary/50' : 'bg-primary'}`}
                >
                  <Text className="font-bold text-on-primary">Speichern</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
