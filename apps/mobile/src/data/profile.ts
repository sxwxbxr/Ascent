import type { ProfileUpdateInput, Tier } from '@ascent/shared';

import { API_URL } from '../config';
import { authClient } from '../auth/client';

/** Geschlecht laut packages/shared/src/validation.ts (profileSchema). */
export type Gender = 'm' | 'w' | 'd';

/** Deckt exakt die Antwortform von GET/PUT /profile ab (apps/api/src/routes/profile.ts, serializeProfile). */
export type Profile = {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  gender: Gender | null;
  birthDate: string | null;
  heightCm: number | null;
  goal: string | null;
  tier: Tier;
  createdAt: number;
  updatedAt: number;
};

/**
 * App-eigene Profilfelder für PUT /profile. `displayName` läuft bewusst NICHT
 * darüber — siehe {@link updateDisplayName}.
 */
export type ProfileFieldsUpdate = Omit<ProfileUpdateInput, 'displayName'>;

/** Deutsche Fehlermeldung je HTTP-Status (oder fehlendem Status = kein Netz). */
function profileErrorMessage(status: number | undefined, action: 'geladen' | 'gespeichert'): string {
  if (!status) return 'Keine Verbindung zum Server möglich. Bitte Internetverbindung prüfen.';
  if (status === 401) return 'Sitzung abgelaufen. Bitte erneut anmelden.';
  return `Profil konnte nicht ${action} werden.`;
}

/** GET /profile — eigenes Profil, nur online verfügbar. */
export async function fetchProfile(): Promise<Profile> {
  const res = await authClient.$fetch<Profile>(`${API_URL}/profile`, { method: 'GET' });
  if (res.error || !res.data) throw new Error(profileErrorMessage(res.error?.status, 'geladen'));
  return res.data;
}

/** PUT /profile — partielles Update der App-eigenen Felder (gender/birthDate/heightCm/goal). */
export async function updateProfileFields(fields: ProfileFieldsUpdate): Promise<Profile> {
  const res = await authClient.$fetch<Profile>(`${API_URL}/profile`, { method: 'PUT', body: fields });
  if (res.error || !res.data) throw new Error(profileErrorMessage(res.error?.status, 'gespeichert'));
  return res.data;
}

/**
 * Aktualisiert den Anzeigenamen über Better Auths POST /update-user.
 *
 * VERIFIKATION (installierter Client-Typ,
 * node_modules/better-auth/dist/client/path-to-object.d.mts, `InferUserUpdateCtx`):
 * `authClient.updateUser({ name, image?, fetchOptions? })` existiert und ist
 * typisiert. Better Auths `name`-Feld ist server-seitig direkt auf unsere
 * `displayName`-Spalte gemappt (apps/api/src/auth/auth.ts: `fields: { name:
 * 'displayName' }`) — es ist also dieselbe Spalte, die GET/PUT /profile als
 * `displayName` liefert/annimmt, kein Duplikat-Feld.
 *
 * Ein manueller Session-Refetch ist NICHT nötig: node_modules/better-auth/
 * dist/client/config.mjs registriert einen atomListener, dessen `matcher` auf
 * den Pfad `/update-user` anspringt und `broadcastSessionUpdate('updateUser')`
 * auslöst, was das `$sessionSignal` setzt, auf das der Session-Atom hört und
 * daraufhin neu lädt (derselbe Mechanismus, den schon `register.tsx` für
 * `signUp.email` dokumentiert). `authClient.useSession()` liefert den neuen
 * Namen damit von selbst, sobald der Aufruf durchgelaufen ist.
 */
export async function updateDisplayName(name: string): Promise<void> {
  const { error } = await authClient.updateUser({ name });
  if (error) throw new Error(profileErrorMessage(error.status, 'gespeichert'));
}
