import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { foodEntries, users } from '@ascent/shared';

import type { AuthEnv, AuthUser } from '../middleware/auth';
import { foodEntriesRouter } from './food-entries';
import { syncRouter } from './sync';

function buildApp(user: AuthUser) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/food-entries', foodEntriesRouter);
  app.route('/sync', syncRouter);
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

describe('foodEntriesRouter', () => {
  describe('GET/POST /food-entries', () => {
    it('legt Mahlzeit- und Wasser-Einträge an und listet nur die eigenen, neueste zuerst', async () => {
      const user = await createUser();
      const other = await createUser();
      const app = buildApp(user);

      await app.request(
        '/food-entries',
        jsonRequest('POST', {
          entryType: 'food',
          loggedDate: '2026-07-20',
          mealSlot: 'breakfast',
          amountG: 100,
          kcal: 250,
          loggedAt: 1000,
        }),
        env,
      );
      await app.request(
        '/food-entries',
        jsonRequest('POST', { entryType: 'water', loggedDate: '2026-07-21', amountMl: 250, loggedAt: 2000 }),
        env,
      );
      await buildApp(other).request(
        '/food-entries',
        jsonRequest('POST', { entryType: 'water', loggedDate: '2026-07-21', amountMl: 500, loggedAt: 1500 }),
        env,
      );

      const res = await app.request('/food-entries', {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ loggedDate: string; userId: string; entryType: string }>;
      expect(body).toHaveLength(2);
      expect(body.every((e) => e.userId === user.id)).toBe(true);
      expect(body.map((e) => e.loggedDate)).toEqual(['2026-07-21', '2026-07-20']);
    });

    it('entryType defaultet auf food, wenn nicht mitgeliefert', async () => {
      const user = await createUser();
      const res = await buildApp(user).request(
        '/food-entries',
        jsonRequest('POST', { loggedDate: '2026-07-20', loggedAt: 1000 }),
        env,
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { entryType: string };
      expect(body.entryType).toBe('food');
    });

    it('akzeptiert eine optionale client-generierte id', async () => {
      const user = await createUser();
      const id = crypto.randomUUID();
      const res = await buildApp(user).request(
        '/food-entries',
        jsonRequest('POST', { id, entryType: 'water', loggedDate: '2026-07-20', amountMl: 250, loggedAt: 1000 }),
        env,
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBe(id);
    });

    it('liefert 400 bei ungültigem Body (Wasser-Eintrag mit mealSlot)', async () => {
      const user = await createUser();
      const res = await buildApp(user).request(
        '/food-entries',
        jsonRequest('POST', {
          entryType: 'water',
          loggedDate: '2026-07-20',
          mealSlot: 'breakfast',
          amountMl: 250,
          loggedAt: 1000,
        }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it('liefert 400 bei ungültigem loggedDate (kein ISO-Datum)', async () => {
      const user = await createUser();
      const res = await buildApp(user).request(
        '/food-entries',
        jsonRequest('POST', { loggedDate: '20.07.2026', loggedAt: 1000 }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it('filtert nach ?from/?to auf loggedDate', async () => {
      const user = await createUser();
      const app = buildApp(user);
      await app.request('/food-entries', jsonRequest('POST', { loggedDate: '2026-07-01', loggedAt: 1000 }), env);
      await app.request('/food-entries', jsonRequest('POST', { loggedDate: '2026-07-15', loggedAt: 2000 }), env);
      await app.request('/food-entries', jsonRequest('POST', { loggedDate: '2026-07-30', loggedAt: 3000 }), env);

      const res = await app.request('/food-entries?from=2026-07-10&to=2026-07-20', {}, env);
      const body = (await res.json()) as Array<{ loggedDate: string }>;
      expect(body.map((e) => e.loggedDate)).toEqual(['2026-07-15']);
    });

    it('unterstützt Pagination via ?limit/?offset', async () => {
      const user = await createUser();
      const app = buildApp(user);
      for (let i = 0; i < 5; i += 1) {
        await app.request(
          '/food-entries',
          jsonRequest('POST', { loggedDate: `2026-07-0${i + 1}`, loggedAt: 1000 + i }),
          env,
        );
      }

      const res = await app.request('/food-entries?limit=2&offset=0', {}, env);
      const body = (await res.json()) as unknown[];
      expect(body).toHaveLength(2);
    });
  });

  describe('PUT/DELETE /food-entries/:id', () => {
    it('aktualisiert partiell und ignoriert id/userId/createdAt', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const createRes = await app.request(
        '/food-entries',
        jsonRequest('POST', { loggedDate: '2026-07-20', mealSlot: 'lunch', kcal: 500, loggedAt: 1000 }),
        env,
      );
      const created = (await createRes.json()) as { id: string; createdAt: number };

      const putRes = await app.request(
        `/food-entries/${created.id}`,
        jsonRequest('PUT', { kcal: 600, id: 'x', createdAt: 1 }),
        env,
      );
      expect(putRes.status).toBe(200);
      const updated = (await putRes.json()) as { kcal: number; mealSlot: string; createdAt: number };
      expect(updated.kcal).toBe(600);
      expect(updated.mealSlot).toBe('lunch');
      expect(updated.createdAt).toBe(created.createdAt);
    });

    it('liefert 404 beim Ändern/Löschen eines fremden Eintrags', async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const createRes = await buildApp(owner).request(
        '/food-entries',
        jsonRequest('POST', { loggedDate: '2026-07-20', loggedAt: 1000 }),
        env,
      );
      const created = (await createRes.json()) as { id: string };

      const putRes = await buildApp(intruder).request(
        `/food-entries/${created.id}`,
        jsonRequest('PUT', { kcal: 1 }),
        env,
      );
      expect(putRes.status).toBe(404);

      const delRes = await buildApp(intruder).request(`/food-entries/${created.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(404);
    });

    it('Soft-Delete: verschwindet aus GET /, Zeile bleibt mit deleted=1', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const createRes = await app.request(
        '/food-entries',
        jsonRequest('POST', { loggedDate: '2026-07-20', loggedAt: 1000 }),
        env,
      );
      const created = (await createRes.json()) as { id: string };

      const delRes = await app.request(`/food-entries/${created.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(204);

      const listRes = await app.request('/food-entries', {}, env);
      const list = (await listRes.json()) as Array<{ id: string }>;
      expect(list.find((e) => e.id === created.id)).toBeUndefined();

      const db = drizzle(env.DB);
      const rows = await db.select().from(foodEntries).where(eq(foodEntries.id, created.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.deleted).toBe(true);
    });
  });

  describe('Sync-Roundtrip (food_entries)', () => {
    it('pusht einen eigenen Eintrag (applied) und liefert ihn beim Pull zurück', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const id = crypto.randomUUID();
      const now = Date.now();

      const pushRes = await app.request(
        '/sync/push',
        jsonRequest('POST', {
          tables: {
            food_entries: [
              {
                id,
                entryType: 'water',
                loggedDate: '2026-07-20',
                amountMl: 250,
                loggedAt: now,
                createdAt: now,
                updatedAt: now,
                deleted: false,
              },
            ],
          },
        }),
        env,
      );
      const pushBody = (await pushRes.json()) as {
        tables: { food_entries: { applied: number; skipped: number; rejected: number } };
      };
      expect(pushBody.tables.food_entries).toEqual({ applied: 1, skipped: 0, rejected: 0 });

      const pullRes = await app.request('/sync/pull', jsonRequest('POST', { since: {} }), env);
      const pullBody = (await pullRes.json()) as { tables: { food_entries: Array<{ id: string; userId: string }> } };
      const found = pullBody.tables.food_entries.find((e) => e.id === id);
      expect(found).toBeDefined();
      expect(found?.userId).toBe(user.id);
    });

    it('lehnt Push auf eine fremde Zeile ab', async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const db = drizzle(env.DB);
      const id = crypto.randomUUID();
      const now = Date.now();
      await db.insert(foodEntries).values({
        id,
        userId: owner.id,
        entryType: 'water',
        loggedDate: '2026-07-20',
        amountMl: 250,
        loggedAt: now,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      });

      const app = buildApp(intruder);
      const pushRes = await app.request(
        '/sync/push',
        jsonRequest('POST', {
          tables: {
            food_entries: [
              {
                id,
                entryType: 'water',
                loggedDate: '2026-07-20',
                amountMl: 999,
                loggedAt: now,
                createdAt: now,
                updatedAt: now + 1000,
                deleted: false,
              },
            ],
          },
        }),
        env,
      );
      const pushBody = (await pushRes.json()) as {
        tables: { food_entries: { applied: number; skipped: number; rejected: number } };
      };
      expect(pushBody.tables.food_entries).toEqual({ applied: 0, skipped: 0, rejected: 1 });
    });
  });
});
