import '../global.css';

import { useEffect } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';

import migrations from '../drizzle/migrations';
import { db } from '../src/db/client';
import { authClient, toSessionUser } from '../src/auth/client';
import { upsertLocalUser } from '../src/db/hydrate';
import { runSync, runSyncThrottled } from '../src/db/sync';
import { resumeActiveWorkout } from '../src/lib/active-workout';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { RecoveryScreen } from '../src/ui/RecoveryScreen';
import { UpdateBanner } from '../src/ui/UpdateBanner';

/**
 * Dunkler Vollbild-Zustand für Migration/Session-Ermittlung (Wortmarke +
 * Hinweis), damit auch dieser kurze Moment zur "Dark Performance"-Optik
 * passt statt einen weissen/leeren Frame zu zeigen.
 */
function FullScreenStatus({ message, isError = false }: { message: string; isError?: boolean }) {
  return (
    <View className="flex-1 items-center justify-center bg-surface px-8">
      <Text className="text-primary text-3xl font-extrabold italic tracking-tighter mb-4">ASCENT</Text>
      {!isError && <ActivityIndicator color="#b4ff39" style={{ marginBottom: 16 }} />}
      <Text className={`text-center ${isError ? 'text-error' : 'text-on-surface-muted'}`}>{message}</Text>
    </View>
  );
}

/**
 * Root-Layout: Migrationslauf, Auth-Gate und (fire-and-forget) Hydration.
 *
 * OFFLINE-ANFORDERUNG (Akzeptanzkriterium): Mit zuvor eingeloggter Session
 * muss die App ohne Netz direkt in die Tabs starten. Verifiziert (siehe
 * ausführlicher Kommentar in src/auth/client.ts) läuft das bereits über die
 * @better-auth/expo-Bibliothek selbst: `getActions` hydratisiert den
 * Session-Atom synchron aus dem SecureStore-Cache, BEVOR diese Komponente
 * zum ersten Mal rendert; schlägt der anschliessende Hintergrund-Refetch
 * offline fehl, behält better-auth die zwischengespeicherten Daten (nur
 * `error` wird gesetzt, `data` bleibt). Deshalb gate't die Bedingung unten
 * bewusst auf `isPending && !session` (nicht auf `isPending` allein) — ist
 * bereits eine (auch gecachte) Session vorhanden, wird sofort freigegeben,
 * unabhängig davon, ob der Hintergrund-Refetch noch läuft oder offline
 * scheitert. Ein eigener zusätzlicher SecureStore-Fallback ist NICHT nötig.
 */
function RootLayoutInner() {
  const { success: migrationsDone, error: migrationsError } = useMigrations(db, migrations);
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!migrationsDone || !session?.user) return;
    const user = toSessionUser(session.user);
    // Fire-and-forget: beide tolerieren Offline/Fehler selbst (console.log,
    // siehe src/db/hydrate.ts bzw. src/db/sync.ts) und dürfen den Render nie
    // blockieren. upsertLocalUser MUSS vor runSync abgeschlossen sein (runSync
    // braucht die lokal gespiegelte users-Zeile für getOwnerUserId), daher
    // verkettet statt beide parallel gestartet.
    upsertLocalUser(user)
      .then(() => runSync())
      .catch((err) => console.log('[RootLayout] upsertLocalUser/runSync fehlgeschlagen:', err));
    // Laufendes (nicht beendetes) Training aus der DB in den Modul-Cache
    // laden, damit Home sofort "fortsetzen" anbieten kann.
    resumeActiveWorkout().catch((err) => console.log('[RootLayout] resumeActiveWorkout fehlgeschlagen:', err));
    // session.user ist ein neues Objekt pro Fetch — wir wollen aber nur bei
    // Identitätswechsel (Login/Logout/Nutzerwechsel) erneut synchronisieren.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [migrationsDone, session?.user?.id]);

  // AppState-Trigger (Reconnect/Wiedereintritt): 'active' → runSync, gedrosselt
  // auf max. 1×/2 Minuten (siehe runSyncThrottled in src/db/sync.ts). Bewusst
  // unabhängig vom Session-Effect oben montiert — runSync() selbst prüft die
  // (gecachte) Session und ist ohne sie ein No-Op.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') runSyncThrottled();
    });
    return () => subscription.remove();
  }, []);

  // Scheitert die Migration (z. B. inkompatible Altdaten nach einem Update —
  // genau der beim Beta-Test beobachtete Absturz), zeigen wir statt eines
  // harten Crashs den Recovery-Screen mit "Lokale Daten zurücksetzen".
  if (migrationsError) {
    return <RecoveryScreen detail={`Migration: ${migrationsError.message}`} />;
  }

  if (!migrationsDone || (isPending && !session)) {
    return <FullScreenStatus message="Wird geladen …" />;
  }

  return (
    <View className="flex-1 bg-surface">
      <StatusBar style="light" />
      {session ? <UpdateBanner /> : null}
      <View className="flex-1">
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#131313' },
          }}
        >
          {/* Ohne Session nur (auth) erreichbar, mit Session nur (tabs) — siehe
              node_modules/expo-router/build/views/Protected.d.ts (guard: boolean). */}
          <Stack.Protected guard={!session}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={!!session}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="plans" />
            <Stack.Screen name="exercises" />
            <Stack.Screen name="workout/active" />
            <Stack.Screen name="workout/[id]" />
          </Stack.Protected>
        </Stack>
      </View>
    </View>
  );
}

/**
 * Boot-Guard: fängt Render-/Startfehler im gesamten Baum ab und zeigt statt
 * eines harten Absturzes den Recovery-Screen (siehe src/ui/ErrorBoundary).
 */
export default function RootLayout() {
  return (
    <ErrorBoundary>
      <RootLayoutInner />
    </ErrorBoundary>
  );
}
