import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';

import { API_URL } from '../config';

/**
 * Better-Auth-Client. baseURL enthält den Server-basePath '/auth'
 * (siehe apps/api/src/auth/auth.ts). Session-Cookies landen verschlüsselt
 * im SecureStore und werden offline aus dem Cache bedient.
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
