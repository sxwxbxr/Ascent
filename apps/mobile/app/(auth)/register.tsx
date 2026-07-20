import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { authClient } from '../../src/auth/client';

type FocusableField = 'name' | 'email' | 'password' | 'invite';

const RIPPLE_ON_PRIMARY = { color: 'rgba(33,54,0,0.2)' };

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
// "ASCENT" bleibt die einzige lime Markenausnahme; der Anmelden-Link ist
// weiss+unterstrichen statt lime (Akzent-Diät).
export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [focusedField, setFocusedField] = useState<FocusableField | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function borderClassName(field: FocusableField): string {
    return `h-12 rounded-lg border-2 bg-surface px-4 text-on-surface ${
      focusedField === field ? 'border-primary' : 'border-transparent'
    }`;
  }

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
      <Text className="mb-8 text-center font-sans text-4xl font-extrabold italic tracking-tighter text-primary">
        ASCENT
      </Text>

      <View className="gap-4 rounded-xl border border-surface-container-high bg-surface-container p-6">
        <View className="mb-2 items-center">
          <Text className="text-center font-sans text-2xl font-bold text-on-surface">Konto erstellen</Text>
          <Text className="mt-1 text-center font-sans text-on-surface-muted">
            Leg dein Ascent-Konto an und starte dein Training.
          </Text>
        </View>

        <View className="gap-1">
          <Text className="font-sans text-xs font-semibold uppercase tracking-wide text-on-surface">Name</Text>
          <TextInput
            className={borderClassName('name')}
            placeholder="Dein Name"
            placeholderTextColor="#a0a0a0"
            autoCapitalize="words"
            autoComplete="name"
            value={name}
            onChangeText={setName}
            onFocus={() => setFocusedField('name')}
            onBlur={() => setFocusedField(null)}
          />
        </View>

        <View className="gap-1">
          <Text className="font-sans text-xs font-semibold uppercase tracking-wide text-on-surface">
            E-Mail Adresse
          </Text>
          <TextInput
            className={borderClassName('email')}
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
            className={borderClassName('password')}
            placeholder="Mind. 8 Zeichen"
            placeholderTextColor="#a0a0a0"
            secureTextEntry
            autoComplete="password-new"
            value={password}
            onChangeText={setPassword}
            onFocus={() => setFocusedField('password')}
            onBlur={() => setFocusedField(null)}
          />
        </View>

        <View className="gap-1">
          <Text className="font-sans text-xs font-semibold uppercase tracking-wide text-on-surface">
            Einladungscode
          </Text>
          <TextInput
            className={`tracking-widest ${borderClassName('invite')}`}
            placeholder="XXXXXXXXXXXX"
            placeholderTextColor="#a0a0a0"
            autoCapitalize="characters"
            autoCorrect={false}
            value={inviteCode}
            onChangeText={setInviteCode}
            onFocus={() => setFocusedField('invite')}
            onBlur={() => setFocusedField(null)}
          />
          <View className="mt-1 flex-row items-start gap-1.5">
            <Ionicons name="information-circle-outline" size={14} color="#a0a0a0" style={{ marginTop: 1 }} />
            <Text className="flex-1 font-sans text-xs text-on-surface-muted">
              Code von deinem Trainingspartner — nur das allererste Konto braucht keinen.
            </Text>
          </View>
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
          onPress={handleRegister}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#213600" />
          ) : (
            <Text className="font-sans text-base font-bold text-on-primary">Konto erstellen</Text>
          )}
        </Pressable>

        <View className="mt-2 items-center">
          <Text className="font-sans text-on-surface-muted">
            Schon ein Konto?{' '}
            <Link href="/login" className="font-sans font-bold text-on-surface underline">
              Anmelden
            </Link>
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
