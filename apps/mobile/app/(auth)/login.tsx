import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { authClient } from '../../src/auth/client';

type FocusableField = 'email' | 'password';

const RIPPLE_ON_PRIMARY = { color: 'rgba(33,54,0,0.2)' };

/** Deutsche Fehlermeldung je HTTP-Status von POST /auth/sign-in/email. */
function loginErrorMessage(status: number | undefined, message: string | undefined): string {
  if (status === 401 || status === 403) return 'E-Mail oder Passwort ist falsch.';
  if (status === 429) return 'Zu viele Versuche. Bitte kurz warten und erneut versuchen.';
  if (!status) return 'Keine Verbindung zum Server möglich. Bitte Internetverbindung prüfen.';
  return message || 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.';
}

// Design: design/login_mobile/code.html — Wortmarke + zentrierte Karte.
// "ASCENT" ist die einzige bewusste Ausnahme von der Akzent-Diät
// (Markenausnahme) — alle anderen Akzente sind auf den einen Primary-CTA
// ("Anmelden") konzentriert; der Registrieren-Link ist jetzt weiss+unterstrichen
// statt lime.
export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [focusedField, setFocusedField] = useState<FocusableField | null>(null);
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
      <Text className="mb-8 text-center font-sans text-4xl font-extrabold italic tracking-tighter text-primary">
        ASCENT
      </Text>

      <View className="gap-4 rounded-xl border border-surface-container-high bg-surface-container p-6">
        <View className="mb-2 items-center">
          <Text className="text-center font-sans text-2xl font-bold text-on-surface">Willkommen zurück</Text>
          <Text className="mt-1 text-center font-sans text-on-surface-muted">
            Logge dich ein, um dein Training fortzusetzen.
          </Text>
        </View>

        <View className="gap-1">
          <Text className="font-sans text-xs font-semibold uppercase tracking-wide text-on-surface">
            E-Mail Adresse
          </Text>
          <TextInput
            className={`h-12 rounded-lg border-2 bg-surface px-4 text-on-surface ${
              focusedField === 'email' ? 'border-primary' : 'border-transparent'
            }`}
            placeholder="name@domain.com"
            placeholderTextColor="#a0a0a0"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            onFocus={() => setFocusedField('email')}
            onBlur={() => setFocusedField(null)}
          />
        </View>

        <View className="gap-1">
          <Text className="font-sans text-xs font-semibold uppercase tracking-wide text-on-surface">Passwort</Text>
          <TextInput
            className={`h-12 rounded-lg border-2 bg-surface px-4 text-on-surface ${
              focusedField === 'password' ? 'border-primary' : 'border-transparent'
            }`}
            placeholder="••••••••"
            placeholderTextColor="#a0a0a0"
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
            onFocus={() => setFocusedField('password')}
            onBlur={() => setFocusedField(null)}
          />
        </View>

        {errorMsg && (
          <View className="flex-row items-center gap-2 rounded-lg bg-error/10 p-3">
            <Ionicons name="alert-circle-outline" size={18} color="#ffb4ab" />
            <Text className="flex-1 font-sans text-sm text-error">{errorMsg}</Text>
          </View>
        )}

        <Pressable
          className="mt-2 h-14 flex-row items-center justify-center gap-2 rounded-lg bg-primary"
          android_ripple={RIPPLE_ON_PRIMARY}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#213600" />
          ) : (
            <Text className="font-sans text-base font-bold text-on-primary">Anmelden</Text>
          )}
        </Pressable>

        <View className="mt-2 items-center">
          <Text className="font-sans text-on-surface-muted">
            Noch kein Konto?{' '}
            <Link href="/register" className="font-sans font-bold text-on-surface underline">
              Konto erstellen
            </Link>
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
