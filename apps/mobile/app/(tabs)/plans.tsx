import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Plan } from '@ascent/shared';

import { buildPlanExerciseCountsQuery, buildPlansQuery, createPlan, softDeletePlan } from '../../src/data/plans';
import { getOwnerUserId } from '../../src/lib/owner';
import { Screen } from '../../src/ui/Screen';

// Ionicons-Farben als Literale — Icon-Komponenten unterstützen keine
// className-Farbsteuerung, siehe tailwind.config.js für die Quelle der Tokens.
const COLOR_ON_SURFACE_MUTED = '#a0a0a0';
const COLOR_ON_PRIMARY = '#213600';
const COLOR_ERROR = '#ffb4ab';

/** Anzahl (nicht gelöschter) Plan-Übungen je Plan, client-seitig aus der reaktiven Liste gezählt (siehe src/data/plans.ts). */
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

export default function PlansScreen() {
  const router = useRouter();
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getOwnerUserId().then((id) => {
      if (!cancelled) setOwnerUserId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Placeholder-Query ('' matcht nie eine echte userId) solange ownerUserId
  // noch lädt — hält die Hook-Reihenfolge stabil (kein bedingter Hook-Aufruf).
  const { data: planRows } = useLiveQuery(buildPlansQuery(ownerUserId ?? ''), [ownerUserId]);
  const exerciseCounts = usePlanExerciseCounts();

  function openCreateModal() {
    setNameInput('');
    setModalVisible(true);
  }

  async function handleCreate() {
    const name = nameInput.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const plan = await createPlan(name);
      setModalVisible(false);
      router.push({ pathname: '/plans/[id]', params: { id: plan.id } });
    } catch (error) {
      console.error(error);
      Alert.alert('Fehler', 'Plan konnte nicht erstellt werden.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(plan: Plan) {
    Alert.alert('Plan löschen?', `„${plan.name}“ wird endgültig gelöscht.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => {
          softDeletePlan(plan.id).catch((error: unknown) => {
            console.error(error);
            Alert.alert('Fehler', 'Plan konnte nicht gelöscht werden.');
          });
        },
      },
    ]);
  }

  return (
    <Screen title="Meine Pläne" subtitle="Deine Trainingspläne" scroll={false}>
      <FlatList
        data={planRows}
        keyExtractor={(item) => item.id}
        className="flex-1"
        contentContainerClassName="flex-grow px-4 pb-28 pt-2"
        ListEmptyComponent={
          <View className="mt-16 items-center px-6">
            <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-surface-container">
              <Ionicons name="barbell-outline" size={32} color={COLOR_ON_SURFACE_MUTED} />
            </View>
            <Text className="text-center font-sans text-base leading-6 text-on-surface-muted">
              Noch keine Trainingspläne. Leg los und erstelle deinen ersten Plan — so behältst du deine Übungen und
              Fortschritte im Blick.
            </Text>
            <Pressable
              onPress={openCreateModal}
              android_ripple={{ color: '#21360033' }}
              className="mt-6 h-12 min-w-[200px] flex-row items-center justify-center gap-2 rounded-lg bg-primary px-6 active:opacity-90"
            >
              <Ionicons name="add" size={20} color={COLOR_ON_PRIMARY} />
              <Text className="font-sans text-base font-bold text-on-primary">Neuer Plan</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/plans/[id]', params: { id: item.id } })}
            onLongPress={() => confirmDelete(item)}
            android_ripple={{ color: '#ffffff0f' }}
            className="mb-3 flex-row items-center rounded-lg border border-surface-container-high bg-surface-container p-4 active:opacity-90"
          >
            <View className="h-12 w-12 items-center justify-center rounded-lg bg-surface-container-high">
              <Ionicons name="barbell-outline" size={22} color={COLOR_ON_SURFACE_MUTED} />
            </View>
            <View className="ml-3 flex-1 pr-2">
              <Text className="font-sans text-xl font-bold text-on-surface" numberOfLines={1}>
                {item.name}
              </Text>
              <Text className="mt-1 font-sans text-sm text-on-surface-muted" style={{ fontVariant: ['tabular-nums'] }}>
                {formatExerciseCount(exerciseCounts.get(item.id) ?? 0)}
              </Text>
            </View>
            <Pressable
              onPress={() => confirmDelete(item)}
              hitSlop={8}
              android_ripple={{ color: '#ffb4ab33', borderless: true }}
              className="h-12 w-12 items-center justify-center rounded-full active:opacity-70"
            >
              <Ionicons name="trash-outline" size={20} color={COLOR_ERROR} />
            </Pressable>
            <Ionicons name="chevron-forward" size={20} color={COLOR_ON_SURFACE_MUTED} />
          </Pressable>
        )}
      />

      <Pressable
        onPress={openCreateModal}
        android_ripple={{ color: '#21360033' }}
        className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg active:opacity-90"
      >
        <Ionicons name="add" size={28} color={COLOR_ON_PRIMARY} />
      </Pressable>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View className="flex-1 items-center justify-center bg-black/60 px-6">
          <View className="w-full rounded-lg bg-surface-container p-5">
            <Text className="mb-3 font-sans text-xl font-bold text-on-surface">Neuer Plan</Text>
            <TextInput
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Planname"
              placeholderClassName="text-on-surface-muted"
              autoFocus
              className="h-12 rounded-lg bg-surface px-3 font-sans text-base text-on-surface"
              onSubmitEditing={handleCreate}
              returnKeyType="done"
            />
            <View className="mt-4 flex-row justify-end">
              <Pressable
                onPress={() => setModalVisible(false)}
                className="h-12 items-center justify-center px-4 active:opacity-70"
              >
                <Text className="font-sans text-base text-on-surface-muted">Abbrechen</Text>
              </Pressable>
              <Pressable
                onPress={handleCreate}
                disabled={saving || !nameInput.trim()}
                android_ripple={{ color: '#21360033' }}
                className={`h-12 items-center justify-center rounded-lg px-5 active:opacity-90 ${
                  saving || !nameInput.trim() ? 'bg-primary/40' : 'bg-primary'
                }`}
              >
                <Text className="font-sans text-base font-bold text-on-primary">Erstellen</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
