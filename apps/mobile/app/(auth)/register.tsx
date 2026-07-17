import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';

import { authClient } from '../../src/auth/client';

/** Deutsche Fehlermeldung je HTTP-Status von POST /auth/sign-up/email. */
function registerErrorMessage(status: number | undefined, message: string | undefined): string {
  // 403: ungültiger/verwendeter/abgelaufener Invite-Code (apps/api/src/auth/auth.ts, before-Hook).
  if (status === 403) return 'Der Einladungscode ist ungültig, bereits verwendet oder abgelaufen.';
  // 422: E-Mail bereits vergeben (better-auth USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL).
  if (status === 422) return 'Für diese E-Mail-Adresse besteht bereits ein Konto.';
  if (status === 429) return 'Zu viele Versuche. Bitte kurz warten und erneut versuchen.';
  if (!status) return 'Keine Verbindung zum Server möglich. Bitte Internetverbindung prüfen.';
  return message || 'Registrierung fehlgeschlagen. Bitte erneut versuchen.';
}

function validate(name: string, email: string, password: string): string | null {
  if (!name.trim()) return 'Bitte deinen Namen eingeben.';
  if (!email.trim() || !email.includes('@')) return 'Bitte eine gültige E-Mail-Adresse eingeben.';
  if (password.length < 8) return 'Das Passwort muss mindestens 8 Zeichen lang sein.';
  return null;
}

// Kein eigenes Stitch-Design vorhanden — bewusst im selben Karten-Stil wie
// design/login_mobile gehalten (konsistente "Dark Performance"-Optik).
export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    setErrorMsg(null);
    const validationError = validate(name, email, password);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    setLoading(true);
    // Zusatzfeld-Verifikation (installierter Client-Typ,
    // node_modules/better-auth/dist/client/path-to-object.d.ts:
    // InferSignUpEmailCtx kennt nur email/name/password/image/callbackURL —
    // `inviteCode` direkt im ersten Argument wäre ein TS-Fehler). Das zweite
    // Argument wird laut node_modules/better-auth/dist/client/proxy.mjs
    // (`body: {...body, ...options?.body}`) mit dem ersten gemergt und ist
    // dort als `Record<string, any>` typisiert — `inviteCode` kommt darüber
    // typsicher im Request-Body an, OHNE auf den $fetch-Fallback ausweichen
    // zu müssen. Bonus: der Aufruf läuft weiterhin über den typisierten
    // Proxy, wodurch dessen Session-Signal-Trigger (config.mjs atomListeners,
    // matcht auf '/sign-up/email') erhalten bleibt — die neue Session wird
    // also sofort nachgeladen.
    const { error } = await authClient.signUp.email(
      { email: email.trim(), name: name.trim(), password },
      { body: { inviteCode: inviteCode.trim() } },
    );
    setLoading(false);

    if (error) {
      setErrorMsg(registerErrorMessage(error.status, error.message));
      return;
    }
    // Erfolg: direkt eingeloggt (Better Auth setzt die Session-Cookie bereits
    // bei sign-up/email) — das Auth-Gate in app/_layout.tsx wechselt reaktiv
    // zu (tabs), kein manueller Redirect nötig.
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
          <Text className="text-on-surface text-2xl font-bold text-center">Konto erstellen</Text>
          <Text className="text-on-surface-muted text-center mt-1">
            Leg dein Ascent-Konto an und starte dein Training.
          </Text>
        </View>

        <View className="gap-1">
          <Text className="text-on-surface text-xs font-semibold uppercase tracking-wide">Name</Text>
          <TextInput
            className="h-12 rounded-lg bg-surface px-4 text-on-surface"
            placeholder="Dein Name"
            placeholderTextColor="#a0a0a0"
            autoCapitalize="words"
            autoComplete="name"
            value={name}
            onChangeText={setName}
          />
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
            placeholder="Mind. 8 Zeichen"
            placeholderTextColor="#a0a0a0"
            secureTextEntry
            autoComplete="password-new"
            value={password}
            onChangeText={setPassword}
          />
        </View>

        <View className="gap-1">
          <Text className="text-on-surface text-xs font-semibold uppercase tracking-wide">
            Einladungscode
          </Text>
          <TextInput
            className="h-12 rounded-lg bg-surface px-4 text-on-surface tracking-widest"
            placeholder="XXXXXXXXXXXX"
            placeholderTextColor="#a0a0a0"
            autoCapitalize="characters"
            autoCorrect={false}
            value={inviteCode}
            onChangeText={setInviteCode}
          />
          <Text className="text-on-surface-muted text-xs mt-1">
            Code von deinem Trainingspartner — nur das allererste Konto braucht keinen.
          </Text>
        </View>

        {errorMsg && <Text className="text-error text-sm">{errorMsg}</Text>}

        <Pressable
          className="h-14 rounded-lg bg-primary items-center justify-center flex-row gap-2 mt-2"
          onPress={handleRegister}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#213600" />
          ) : (
            <Text className="text-on-primary font-bold text-base">Konto erstellen</Text>
          )}
        </Pressable>

        <View className="items-center mt-2">
          <Text className="text-on-surface-muted">
            Schon ein Konto?{' '}
            <Link href="/login" className="text-primary font-bold">
              Anmelden
            </Link>
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
