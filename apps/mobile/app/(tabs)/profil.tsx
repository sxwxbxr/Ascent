import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import type { Tier } from '@ascent/shared';

import { Screen } from '../../src/ui/Screen';
import { API_URL } from '../../src/config';
import { authClient, toSessionUser } from '../../src/auth/client';
import { runSync, useSyncStatus } from '../../src/db/sync';
import {
  fetchProfile,
  updateDisplayName,
  updateProfileFields,
  type Gender,
  type Profile,
  type ProfileFieldsUpdate,
} from '../../src/data/profile';

type InviteStatus = 'offen' | 'verwendet' | 'abgelaufen';

/** Deckt genau die Antwortform von GET /invites ab (apps/api/src/routes/invites.ts). */
type Invite = {
  code: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  status: InviteStatus;
};

/** Ripple-Töne je Button-Stil (Android-only, iOS ignoriert android_ripple ohnehin). */
const RIPPLE_ON_PRIMARY = { color: 'rgba(33,54,0,0.2)' };
const RIPPLE_NEUTRAL = { color: 'rgba(255,255,255,0.08)' };
const RIPPLE_ERROR = { color: 'rgba(255,180,171,0.15)' };

function tierLabel(tier: Tier | undefined): string {
  if (tier === 'trial') return 'Trial';
  if (tier === 'pro') return 'Pro';
  return 'Free';
}

/** Nur der Status-Punkt ist farbig (Akzent-Diät) — der Statustext bleibt immer muted. */
function statusDotClassName(status: InviteStatus): string {
  if (status === 'offen') return 'bg-primary';
  if (status === 'verwendet') return 'bg-on-surface-muted';
  return 'bg-error';
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('de-CH');
}

/** "Zuletzt synchronisiert"-Text: relativ für kurze Zeiträume, sonst Datum/Uhrzeit (de-CH). */
function formatSyncTime(ms: number | null): string {
  if (ms === null) return 'noch nie';

  const diffMin = Math.floor((Date.now() - ms) / 60_000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin} Minute${diffMin === 1 ? '' : 'n'}`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `vor ${diffHours} Stunde${diffHours === 1 ? '' : 'n'}`;

  return new Date(ms).toLocaleString('de-CH');
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

type EditableField = 'displayName' | 'birthDate' | 'heightCm' | 'goal';

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'm', label: 'Männlich' },
  { value: 'w', label: 'Weiblich' },
  { value: 'd', label: 'Divers' },
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** JJJJ-MM-TT syntaktisch UND kalendarisch gültig (kein "2024-02-30"). */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Clientseitige Validierung des Bearbeiten-Formulars; deutsche Fehlermeldungen. */
function validateProfileForm(input: {
  displayName: string;
  birthDate: string;
  heightCm: string;
}): string | null {
  if (!input.displayName.trim()) return 'Bitte einen Namen eingeben.';

  const birthDate = input.birthDate.trim();
  if (birthDate !== '' && !isValidIsoDate(birthDate)) {
    return 'Bitte ein gültiges Geburtsdatum im Format JJJJ-MM-TT eingeben.';
  }

  const heightCm = input.heightCm.trim();
  if (heightCm !== '') {
    if (!/^\d+$/.test(heightCm)) return 'Grösse muss eine Zahl in cm sein.';
    const value = Number(heightCm);
    if (value < 100 || value > 250) return 'Grösse muss zwischen 100 und 250 cm liegen.';
  }

  return null;
}

// Design: design/profil/code.html — Kopf mit Avatar/Name/Tier, Invite-Karte,
// Sync-Karte, App-Sektion mit Version + Abmelden.
//
// AKZENT-DIÄT (Beta-Befund: "alles lime, nichts hat Priorität"): bg-primary
// ist ab jetzt reserviert für GENAU einen CTA auf diesem Screen —
// "Invite-Code erstellen". Alles andere (Avatar-Ring, Tier-Badge, Code-Karte,
// "Teilen", Sync-Button, Status-Texte) ist neutral; nur der Status-Punkt
// "offen" nutzt noch die Akzentfarbe als kleiner, bewusster Hinweis.
export default function ProfilScreen() {
  const { data: session } = authClient.useSession();
  const user = session?.user ? toSessionUser(session.user) : null;
  const syncStatus = useSyncStatus();

  const [invites, setInvites] = useState<Invite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newInvite, setNewInvite] = useState<{ code: string; expiresAt: number } | null>(null);

  const loadInvites = useCallback(async () => {
    setInvitesLoading(true);
    setInvitesError(null);
    const res = await authClient.$fetch<Invite[]>(`${API_URL}/invites`, { method: 'GET' });
    setInvitesLoading(false);
    if (res.error || !res.data) {
      setInvitesError('Codes konnten nicht geladen werden. Nur online möglich.');
      return;
    }
    setInvites(res.data);
  }, []);

  useEffect(() => {
    loadInvites().catch((err) => console.log('[ProfilScreen] loadInvites fehlgeschlagen:', err));
  }, [loadInvites]);

  async function handleCreateInvite() {
    setCreateError(null);
    setCreating(true);
    const res = await authClient.$fetch<{ code: string; expiresAt: number }>(`${API_URL}/invites`, {
      method: 'POST',
    });
    setCreating(false);

    if (res.error || !res.data) {
      setCreateError('Nur online möglich. Bitte Internetverbindung prüfen.');
      return;
    }
    setNewInvite(res.data);
    loadInvites().catch((err) => console.log('[ProfilScreen] loadInvites fehlgeschlagen:', err));
  }

  async function handleShare(code: string) {
    try {
      await Share.share({ message: `Dein Ascent-Einladungscode: ${code} — gültig 14 Tage` });
    } catch (err) {
      console.log('[ProfilScreen] Teilen abgebrochen/fehlgeschlagen:', err);
    }
  }

  async function handleLogout() {
    await authClient.signOut();
    // Auth-Gate in app/_layout.tsx wechselt reaktiv zu (auth)/login, sobald
    // die Session verschwindet — kein manueller Redirect nötig.
  }

  // --- Profil bearbeiten (Modal) --------------------------------------------
  const [editVisible, setEditVisible] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editLoadError, setEditLoadError] = useState<string | null>(null);
  // Frisch geladenes Profil beim Öffnen: Prefill-Quelle UND Baseline für den
  // "nur geänderte Felder senden"-Vergleich beim Speichern.
  const [baseline, setBaseline] = useState<Profile | null>(null);

  const [displayNameInput, setDisplayNameInput] = useState('');
  const [genderInput, setGenderInput] = useState<Gender | null>(null);
  const [birthDateInput, setBirthDateInput] = useState('');
  const [heightCmInput, setHeightCmInput] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [focusedField, setFocusedField] = useState<EditableField | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);

  function fieldBorderClassName(field: EditableField): string {
    return `h-12 rounded-lg border-2 bg-surface px-4 font-sans text-on-surface ${
      focusedField === field ? 'border-primary' : 'border-transparent'
    }`;
  }

  async function loadEditForm() {
    setEditLoading(true);
    setEditLoadError(null);
    try {
      const profile = await fetchProfile();
      setBaseline(profile);
      setDisplayNameInput(profile.displayName);
      setGenderInput(profile.gender);
      setBirthDateInput(profile.birthDate ?? '');
      setHeightCmInput(profile.heightCm !== null ? String(profile.heightCm) : '');
      setGoalInput(profile.goal ?? '');
    } catch (err) {
      setEditLoadError(err instanceof Error ? err.message : 'Profil konnte nicht geladen werden.');
    } finally {
      setEditLoading(false);
    }
  }

  function openEditModal() {
    setFormError(null);
    setEditVisible(true);
    loadEditForm().catch((err) => console.log('[ProfilScreen] loadEditForm fehlgeschlagen:', err));
  }

  function closeEditModal() {
    if (saving) return;
    setEditVisible(false);
  }

  function toggleGender(value: Gender) {
    setGenderInput((current) => (current === value ? null : value));
  }

  async function handleSaveProfile() {
    if (!baseline) return;

    const validationError = validateProfileForm({
      displayName: displayNameInput,
      birthDate: birthDateInput,
      heightCm: heightCmInput,
    });
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      const trimmedName = displayNameInput.trim();
      if (trimmedName !== baseline.displayName) {
        await updateDisplayName(trimmedName);
      }

      // Nur tatsächlich geänderte, nicht-leere optionale Felder senden — ein
      // geleertes Feld wird bewusst NICHT als "löschen" ans partielle
      // PUT-Schema geschickt (das unterstützt keine Null-Werte), sondern
      // einfach ausgelassen.
      const fields: ProfileFieldsUpdate = {};
      if (genderInput !== null && genderInput !== baseline.gender) {
        fields.gender = genderInput;
      }
      const birthDate = birthDateInput.trim();
      if (birthDate !== '' && birthDate !== (baseline.birthDate ?? '')) {
        fields.birthDate = birthDate;
      }
      const heightCmTrimmed = heightCmInput.trim();
      if (heightCmTrimmed !== '') {
        const heightCmValue = Number(heightCmTrimmed);
        if (heightCmValue !== baseline.heightCm) {
          fields.heightCm = heightCmValue;
        }
      }
      const goal = goalInput.trim();
      if (goal !== '' && goal !== (baseline.goal ?? '')) {
        fields.goal = goal;
      }

      if (Object.keys(fields).length > 0) {
        await updateProfileFields(fields);
      }

      setEditVisible(false);
      setSavedBanner(true);
      setTimeout(() => setSavedBanner(false), 3000);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen title="Profil">
      {/* Kopf */}
      <View className="mt-4 flex-row items-center gap-4">
        <View className="h-20 w-20 items-center justify-center rounded-full border-2 border-outline bg-surface-container-high">
          <Text className="font-sans text-2xl font-extrabold text-on-surface">
            {initialsOf(user?.name ?? '?')}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="font-sans text-2xl font-extrabold text-on-surface" numberOfLines={1}>
            {user?.name ?? 'Unbekannt'}
          </Text>
          <Text className="font-sans text-on-surface-muted" numberOfLines={1}>
            {user?.email ?? ''}
          </Text>
          <View className="mt-2 self-start rounded-full bg-surface-container-high px-3 py-1">
            <Text className="font-sans text-xs font-bold uppercase tracking-wide text-on-surface-muted">
              {tierLabel(user?.tier)}
            </Text>
          </View>
        </View>
      </View>

      <Pressable
        onPress={openEditModal}
        android_ripple={RIPPLE_NEUTRAL}
        className="h-12 flex-row items-center gap-2 self-start rounded-lg border border-outline px-4"
      >
        <Ionicons name="create-outline" size={16} color="#e5e2e1" />
        <Text className="font-sans font-bold text-on-surface">Profil bearbeiten</Text>
      </Pressable>

      {savedBanner && (
        <View className="flex-row items-center gap-2 self-start rounded-lg bg-surface-container-high px-3 py-2">
          <Ionicons name="checkmark-circle-outline" size={16} color="#e5e2e1" />
          <Text className="font-sans text-sm text-on-surface">Profil aktualisiert.</Text>
        </View>
      )}

      {/* Trainingspartner einladen */}
      <View className="gap-3 rounded-xl border border-surface-container-high bg-surface-container p-4">
        <Text className="font-sans text-lg font-bold text-on-surface">Trainingspartner einladen</Text>
        <Text className="font-sans text-sm text-on-surface-muted">
          Erstelle einen Code und teile ihn mit deinem Trainingspartner.
        </Text>

        <Pressable
          className="h-12 flex-row items-center justify-center gap-2 rounded-lg bg-primary"
          android_ripple={RIPPLE_ON_PRIMARY}
          onPress={handleCreateInvite}
          disabled={creating}
        >
          {creating ? (
            <ActivityIndicator color="#213600" />
          ) : (
            <Text className="font-sans font-bold text-on-primary">Invite-Code erstellen</Text>
          )}
        </Pressable>

        {createError && <Text className="font-sans text-sm text-error">{createError}</Text>}

        {newInvite && (
          <View className="items-center gap-2 rounded-lg bg-surface p-4">
            <Text className="tabular-nums font-sans text-2xl font-extrabold tracking-widest text-on-surface">
              {newInvite.code}
            </Text>
            <Text className="font-sans text-xs text-on-surface-muted">
              Gültig bis {formatDate(newInvite.expiresAt)}
            </Text>
            <Pressable
              className="mt-1 h-12 flex-row items-center justify-center gap-2 rounded-lg border border-outline px-4"
              android_ripple={RIPPLE_NEUTRAL}
              onPress={() => handleShare(newInvite.code)}
            >
              <Ionicons name="share-social-outline" size={16} color="#e5e2e1" />
              <Text className="font-sans text-sm font-bold text-on-surface">Teilen</Text>
            </Pressable>
          </View>
        )}

        <View className="mt-2 gap-2">
          <Text className="font-sans text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
            Bisherige Codes
          </Text>
          {invitesLoading && <ActivityIndicator color="#a0a0a0" />}
          {invitesError && <Text className="font-sans text-sm text-error">{invitesError}</Text>}
          {!invitesLoading && !invitesError && invites.length === 0 && (
            <Text className="font-sans text-sm text-on-surface-muted">Noch keine Codes erstellt.</Text>
          )}
          {invites.map((invite) => (
            <View
              key={invite.code}
              className="flex-row items-center justify-between border-b border-surface-container-high py-2"
            >
              <Text className="tabular-nums font-sans tracking-widest text-on-surface">{invite.code}</Text>
              <View className="flex-row items-center gap-2">
                <View className={`h-2 w-2 rounded-full ${statusDotClassName(invite.status)}`} />
                <Text className="font-sans text-sm text-on-surface-muted">{invite.status}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* Synchronisation */}
      <View className="gap-3 rounded-xl border border-surface-container-high bg-surface-container p-4">
        <Text className="font-sans text-lg font-bold text-on-surface">Synchronisation</Text>
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Ionicons name="sync-outline" size={16} color="#a0a0a0" />
            <Text className="font-sans text-on-surface-muted">Zuletzt synchronisiert</Text>
          </View>
          <Text className="font-sans text-on-surface">{formatSyncTime(syncStatus.lastSyncAt)}</Text>
        </View>

        {syncStatus.lastError && <Text className="font-sans text-sm text-error">{syncStatus.lastError}</Text>}

        <Pressable
          className="h-12 flex-row items-center justify-center gap-2 rounded-lg border border-outline"
          android_ripple={RIPPLE_NEUTRAL}
          onPress={() => runSync().catch((err) => console.log('[ProfilScreen] runSync fehlgeschlagen:', err))}
          disabled={syncStatus.isSyncing}
        >
          {syncStatus.isSyncing ? (
            <ActivityIndicator color="#e5e2e1" />
          ) : (
            <Text className="font-sans font-bold text-on-surface">Jetzt synchronisieren</Text>
          )}
        </Pressable>
      </View>

      {/* App */}
      <View className="gap-3 rounded-xl border border-surface-container-high bg-surface-container p-4">
        <Text className="font-sans text-lg font-bold text-on-surface">App</Text>
        <View className="flex-row justify-between">
          <Text className="font-sans text-on-surface-muted">Version</Text>
          <Text className="tabular-nums font-sans text-on-surface">{Constants.expoConfig?.version ?? '–'}</Text>
        </View>
        <Pressable
          className="mt-2 h-12 flex-row items-center justify-center gap-2 rounded-lg border border-error/40"
          android_ripple={RIPPLE_ERROR}
          onPress={() => handleLogout().catch((err) => console.log('[ProfilScreen] signOut fehlgeschlagen:', err))}
        >
          <Ionicons name="log-out-outline" size={16} color="#ffb4ab" />
          <Text className="font-sans font-bold text-error">Abmelden</Text>
        </Pressable>
      </View>

      {/* Profil bearbeiten (Modal) — Muster wie das Neuer-Plan-Modal in plans.tsx. */}
      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={closeEditModal}>
        <View className="flex-1 items-center justify-center bg-black/60 px-6">
          <View className="max-h-[85%] w-full rounded-xl bg-surface-container p-5">
            <Text className="mb-4 font-sans text-xl font-bold text-on-surface">Profil bearbeiten</Text>

            {editLoading && (
              <View className="items-center py-8">
                <ActivityIndicator color="#a0a0a0" />
              </View>
            )}

            {!editLoading && editLoadError && (
              <View className="gap-3">
                <View className="flex-row items-center gap-2 rounded-lg bg-error/10 p-3">
                  <Ionicons name="alert-circle-outline" size={18} color="#ffb4ab" />
                  <Text className="flex-1 font-sans text-sm text-error">{editLoadError}</Text>
                </View>
                <Pressable
                  onPress={() => loadEditForm().catch((err) => console.log('[ProfilScreen] loadEditForm fehlgeschlagen:', err))}
                  android_ripple={RIPPLE_NEUTRAL}
                  className="h-12 items-center justify-center rounded-lg border border-outline"
                >
                  <Text className="font-sans font-bold text-on-surface">Erneut versuchen</Text>
                </Pressable>
              </View>
            )}

            {!editLoading && !editLoadError && baseline && (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4">
                <View className="gap-1">
                  <Text className="font-sans text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
                    Anzeigename
                  </Text>
                  <TextInput
                    value={displayNameInput}
                    onChangeText={setDisplayNameInput}
                    placeholder="Dein Name"
                    placeholderTextColor="#a0a0a0"
                    autoCapitalize="words"
                    onFocus={() => setFocusedField('displayName')}
                    onBlur={() => setFocusedField(null)}
                    className={fieldBorderClassName('displayName')}
                  />
                </View>

                <View className="gap-1">
                  <Text className="font-sans text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
                    Geschlecht
                  </Text>
                  <View className="flex-row gap-2">
                    {GENDER_OPTIONS.map((option) => {
                      const active = genderInput === option.value;
                      return (
                        <Pressable
                          key={option.value}
                          onPress={() => toggleGender(option.value)}
                          android_ripple={active ? RIPPLE_ON_PRIMARY : RIPPLE_NEUTRAL}
                          className={`h-12 flex-1 items-center justify-center rounded-lg ${
                            active ? 'bg-primary' : 'bg-surface-container-high'
                          }`}
                        >
                          <Text className={`font-sans font-bold ${active ? 'text-on-primary' : 'text-on-surface'}`}>
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View className="gap-1">
                  <Text className="font-sans text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
                    Geburtsdatum
                  </Text>
                  <TextInput
                    value={birthDateInput}
                    onChangeText={setBirthDateInput}
                    placeholder="JJJJ-MM-TT"
                    placeholderTextColor="#a0a0a0"
                    // Kein number-pad: das Format braucht Bindestriche, die
                    // die reine Ziffterntastatur nicht anbietet (Android-only
                    // Scope — 'numbers-and-punctuation' ist iOS-exklusiv).
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={10}
                    onFocus={() => setFocusedField('birthDate')}
                    onBlur={() => setFocusedField(null)}
                    className={fieldBorderClassName('birthDate')}
                  />
                </View>

                <View className="gap-1">
                  <Text className="font-sans text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
                    Grösse (cm)
                  </Text>
                  <TextInput
                    value={heightCmInput}
                    onChangeText={setHeightCmInput}
                    placeholder="z. B. 178"
                    placeholderTextColor="#a0a0a0"
                    keyboardType="number-pad"
                    maxLength={3}
                    onFocus={() => setFocusedField('heightCm')}
                    onBlur={() => setFocusedField(null)}
                    className={fieldBorderClassName('heightCm')}
                  />
                </View>

                <View className="gap-1">
                  <Text className="font-sans text-xs font-semibold uppercase tracking-wide text-on-surface-muted">
                    Ziel
                  </Text>
                  <TextInput
                    value={goalInput}
                    onChangeText={setGoalInput}
                    placeholder="z. B. Muskelaufbau"
                    placeholderTextColor="#a0a0a0"
                    onFocus={() => setFocusedField('goal')}
                    onBlur={() => setFocusedField(null)}
                    className={fieldBorderClassName('goal')}
                  />
                </View>

                {formError && (
                  <View className="flex-row items-center gap-2 rounded-lg bg-error/10 p-3">
                    <Ionicons name="alert-circle-outline" size={18} color="#ffb4ab" />
                    <Text className="flex-1 font-sans text-sm text-error">{formError}</Text>
                  </View>
                )}
              </ScrollView>
            )}

            <View className="mt-4 flex-row justify-end gap-2">
              <Pressable
                onPress={closeEditModal}
                disabled={saving}
                className="h-12 items-center justify-center px-4 active:opacity-70"
              >
                <Text className="font-sans text-base text-on-surface-muted">Abbrechen</Text>
              </Pressable>
              <Pressable
                onPress={() => handleSaveProfile().catch((err) => console.log('[ProfilScreen] handleSaveProfile fehlgeschlagen:', err))}
                disabled={saving || editLoading || !!editLoadError || !baseline}
                android_ripple={RIPPLE_ON_PRIMARY}
                className={`h-12 items-center justify-center rounded-lg px-5 active:opacity-90 ${
                  saving || editLoading || editLoadError || !baseline ? 'bg-primary/40' : 'bg-primary'
                }`}
              >
                {saving ? (
                  <ActivityIndicator color="#213600" />
                ) : (
                  <Text className="font-sans text-base font-bold text-on-primary">Speichern</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
