import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Share, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import type { Tier } from '@ascent/shared';

import { Screen } from '../../src/ui/Screen';
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
    </Screen>
  );
}
