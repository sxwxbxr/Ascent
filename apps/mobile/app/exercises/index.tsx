import { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  buildDistinctEquipmentQuery,
  buildExerciseListQuery,
  capitalizeWords,
  EXERCISE_CATEGORIES,
  muscleLabelDe,
} from '../../src/data/exercises';
import { consumeExercisePick, hasExercisePickHandler } from '../../src/lib/exercise-picker';
import { getOwnerUserId } from '../../src/lib/owner';

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 250;
/** Kurze Feedback-Verzögerung im Pick-Modus, bevor router.back() greift (Rand-Highlight sichtbar machen). */
const PICK_FEEDBACK_MS = 150;

// Ionicons-Farben als Literale — Icon-Komponenten unterstützen keine
// className-Farbsteuerung, siehe tailwind.config.js für die Quelle der Tokens.
const COLOR_ON_SURFACE = '#e5e2e1';
const COLOR_ON_SURFACE_MUTED = '#a0a0a0';
const COLOR_ON_PRIMARY = '#213600';

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
      <Text className="font-sans text-xl font-bold text-on-surface-muted">{label.charAt(0).toUpperCase() || '?'}</Text>
    </View>
  );
}

/** Übungsliste + Picker (siehe src/lib/exercise-picker.ts): gleicher Screen, zwei Rollen je nach hasExercisePickHandler(). */
export default function ExercisesScreen() {
  const router = useRouter();
  const isPicking = hasExercisePickHandler();

  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);
  const [onlyOwn, setOnlyOwn] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  // Kurzes visuelles Feedback im Pick-Modus: Zeile hervorheben, bevor
  // consumeExercisePick()+router.back() den Screen verlassen.
  const [selectingId, setSelectingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOwnerUserId().then((id) => {
      if (!cancelled) setOwnerUserId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce (250ms): vermeidet eine Query pro Tastenanschlag.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Bei Filterwechsel wieder von vorne paginieren.
  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [debouncedSearch, category, equipment, onlyOwn]);

  const { data: rows } = useLiveQuery(
    buildExerciseListQuery({
      ownerUserId: ownerUserId ?? '',
      search: debouncedSearch,
      category: category ?? undefined,
      equipment: equipment ?? undefined,
      onlyOwn,
      limit: visibleLimit,
    }),
    [ownerUserId, debouncedSearch, category, equipment, onlyOwn, visibleLimit],
  );

  const { data: equipmentRows } = useLiveQuery(buildDistinctEquipmentQuery());
  const equipmentOptions = useMemo(
    () => equipmentRows.map((row) => row.equipment).filter((value): value is string => !!value),
    [equipmentRows],
  );

  // Heuristik fürs Nachladen: kam eine volle Seite zurück, könnte mehr folgen.
  const hasMore = rows.length === visibleLimit;

  function handleSelect(exerciseId: string) {
    if (isPicking) {
      if (selectingId) return; // Doppel-Tap während der Feedback-Verzögerung ignorieren
      setSelectingId(exerciseId);
      setTimeout(() => {
        consumeExercisePick(exerciseId);
        router.back();
      }, PICK_FEEDBACK_MS);
    } else {
      router.push({ pathname: '/exercises/[id]', params: { id: exerciseId } });
    }
  }

  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen
        options={{
          title: isPicking ? 'Übung wählen' : 'Übungen',
          headerRight: () => (
            <Pressable onPress={() => router.push('/exercises/new')} className="h-12 items-center justify-center px-2 active:opacity-70">
              <Text className="font-sans text-sm font-bold text-primary">+ Eigene Übung</Text>
            </Pressable>
          ),
        }}
      />

      <View className="px-4 pt-3">
        <View className="relative justify-center">
          <View className="absolute left-3 z-10">
            <Ionicons name="search" size={18} color={COLOR_ON_SURFACE_MUTED} />
          </View>
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Übung suchen…"
            placeholderClassName="text-on-surface-muted"
            className="h-12 rounded-lg bg-surface-container pl-10 pr-3 font-sans text-base text-on-surface"
          />
        </View>
      </View>

      <View className="mt-4">
        <Text className="mb-1 px-4 font-sans text-xs text-on-surface-muted">Muskelgruppe</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 px-4 pb-1"
        >
          <Pressable
            onPress={() => setOnlyOwn((value) => !value)}
            className={`h-10 items-center justify-center rounded-full px-4 active:opacity-90 ${onlyOwn ? 'bg-primary' : 'bg-surface-container-high'}`}
          >
            <Text className={`font-sans ${onlyOwn ? 'font-bold text-on-primary' : 'text-on-surface'}`}>Eigene</Text>
          </Pressable>
          <Pressable
            onPress={() => setCategory(null)}
            className={`h-10 items-center justify-center rounded-full px-4 active:opacity-90 ${category === null ? 'bg-primary' : 'bg-surface-container-high'}`}
          >
            <Text className={`font-sans ${category === null ? 'font-bold text-on-primary' : 'text-on-surface'}`}>Alle</Text>
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
        </ScrollView>
      </View>

      {equipmentOptions.length > 0 && (
        <View className="mt-3">
          <Text className="mb-1 px-4 font-sans text-xs text-on-surface-muted">Equipment</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2 px-4 pb-1"
          >
            <Pressable
              onPress={() => setEquipment(null)}
              className={`h-10 items-center justify-center rounded-full px-4 active:opacity-90 ${equipment === null ? 'bg-primary' : 'bg-surface-container-high'}`}
            >
              <Text className={`font-sans ${equipment === null ? 'font-bold text-on-primary' : 'text-on-surface'}`}>Alle Geräte</Text>
            </Pressable>
            {equipmentOptions.map((item) => (
              <Pressable
                key={item}
                onPress={() => setEquipment(item)}
                className={`h-10 items-center justify-center rounded-full px-4 active:opacity-90 ${
                  equipment === item ? 'bg-primary' : 'bg-surface-container-high'
                }`}
              >
                <Text className={`font-sans ${equipment === item ? 'font-bold text-on-primary' : 'text-on-surface'}`}>
                  {capitalizeWords(item)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-4 pb-8 pt-3"
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasMore) setVisibleLimit((limit) => limit + PAGE_SIZE);
        }}
        ListEmptyComponent={<Text className="mt-8 text-center font-sans text-sm text-on-surface-muted">Keine Übungen gefunden.</Text>}
        renderItem={({ item, index }) => {
          const previous = index > 0 ? rows[index - 1] : undefined;
          const startsOwnSection = item.userId != null && (previous === undefined || previous.userId == null);
          const displayName = item.nameDe ?? item.name;
          const isSelecting = item.id === selectingId;
          return (
            <View>
              {startsOwnSection && (
                <Text className="mb-2 mt-1 font-sans text-xs font-bold uppercase tracking-wide text-on-surface-muted">
                  Eigene Übungen
                </Text>
              )}
              <Pressable
                onPress={() => handleSelect(item.id)}
                disabled={isPicking && selectingId !== null}
                android_ripple={{ color: '#ffffff0f' }}
                className={`mb-3 flex-row items-center rounded-lg border p-3 active:opacity-90 ${
                  isSelecting ? 'border-primary bg-primary/10' : 'border-surface-container-high bg-surface-container'
                }`}
              >
                <ExerciseThumbnail uri={item.thumbnailUrl} label={displayName} />
                <View className="ml-3 flex-1">
                  <Text numberOfLines={1} className="font-sans text-base font-bold text-on-surface">
                    {displayName}
                  </Text>
                  {item.primaryMuscle && (
                    <Text className="mt-0.5 font-sans text-sm text-on-surface-muted">{muscleLabelDe(item.primaryMuscle)}</Text>
                  )}
                </View>
                {isPicking ? (
                  <View
                    className={`h-12 w-12 items-center justify-center rounded-full border ${
                      isSelecting ? 'border-primary bg-primary' : 'border-outline'
                    }`}
                  >
                    <Ionicons name="add" size={20} color={isSelecting ? COLOR_ON_PRIMARY : COLOR_ON_SURFACE} />
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={20} color={COLOR_ON_SURFACE_MUTED} />
                )}
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}
