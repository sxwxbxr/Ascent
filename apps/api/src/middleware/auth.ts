import type { MiddlewareHandler } from 'hono';
import type { Tier } from '@ascent/shared';
import { createAuth } from '../auth/auth';
import type { Bindings } from '../env';

/** In den Hono-Kontext gelegter, authentifizierter Nutzer. */
export type AuthUser = {
  id: string;
  email: string;
  tier: Tier;
};

export type AuthVariables = {
  user: AuthUser;
};

export type AuthEnv = { Bindings: Bindings; Variables: AuthVariables };

/** Liest die Better-Auth-Session aus dem Request und mappt sie auf {@link AuthUser}. */
async function resolveUser(c: { env: Bindings; req: { raw: Request } }): Promise<AuthUser | null> {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    // Better Auth typisiert additionalFields strukturell als `string`; die
    // Tier-Werte selbst sind serverseitig garantiert (siehe additionalFields
    // 'tier' mit input:false + defaultValue in src/auth/auth.ts).
    tier: session.user.tier as Tier,
  };
}

/**
 * Verlangt eine gültige Session und legt den Nutzer via c.set('user', ...) ab.
 * Wird zentral in index.ts vor die Datenrouten gemountet — Router importieren
 * diese Middleware NICHT selbst (Tests injizieren stattdessen einen Fake-User).
 */
export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const user = await resolveUser(c);
  if (!user) {
    return c.json({ error: 'Nicht angemeldet' }, 401);
  }
  c.set('user', user);
  await next();
};

/**
 * Wie requireAuth, aber ohne Zwang: Bei gültiger Session wird der Nutzer
 * gesetzt, sonst läuft die Anfrage anonym weiter (z. B. für /entitlements).
 */
export const optionalAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const user = await resolveUser(c);
  if (user) {
    c.set('user', user);
  }
  await next();
};
