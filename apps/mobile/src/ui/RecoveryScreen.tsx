import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resetLocalDatabase } from '../db/client';
import { resetSyncCursors } from '../db/sync';

/**
 * Boot-Guard-Auffangschirm: erscheint, wenn die App beim Start nicht sauber
 * hochkommt (fehlgeschlagene DB-Migration oder ein Render-Fehler in der
 * Startphase — siehe app/_layout.tsx). Statt eines harten Absturzes (der
 * Beta-Tester musste die App deinstallieren) bekommt der Nutzer hier einen
 * Ausweg: die lokale Datenbank zurücksetzen. Die eigentlichen Daten liegen
 * auf dem Server und kommen nach dem Neustart per Sync vollständig zurück.
 */
export function RecoveryScreen({ detail }: { detail?: string }) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<'idle' | 'resetting' | 'done'>('idle');

  async function handleReset(): Promise<void> {
    setState('resetting');
    try {
      await resetSyncCursors();
      resetLocalDatabase();
    } catch (err) {
      console.log('[Recovery] Reset-Fehler (unkritisch, Neustart löst es):', err);
    }
    setState('done');
  }

  return (
    <View className="flex-1 bg-surface" style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}>
      <ScrollView contentContainerClassName="flex-grow justify-center px-8 gap-5">
        <Text className="font-sans text-3xl font-extrabold italic tracking-tighter text-primary">ASCENT</Text>

        {state === 'done' ? (
          <>
            <Text className="font-sans text-2xl font-bold text-on-surface">Zurückgesetzt</Text>
            <Text className="font-sans text-base leading-6 text-on-surface-muted">
              Die lokalen Daten wurden geleert. Bitte schliesse die App vollständig und öffne sie erneut —
              danach lädt sie deinen Trainingsstand automatisch vom Server.
            </Text>
          </>
        ) : (
          <>
            <Text className="font-sans text-2xl font-bold text-on-surface">Da ist etwas schiefgelaufen</Text>
            <Text className="font-sans text-base leading-6 text-on-surface-muted">
              Die App konnte ihre lokalen Daten nicht laden — das passiert manchmal nach einem Update. Setze die
              lokalen Daten zurück, um weiterzumachen. Deine Trainings, Pläne und Übungen bleiben auf dem Server
              gespeichert und werden danach neu geladen.
            </Text>
            {detail ? (
              <Text className="font-sans text-xs text-on-surface-muted opacity-60" numberOfLines={4}>
                {detail}
              </Text>
            ) : null}
            <Pressable
              className="mt-2 h-14 items-center justify-center rounded-lg bg-primary active:opacity-90"
              android_ripple={{ color: 'rgba(0,0,0,0.15)' }}
              disabled={state === 'resetting'}
              onPress={handleReset}
            >
              {state === 'resetting' ? (
                <ActivityIndicator color="#213600" />
              ) : (
                <Text className="font-sans text-base font-bold text-on-primary">Lokale Daten zurücksetzen</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}
