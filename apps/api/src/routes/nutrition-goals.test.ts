import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { nutritionGoals, users } from '@ascent/shared';

import type { AuthEnv, AuthUser } from '../middleware/auth';
import { nutritionGoalsRouter } from './nutrition-goals';
import { syncRouter } from './sync';

function buildApp(user: AuthUser) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/nutrition-goals', nutritionGoalsRouter);
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

describe('nutritionGoalsRouter', () => {
  describe('GET/POST /nutrition-goals', () => {
    it('legt Ziele an und listet sie neuestes zuerst, gefiltert auf den eigenen Nutzer', async () => {
      const user = await createUser();
      const other = await createUser();
      const app = buildApp(user);

      await app.request(
        '/nutrition-goals',
        jsonRequest('POST', { effectiveFrom: '2026-01-01', kcalTarget: 2000 }),
        env,
      );
      await app.request(
        '/nutrition-goals',
        jsonRequest('POST', { effectiveFrom: '2026-06-01', kcalTarget: 1800 }),
        env,
      );
      await buildApp(other).request(
        '/nutrition-goals',
        jsonRequest('POST', { effectiveFrom: '2026-03-01', kcalTarget: 2500 }),
        env,
      );

      const res = await app.request('/nutrition-goals', {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ effectiveFrom: string; userId: string }>;
      expect(body.map((g) => g.effectiveFrom)).toEqual(['2026-06-01', '2026-01-01']);
      expect(body.every((g) => g.userId === user.id)).toBe(true);
    });

    it('akzeptiert eine optionale client-generierte id und optionale Makro-/Wasserziele', async () => {
      const user = await createUser();
      const id = crypto.randomUUID();
      const res = await buildApp(user).request(
        '/nutrition-goals',
        jsonRequest('POST', {
          id,
          effectiveFrom: '2026-01-01',
          kcalTarget: 2200,
          proteinTargetG: 150,
          carbsTargetG: 250,
          fatTargetG: 70,
          waterTargetMl: 2500,
        }),
        env,
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; proteinTargetG: number; waterTargetMl: number };
      expect(body.id).toBe(id);
      expect(body.proteinTargetG).toBe(150);
      expect(body.waterTargetMl).toBe(2500);
    });

    it('liefert 400 bei ungültigem Body (negatives kcalTarget)', async () => {
      const user = await createUser();
      const res = await buildApp(user).request(
        '/nutrition-goals',
        jsonRequest('POST', { effectiveFrom: '2026-01-01', kcalTarget: -100 }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it('liefert 400 bei ungültigem effectiveFrom (kein ISO-Datum)', async () => {
      const user = await createUser();
      const res = await buildApp(user).request(
        '/nutrition-goals',
        jsonRequest('POST', { effectiveFrom: '01.01.2026', kcalTarget: 2000 }),
        env,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('PUT/DELETE /nutrition-goals/:id', () => {
    it('aktualisiert partiell und ignoriert id/userId/createdAt', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const createRes = await app.request(
        '/nutrition-goals',
        jsonRequest('POST', { effectiveFrom: '2026-01-01', kcalTarget: 2000, proteinTargetG: 120 }),
        env,
      );
      const created = (await createRes.json()) as { id: string; createdAt: number };

      const putRes = await app.request(
        `/nutrition-goals/${created.id}`,
        jsonRequest('PUT', { kcalTarget: 1900, id: 'x', createdAt: 1 }),
        env,
      );
      expect(putRes.status).toBe(200);
      const updated = (await putRes.json()) as { kcalTarget: number; proteinTargetG: number; createdAt: number };
      expect(updated.kcalTarget).toBe(1900);
      expect(updated.proteinTargetG).toBe(120);
      expect(updated.createdAt).toBe(created.createdAt);
    });

    it('liefert 404 beim Ändern/Löschen eines fremden Ziels', async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const createRes = await buildApp(owner).request(
        '/nutrition-goals',
        jsonRequest('POST', { effectiveFrom: '2026-01-01', kcalTarget: 2000 }),
        env,
      );
      const created = (await createRes.json()) as { id: string };

      const putRes = await buildApp(intruder).request(
        `/nutrition-goals/${created.id}`,
        jsonRequest('PUT', { kcalTarget: 1 }),
        env,
      );
      expect(putRes.status).toBe(404);

      const delRes = await buildApp(intruder).request(`/nutrition-goals/${created.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(404);
    });

    it('Soft-Delete: verschwindet aus GET /, Zeile bleibt mit deleted=1', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const createRes = await app.request(
        '/nutrition-goals',
        jsonRequest('POST', { effectiveFrom: '2026-01-01', kcalTarget: 2000 }),
        env,
      );
      const created = (await createRes.json()) as { id: string };

      const delRes = await app.request(`/nutrition-goals/${created.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(204);

      const listRes = await app.request('/nutrition-goals', {}, env);
      const list = (await listRes.json()) as Array<{ id: string }>;
      expect(list.find((g) => g.id === created.id)).toBeUndefined();

      const db = drizzle(env.DB);
      const rows = await db.select().from(nutritionGoals).where(eq(nutritionGoals.id, created.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.deleted).toBe(true);
    });
  });

  describe('Sync-Roundtrip (nutrition_goals)', () => {
    it('pusht ein eigenes Ziel (applied) und liefert es beim Pull zurück', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const id = crypto.randomUUID();
      const now = Date.now();

      const pushRes = await app.request(
        '/sync/push',
        jsonRequest('POST', {
          tables: {
            nutrition_goals: [
              {
                id,
                effectiveFrom: '2026-01-01',
                kcalTarget: 2100,
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
        tables: { nutrition_goals: { applied: number; skipped: number; rejected: number } };
      };
      expect(pushBody.tables.nutrition_goals).toEqual({ applied: 1, skipped: 0, rejected: 0 });

      const pullRes = await app.request('/sync/pull', jsonRequest('POST', { since: {} }), env);
      const pullBody = (await pullRes.json()) as {
        tables: { nutrition_goals: Array<{ id: string; userId: string }> };
      };
      const found = pullBody.tables.nutrition_goals.find((g) => g.id === id);
      expect(found).toBeDefined();
      expect(found?.userId).toBe(user.id);
    });

    it('LWW: älterer Push wird übersprungen, neuerer angewendet', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const db = drizzle(env.DB);
      const id = crypto.randomUUID();
      const baseTime = Date.now();

      await db.insert(nutritionGoals).values({
        id,
        userId: user.id,
        effectiveFrom: '2026-01-01',
        kcalTarget: 2000,
        createdAt: baseTime,
        updatedAt: baseTime,
        deleted: false,
      });

      const olderRes = await app.request(
        '/sync/push',
        jsonRequest('POST', {
          tables: {
            nutrition_goals: [
              { id, effectiveFrom: '2026-01-01', kcalTarget: 1, createdAt: baseTime, updatedAt: baseTime - 1000, deleted: false },
            ],
          },
        }),
        env,
      );
      const olderBody = (await olderRes.json()) as {
        tables: { nutrition_goals: { applied: number; skipped: number; rejected: number } };
      };
      expect(olderBody.tables.nutrition_goals).toEqual({ applied: 0, skipped: 1, rejected: 0 });

      const newerRes = await app.request(
        '/sync/push',
        jsonRequest('POST', {
          tables: {
            nutrition_goals: [
              { id, effectiveFrom: '2026-01-01', kcalTarget: 1700, createdAt: baseTime, updatedAt: baseTime + 1000, deleted: false },
            ],
          },
        }),
        env,
      );
      const newerBody = (await newerRes.json()) as {
        tables: { nutrition_goals: { applied: number; skipped: number; rejected: number } };
      };
      expect(newerBody.tables.nutrition_goals).toEqual({ applied: 1, skipped: 0, rejected: 0 });

      const row = (await db.select().from(nutritionGoals).where(eq(nutritionGoals.id, id)).all())[0];
      expect(row?.kcalTarget).toBe(1700);
    });
  });
});
