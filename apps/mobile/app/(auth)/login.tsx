import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';

import { authClient } from '../../src/auth/client';

/** Deutsche Fehlermeldung je HTTP-Status von POST /auth/sign-in/email. */
function loginErrorMessage(status: number | undefined, message: string | undefined): string {
  if (status === 401 || status === 403) return 'E-Mail oder Passwort ist falsch.';
  if (status === 429) return 'Zu viele Versuche. Bitte kurz warten und erneut versuchen.';
  if (!status) return 'Keine Verbindung zum Server möglich. Bitte Internetverbindung prüfen.';
  return message || 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.';
}

// Design: design/login_mobile/code.html — Wortmarke + zentrierte Karte.
export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setErrorMsg(null);
    if (!email.trim() || !password) {
      setErrorMsg('Bitte E-Mail und Passwort eingeben.');
      return;
    }

    setLoading(true);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    setLoading(false);

    if (error) {
      setErrorMsg(loginErrorMessage(error.status, error.message));
      return;
    }
    // Erfolg: das Auth-Gate in app/_layout.tsx erkennt die neue Session
    // reaktiv (Stack.Protected) und wechselt selbst zu (tabs) — kein
    // manueller Redirect hier nötig.
  }

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-primary text-4xl font-extrabold italic tracking-tighter text-center mb-8">
        ASCENT
      </Text>

      <View className="bg-surface-container rounded-xl p-6 gap-4 border border-surface-container-high">
        <View className="items-center mb-2">
          <Text className="text-on-surface text-2xl font-bold text-center">Willkommen zurück</Text>
          <Text className="text-on-surface-muted text-center mt-1">
            Logge dich ein, um dein Training fortzusetzen.
          </Text>
        </View>

        <View className="gap-1">
          <Text className="text-on-surface text-xs font-semibold uppercase tracking-wide">
            E-Mail Adresse
          </Text>
          <TextInput
            className="h-12 rounded-lg bg-surface px-4 text-on-surface"
            placeholder="name@domain.com"
            placeholderTextColor="#a0a0a0"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
        </View>

        <View className="gap-1">
          <Text className="text-on-surface text-xs font-semibold uppercase tracking-wide">Passwort</Text>
          <TextInput
            className="h-12 rounded-lg bg-surface px-4 text-on-surface"
            placeholder="••••••••"
            placeholderTextColor="#a0a0a0"
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
          />
        </View>

        {errorMsg && <Text className="text-error text-sm">{errorMsg}</Text>}

        <Pressable
          className="h-14 rounded-lg bg-primary items-center justify-center flex-row gap-2 mt-2"
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#213600" />
          ) : (
            <Text className="text-on-primary font-bold text-base">Anmelden</Text>
          )}
        </Pressable>

        <View className="items-center mt-2">
          <Text className="text-on-surface-muted">
            Noch kein Konto?{' '}
            <Link href="/register" className="text-primary font-bold">
              Konto erstellen
            </Link>
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
