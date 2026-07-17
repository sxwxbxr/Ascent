import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { createOwnExercise, EXERCISE_CATEGORIES } from '../../src/data/exercises';
import { consumeExercisePick, hasExercisePickHandler } from '../../src/lib/exercise-picker';

/**
 * Formular für eine eigene Übung. Läuft dieser Screen innerhalb eines
 * Picker-Flows (siehe src/lib/exercise-picker.ts), wird die neu angelegte
 * Übung nach dem Speichern direkt als Auswahl übergeben.
 */
export default function NewExerciseScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [primaryMuscle, setPrimaryMuscle] = useState('');
  const [equipment, setEquipment] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Name ist erforderlich.');
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      const exercise = await createOwnExercise({
        name: trimmedName,
        category: category ?? undefined,
        primaryMuscle: primaryMuscle.trim() || undefined,
        equipment: equipment.trim() || undefined,
        instructionsDe: instructions.trim() || undefined,
      });
      if (hasExercisePickHandler()) {
        consumeExercisePick(exercise.id);
      }
      router.back();
    } catch (error) {
      console.error(error);
      Alert.alert('Fehler', 'Übung konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen options={{ title: 'Neue Übung' }} />
      <ScrollView contentContainerClassName="px-4 pb-8 pt-4" keyboardShouldPersistTaps="handled">
        <Text className="mb-1 text-sm text-on-surface-muted">Name *</Text>
        <TextInput
          value={name}
          onChangeText={(value) => {
            setName(value);
            if (nameError) setNameError(null);
          }}
          placeholder="z. B. Bankdrücken"
          placeholderClassName="text-on-surface-muted"
          className="h-12 rounded-lg bg-surface-container px-3 text-base text-on-surface"
        />
        {nameError && <Text className="mt-1 text-xs text-error">{nameError}</Text>}

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
          placeholder="z. B. Brust"
          placeholderClassName="text-on-surface-muted"
          className="h-12 rounded-lg bg-surface-container px-3 text-base text-on-surface"
        />

        <Text className="mb-1 mt-4 text-sm text-on-surface-muted">Equipment</Text>
        <TextInput
          value={equipment}
          onChangeText={setEquipment}
          placeholder="z. B. Langhantel"
          placeholderClassName="text-on-surface-muted"
          className="h-12 rounded-lg bg-surface-container px-3 text-base text-on-surface"
        />

        <Text className="mb-1 mt-4 text-sm text-on-surface-muted">Anleitung</Text>
        <TextInput
          value={instructions}
          onChangeText={setInstructions}
          placeholder="Ausführung beschreiben…"
          placeholderClassName="text-on-surface-muted"
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          className="min-h-[120px] rounded-lg bg-surface-container px-3 py-2 text-base text-on-surface"
        />

        <Pressable
          onPress={handleSave}
          disabled={saving}
          className={`mt-6 h-14 items-center justify-center rounded-lg ${saving ? 'bg-primary/50' : 'bg-primary'}`}
        >
          <Text className="text-base font-bold text-on-primary">Speichern</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
