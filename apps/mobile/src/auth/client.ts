import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';
import type { Tier } from '@ascent/shared';

import { API_URL } from '../config';

/**
 * Better-Auth-Client. baseURL enthält den Server-basePath '/auth'
 * (siehe apps/api/src/auth/auth.ts). Session-Cookies landen verschlüsselt
 * im SecureStore und werden offline aus dem Cache bedient.
 *
 * OFFLINE-VERIFIKATION (Auth-Gate, siehe app/_layout.tsx): Am Quellcode von
 * node_modules/@better-auth/expo/dist/client.js geprüft — `getActions` liest
 * beim Aufbau des Clients (also synchron beim Modul-Import, VOR jedem
 * Komponenten-Render, siehe node_modules/better-auth/dist/client/config.mjs:
 * `for (const plugin of plugins) if (plugin.getActions) ...` läuft direkt in
 * `getClientConfig`) den unter `${storagePrefix}_session_data` gecachten
 * Session-Snapshot aus dem SecureStore und schreibt ihn (falls
 * `expiresAt > Date.now()`) sofort in den Session-Atom. Schlägt der
 * anschliessende Hintergrund-Refetch (node_modules/better-auth/dist/client/
 * session-atom.mjs, `fetchSession`) offline fehl, greift dessen catch-Zweig:
 * `session.set({ data: latest.data, error: fetchError, isPending: false, ... })`
 * — die zuletzt bekannten Daten bleiben also erhalten, nur `error` wird
 * gesetzt. `useSession()` liefert offline also weiterhin `data` mit der
 * zwischengespeicherten Session. Ein eigener SecureStore-Fallback ist damit
 * NICHT nötig; app/_layout.tsx gate't rein auf `data`/`isPending` dieses
 * Hooks (siehe Kommentar dort).
 */
export const authClient = createAuthClient({
  baseURL: `${API_URL}/auth`,
  plugins: [
    expoClient({
      scheme: 'ascent',
      storagePrefix: 'ascent',
      storage: SecureStore,
    }),
  ],
});

/**
 * Better Auths additionalFields (`tier`, siehe apps/api/src/auth/auth.ts) sind
 * im Client-Typ nur sichtbar, wenn `createAuthClient<typeof auth>()` den
 * Server-Typ importiert — das wollen wir hier bewusst nicht (Mobile-Bundle
 * soll nicht vom API-Server-Modul abhängen). Am installierten Client-Typ
 * verifiziert (node_modules/better-auth/dist/client/path-to-object.d.ts):
 * `session.user.tier` existiert zur Laufzeit garantiert (Server-Default
 * 'free', additionalFields.input:false), ist aber nicht typisiert — dieser
 * einmalige, dokumentierte Cast ersetzt verstreute `as`-Casts in den Screens.
 */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  tier: Tier;
};

export function toSessionUser(user: {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    tier: (user as { tier?: Tier }).tier ?? 'free',
  };
}
