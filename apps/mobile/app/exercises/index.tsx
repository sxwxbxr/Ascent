import { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';

import { buildDistinctEquipmentQuery, buildExerciseListQuery, EXERCISE_CATEGORIES } from '../../src/data/exercises';
import { consumeExercisePick, hasExercisePickHandler } from '../../src/lib/exercise-picker';
import { getOwnerUserId } from '../../src/lib/owner';

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 250;

function ExerciseThumbnail({ uri, label }: { uri: string | null; label: string }) {
  if (uri) {
    return <Image source={{ uri }} className="h-14 w-14 rounded-lg bg-surface-container-high" />;
  }
  return (
    <View className="h-14 w-14 items-center justify-center rounded-lg bg-surface-container-high">
      <Text className="text-xl font-bold text-on-surface-muted">{label.charAt(0).toUpperCase() || '?'}</Text>
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
      consumeExercisePick(exerciseId);
      router.back();
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
            <Pressable onPress={() => router.push('/exercises/new')} className="h-12 items-center justify-center px-2">
              <Text className="text-sm font-bold text-primary">+ Eigene Übung</Text>
            </Pressable>
          ),
        }}
      />

      <View className="px-4 pt-3">
        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Übung suchen…"
          placeholderClassName="text-on-surface-muted"
          className="h-12 rounded-lg bg-surface-container px-3 text-base text-on-surface"
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-3"
        contentContainerClassName="gap-2 px-4"
      >
        <Pressable
          onPress={() => setOnlyOwn((value) => !value)}
          className={`h-10 items-center justify-center rounded-full px-4 ${onlyOwn ? 'bg-primary' : 'bg-surface-container-high'}`}
        >
          <Text className={onlyOwn ? 'font-bold text-on-primary' : 'text-on-surface'}>Eigene</Text>
        </Pressable>
        <Pressable
          onPress={() => setCategory(null)}
          className={`h-10 items-center justify-center rounded-full px-4 ${category === null ? 'bg-primary' : 'bg-surface-container-high'}`}
        >
          <Text className={category === null ? 'font-bold text-on-primary' : 'text-on-surface'}>Alle</Text>
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
      </ScrollView>

      {equipmentOptions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-2"
          contentContainerClassName="gap-2 px-4"
        >
          <Pressable
            onPress={() => setEquipment(null)}
            className={`h-10 items-center justify-center rounded-full px-4 ${equipment === null ? 'bg-primary' : 'bg-surface-container-high'}`}
          >
            <Text className={equipment === null ? 'font-bold text-on-primary' : 'text-on-surface'}>Alle Geräte</Text>
          </Pressable>
          {equipmentOptions.map((item) => (
            <Pressable
              key={item}
              onPress={() => setEquipment(item)}
              className={`h-10 items-center justify-center rounded-full px-4 ${
                equipment === item ? 'bg-primary' : 'bg-surface-container-high'
              }`}
            >
              <Text className={equipment === item ? 'font-bold text-on-primary' : 'text-on-surface'}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-4 pb-8 pt-3"
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasMore) setVisibleLimit((limit) => limit + PAGE_SIZE);
        }}
        ListEmptyComponent={<Text className="mt-8 text-center text-sm text-on-surface-muted">Keine Übungen gefunden.</Text>}
        renderItem={({ item, index }) => {
          const previous = index > 0 ? rows[index - 1] : undefined;
          const startsOwnSection = item.userId != null && (previous === undefined || previous.userId == null);
          const displayName = item.nameDe ?? item.name;
          return (
            <View>
              {startsOwnSection && (
                <Text className="mb-2 mt-1 text-xs font-bold uppercase tracking-wide text-on-surface-muted">Eigene Übungen</Text>
              )}
              <Pressable
                onPress={() => handleSelect(item.id)}
                className="mb-3 flex-row items-center rounded-lg border border-surface-container-high bg-surface-container p-3"
              >
                <ExerciseThumbnail uri={item.thumbnailUrl} label={displayName} />
                <View className="ml-3 flex-1">
                  <Text numberOfLines={1} className="text-base font-bold text-on-surface">
                    {displayName}
                  </Text>
                  {item.primaryMuscle && <Text className="mt-0.5 text-sm text-on-surface-muted">{item.primaryMuscle}</Text>}
                </View>
                <Text className="text-2xl text-on-surface-muted">{isPicking ? '+' : '›'}</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}
