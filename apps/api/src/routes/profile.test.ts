import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { users } from '@ascent/shared';

import type { AuthEnv, AuthUser } from '../middleware/auth';
import { profileRouter } from './profile';

function buildApp(user: AuthUser) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/profile', profileRouter);
  return app;
}

let userCounter = 0;

async function createUser(overrides: Partial<{ tier: 'free' | 'trial' | 'pro' }> = {}): Promise<AuthUser> {
  userCounter += 1;
  const db = drizzle(env.DB);
  const id = crypto.randomUUID();
  const now = new Date();
  const email = `nutzer${userCounter}@example.test`;
  const tier = overrides.tier ?? 'free';
  await db.insert(users).values({
    id,
    email,
    displayName: `Test Nutzer ${userCounter}`,
    tier,
    createdAt: now,
    updatedAt: now,
  });
  return { id, email, tier };
}

function jsonRequest(method: string, body: unknown) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

describe('profileRouter', () => {
  describe('GET /profile', () => {
    it('liefert das eigene Profil mit Epoch-ms-Zeitstempeln', async () => {
      const user = await createUser({ tier: 'pro' });
      const res = await buildApp(user).request('/profile', {}, env);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        id: string;
        email: string;
        displayName: string;
        emailVerified: boolean;
        tier: string;
        createdAt: number;
        updatedAt: number;
      };
      expect(body.id).toBe(user.id);
      expect(body.email).toBe(user.email);
      expect(body.tier).toBe('pro');
      expect(body.emailVerified).toBe(false);
      expect(typeof body.createdAt).toBe('number');
      expect(typeof body.updatedAt).toBe('number');
    });
  });

  describe('PUT /profile', () => {
    it('aktualisiert displayName/gender/birthDate/heightCm/goal partiell', async () => {
      const user = await createUser();
      const app = buildApp(user);

      const res = await app.request(
        '/profile',
        jsonRequest('PUT', { displayName: 'Neuer Name', heightCm: 180, goal: 'Kraftaufbau' }),
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { displayName: string; heightCm: number; goal: string };
      expect(body.displayName).toBe('Neuer Name');
      expect(body.heightCm).toBe(180);
      expect(body.goal).toBe('Kraftaufbau');
    });

    it('ändert email und tier NICHT, auch wenn im Body enthalten', async () => {
      const user = await createUser({ tier: 'free' });
      const app = buildApp(user);

      const res = await app.request(
        '/profile',
        jsonRequest('PUT', { displayName: 'X', email: 'neu@example.test', tier: 'pro' }),
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { email: string; tier: string };
      expect(body.email).toBe(user.email);
      expect(body.tier).toBe('free');

      const db = drizzle(env.DB);
      const rows = await db.select().from(users).where(eq(users.id, user.id));
      expect(rows[0]?.email).toBe(user.email);
      expect(rows[0]?.tier).toBe('free');
    });

    it('liefert 400 bei ungültigem Body (heightCm ausserhalb der Grenzen)', async () => {
      const user = await createUser();
      const res = await buildApp(user).request('/profile', jsonRequest('PUT', { heightCm: 10 }), env);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Ungültige Eingabe');
    });

    it('bumpt updatedAt bei jedem Update', async () => {
      const user = await createUser();
      const app = buildApp(user);

      const before = await app.request('/profile', {}, env);
      const beforeBody = (await before.json()) as { updatedAt: number };

      await new Promise((resolve) => setTimeout(resolve, 5));

      const putRes = await app.request('/profile', jsonRequest('PUT', { goal: 'Abnehmen' }), env);
      const afterBody = (await putRes.json()) as { updatedAt: number };
      expect(afterBody.updatedAt).toBeGreaterThanOrEqual(beforeBody.updatedAt);
    });
  });
});
