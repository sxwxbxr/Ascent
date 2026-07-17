import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from 'react-native';
import Constants from 'expo-constants';
import type { Tier } from '@ascent/shared';

import { API_URL } from '../../src/config';
import { authClient, toSessionUser } from '../../src/auth/client';
import { runSync, useSyncStatus } from '../../src/db/sync';

type InviteStatus = 'offen' | 'verwendet' | 'abgelaufen';

/** Deckt genau die Antwortform von GET /invites ab (apps/api/src/routes/invites.ts). */
type Invite = {
  code: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  status: InviteStatus;
};

function tierLabel(tier: Tier | undefined): string {
  if (tier === 'trial') return 'Trial';
  if (tier === 'pro') return 'Pro';
  return 'Free';
}

function statusClassName(status: InviteStatus): string {
  if (status === 'offen') return 'text-primary text-sm font-semibold';
  if (status === 'verwendet') return 'text-on-surface-muted text-sm';
  return 'text-error text-sm';
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

// Design: design/profil/code.html — Kopf mit Avatar/Name/Tier, Invite-Karte,
// App-Sektion mit Version + Abmelden. Icons entfallen (siehe (tabs)/_layout.tsx).
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

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 24 }}
    >
      {/* Kopf */}
      <View className="flex-row items-center gap-4 mt-4">
        <View className="w-20 h-20 rounded-full bg-surface-container-high items-center justify-center border-2 border-primary">
          <Text className="text-primary text-2xl font-extrabold">{initialsOf(user?.name ?? '?')}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-on-surface text-2xl font-extrabold" numberOfLines={1}>
            {user?.name ?? 'Unbekannt'}
          </Text>
          <Text className="text-on-surface-muted" numberOfLines={1}>
            {user?.email ?? ''}
          </Text>
          <View className="mt-2 self-start px-3 py-1 rounded-full bg-surface-container-high border border-primary">
            <Text className="text-primary text-xs font-bold uppercase tracking-wide">
              {tierLabel(user?.tier)}
            </Text>
          </View>
        </View>
      </View>

      {/* Trainingspartner einladen */}
      <View className="bg-surface-container rounded-xl p-4 border border-surface-container-high gap-3">
        <Text className="text-on-surface text-lg font-bold">Trainingspartner einladen</Text>

        <Pressable
          className="h-12 rounded-lg bg-primary items-center justify-center flex-row gap-2"
          onPress={handleCreateInvite}
          disabled={creating}
        >
          {creating ? (
            <ActivityIndicator color="#213600" />
          ) : (
            <Text className="text-on-primary font-bold">Invite-Code erstellen</Text>
          )}
        </Pressable>

        {createError && <Text className="text-error text-sm">{createError}</Text>}

        {newInvite && (
          <View className="bg-surface rounded-lg p-4 items-center gap-2 border border-primary">
            <Text className="text-primary text-2xl font-extrabold tracking-widest">{newInvite.code}</Text>
            <Text className="text-on-surface-muted text-xs">Gültig bis {formatDate(newInvite.expiresAt)}</Text>
            <Pressable
              className="h-10 px-4 rounded-lg border border-primary items-center justify-center flex-row gap-2 mt-1"
              onPress={() => handleShare(newInvite.code)}
            >
              <Text className="text-primary font-bold text-sm">Teilen</Text>
            </Pressable>
          </View>
        )}

        <View className="gap-2 mt-2">
          <Text className="text-on-surface-muted text-xs font-semibold uppercase tracking-wide">
            Bisherige Codes
          </Text>
          {invitesLoading && <ActivityIndicator color="#b4ff39" />}
          {invitesError && <Text className="text-error text-sm">{invitesError}</Text>}
          {!invitesLoading && !invitesError && invites.length === 0 && (
            <Text className="text-on-surface-muted text-sm">Noch keine Codes erstellt.</Text>
          )}
          {invites.map((invite) => (
            <View
              key={invite.code}
              className="flex-row items-center justify-between py-2 border-b border-surface-container-high"
            >
              <Text className="text-on-surface tracking-widest">{invite.code}</Text>
              <Text className={statusClassName(invite.status)}>{invite.status}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Synchronisation */}
      <View className="bg-surface-container rounded-xl p-4 border border-surface-container-high gap-3">
        <Text className="text-on-surface text-lg font-bold">Synchronisation</Text>
        <View className="flex-row justify-between">
          <Text className="text-on-surface-muted">Zuletzt synchronisiert</Text>
          <Text className="text-on-surface">{formatSyncTime(syncStatus.lastSyncAt)}</Text>
        </View>

        {syncStatus.lastError && <Text className="text-error text-sm">{syncStatus.lastError}</Text>}

        <Pressable
          className="h-12 rounded-lg border border-primary items-center justify-center flex-row gap-2"
          onPress={() => runSync().catch((err) => console.log('[ProfilScreen] runSync fehlgeschlagen:', err))}
          disabled={syncStatus.isSyncing}
        >
          {syncStatus.isSyncing ? (
            <ActivityIndicator color="#b4ff39" />
          ) : (
            <Text className="text-primary font-bold">Jetzt synchronisieren</Text>
          )}
        </Pressable>
      </View>

      {/* App */}
      <View className="bg-surface-container rounded-xl p-4 border border-surface-container-high gap-3">
        <Text className="text-on-surface text-lg font-bold">App</Text>
        <View className="flex-row justify-between">
          <Text className="text-on-surface-muted">Version</Text>
          <Text className="text-on-surface">{Constants.expoConfig?.version ?? '–'}</Text>
        </View>
        <Pressable
          className="h-12 rounded-lg border border-error items-center justify-center flex-row gap-2 mt-2"
          onPress={() => handleLogout().catch((err) => console.log('[ProfilScreen] signOut fehlgeschlagen:', err))}
        >
          <Text className="text-error font-bold">Abmelden</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
