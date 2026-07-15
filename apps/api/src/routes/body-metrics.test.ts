import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { bodyMetrics, users } from '@ascent/shared';

import type { AuthEnv, AuthUser } from '../middleware/auth';
import { bodyMetricsRouter } from './body-metrics';

function buildApp(user: AuthUser) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/body-metrics', bodyMetricsRouter);
  return app;
}

let userCounter = 0;

async function createUser(): Promise<AuthUser> {
  userCounter += 1;
  const db = drizzle(env.DB);
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(users).values({
    id,
    email: `nutzer${userCounter}@example.test`,
    displayName: `Test Nutzer ${userCounter}`,
    tier: 'free',
    createdAt: now,
    updatedAt: now,
  });
  return { id, email: `nutzer${userCounter}@example.test`, tier: 'free' };
}

function jsonRequest(method: string, body: unknown) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

describe('bodyMetricsRouter', () => {
  describe('GET/POST /body-metrics', () => {
    it('legt Einträge an und listet sie neueste zuerst, gefiltert auf den eigenen Nutzer', async () => {
      const user = await createUser();
      const other = await createUser();
      const app = buildApp(user);

      await app.request('/body-metrics', jsonRequest('POST', { measuredAt: 1000, weightKg: 80 }), env);
      await app.request('/body-metrics', jsonRequest('POST', { measuredAt: 3000, weightKg: 79 }), env);
      await app.request('/body-metrics', jsonRequest('POST', { measuredAt: 2000, weightKg: 79.5 }), env);
      await buildApp(other).request('/body-metrics', jsonRequest('POST', { measuredAt: 2500, weightKg: 90 }), env);

      const res = await app.request('/body-metrics', {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ measuredAt: number; userId: string }>;
      expect(body.map((m) => m.measuredAt)).toEqual([3000, 2000, 1000]);
      expect(body.every((m) => m.userId === user.id)).toBe(true);
    });

    it('akzeptiert eine optionale client-generierte id', async () => {
      const user = await createUser();
      const id = crypto.randomUUID();
      const res = await buildApp(user).request(
        '/body-metrics',
        jsonRequest('POST', { id, measuredAt: 1000, weightKg: 80 }),
        env,
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBe(id);
    });

    it('filtert nach ?from/?to auf measuredAt', async () => {
      const user = await createUser();
      const app = buildApp(user);
      await app.request('/body-metrics', jsonRequest('POST', { measuredAt: 1000, weightKg: 80 }), env);
      await app.request('/body-metrics', jsonRequest('POST', { measuredAt: 2000, weightKg: 79 }), env);
      await app.request('/body-metrics', jsonRequest('POST', { measuredAt: 3000, weightKg: 78 }), env);

      const res = await app.request('/body-metrics?from=1500&to=2500', {}, env);
      const body = (await res.json()) as Array<{ measuredAt: number }>;
      expect(body.map((m) => m.measuredAt)).toEqual([2000]);
    });

    it('liefert 400 bei ungültigem Body (negatives Gewicht)', async () => {
      const user = await createUser();
      const res = await buildApp(user).request(
        '/body-metrics',
        jsonRequest('POST', { measuredAt: 1000, weightKg: -5 }),
        env,
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Ungültige Eingabe');
    });

    it('unterstützt Pagination via ?limit/?offset', async () => {
      const user = await createUser();
      const app = buildApp(user);
      for (let i = 0; i < 5; i += 1) {
        await app.request('/body-metrics', jsonRequest('POST', { measuredAt: 1000 + i, weightKg: 80 }), env);
      }

      const res = await app.request('/body-metrics?limit=2&offset=0', {}, env);
      const body = (await res.json()) as unknown[];
      expect(body).toHaveLength(2);
    });
  });

  describe('PUT/DELETE /body-metrics/:id', () => {
    it('aktualisiert partiell und ignoriert id/userId/createdAt', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const createRes = await app.request(
        '/body-metrics',
        jsonRequest('POST', { measuredAt: 1000, weightKg: 80, bodyFatPercent: 20 }),
        env,
      );
      const created = (await createRes.json()) as { id: string; createdAt: number };

      const putRes = await app.request(
        `/body-metrics/${created.id}`,
        jsonRequest('PUT', { weightKg: 79, id: 'x', createdAt: 1 }),
        env,
      );
      expect(putRes.status).toBe(200);
      const updated = (await putRes.json()) as { weightKg: number; bodyFatPercent: number; createdAt: number };
      expect(updated.weightKg).toBe(79);
      expect(updated.bodyFatPercent).toBe(20);
      expect(updated.createdAt).toBe(created.createdAt);
    });

    it('liefert 404 beim Ändern/Löschen eines fremden Eintrags', async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const createRes = await buildApp(owner).request(
        '/body-metrics',
        jsonRequest('POST', { measuredAt: 1000, weightKg: 80 }),
        env,
      );
      const created = (await createRes.json()) as { id: string };

      const putRes = await buildApp(intruder).request(
        `/body-metrics/${created.id}`,
        jsonRequest('PUT', { weightKg: 1 }),
        env,
      );
      expect(putRes.status).toBe(404);

      const delRes = await buildApp(intruder).request(`/body-metrics/${created.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(404);
    });

    it('Soft-Delete: verschwindet aus GET /, Zeile bleibt mit deleted=1', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const createRes = await app.request('/body-metrics', jsonRequest('POST', { measuredAt: 1000, weightKg: 80 }), env);
      const created = (await createRes.json()) as { id: string };

      const delRes = await app.request(`/body-metrics/${created.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(204);

      const listRes = await app.request('/body-metrics', {}, env);
      const list = (await listRes.json()) as Array<{ id: string }>;
      expect(list.find((m) => m.id === created.id)).toBeUndefined();

      const db = drizzle(env.DB);
      const rows = await db.select().from(bodyMetrics).where(eq(bodyMetrics.id, created.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.deleted).toBe(true);
    });
  });
});
