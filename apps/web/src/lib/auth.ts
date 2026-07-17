import { createAuthClient } from "better-auth/react";

/**
 * Better-Auth-Web-Client. WICHTIG: eine rein relative `baseURL` ("/auth")
 * wird NICHT unterstützt – `getBaseURL`/`withPath` in better-auth (siehe
 * node_modules/better-auth/dist/utils/url.mjs) ruft `new URL(url)` auf und
 * verlangt ein Protokoll (http/https), sonst wirft es einen `BetterAuthError`
 * ("Invalid base URL"). Deshalb hier explizit `window.location.origin` +
 * `basePath: '/auth'` (muss den Server-`basePath` in apps/api/src/auth/auth.ts
 * spiegeln). Die Requests bleiben trotzdem same-origin: lokal über den
 * vite-Proxy (siehe vite.config.ts), in Prod weil derselbe Worker die SPA
 * ausliefert.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/auth",
});

export const { useSession, signIn, signUp, signOut } = authClient;
