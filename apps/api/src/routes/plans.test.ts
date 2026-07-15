import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { exercises, planExercises, plans, users } from '@ascent/shared';

import type { AuthEnv, AuthUser } from '../middleware/auth';
import { plansRouter } from './plans';

/** Baut eine Test-App: Fake-Auth-Middleware + der zu testende Router (kein requireAuth-Stub nötig). */
function buildApp(user: AuthUser) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/plans', plansRouter);
  return app;
}

let userCounter = 0;

/** Legt einen Test-Nutzer direkt in D1 an und gibt den zugehörigen AuthUser zurück. */
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

/** Legt eine Übung an (global bei userId=null, sonst nutzereigen). */
async function createExercise(userId: string | null = null, name = 'Bankdrücken'): Promise<string> {
  const db = drizzle(env.DB);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(exercises).values({ id, userId, name, createdAt: now, updatedAt: now, deleted: false });
  return id;
}

function jsonRequest(method: string, body: unknown) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

describe('plansRouter', () => {
  describe('GET/POST /plans', () => {
    it('legt Pläne an und listet sie alphabetisch nach Name, gefiltert auf den eigenen Nutzer', async () => {
      const user = await createUser();
      const other = await createUser();
      const app = buildApp(user);

      await app.request('/plans', jsonRequest('POST', { name: 'Beinplan' }), env);
      await app.request('/plans', jsonRequest('POST', { name: 'Armplan' }), env);
      // Plan eines anderen Nutzers darf nicht in der Liste erscheinen.
      await buildApp(other).request('/plans', jsonRequest('POST', { name: 'Aaa-Plan von jemand anderem' }), env);

      const res = await app.request('/plans', {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ name: string }>;
      expect(body.map((p) => p.name)).toEqual(['Armplan', 'Beinplan']);
    });

    it('akzeptiert eine optionale client-generierte id', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const id = crypto.randomUUID();

      const res = await app.request('/plans', jsonRequest('POST', { id, name: 'Mit eigener ID' }), env);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBe(id);
    });

    it('liefert 400 bei ungültigem Body (leerer Name)', async () => {
      const user = await createUser();
      const app = buildApp(user);

      const res = await app.request('/plans', jsonRequest('POST', { name: '' }), env);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; details: unknown[] };
      expect(body.error).toBe('Ungültige Eingabe');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('unterstützt Pagination via ?limit/?offset', async () => {
      const user = await createUser();
      const app = buildApp(user);

      for (const name of ['A', 'B', 'C', 'D']) {
        await app.request('/plans', jsonRequest('POST', { name }), env);
      }

      const res = await app.request('/plans?limit=2&offset=1', {}, env);
      const body = (await res.json()) as Array<{ name: string }>;
      expect(body.map((p) => p.name)).toEqual(['B', 'C']);
    });
  });

  describe('GET /plans/:id', () => {
    it('liefert den Plan inkl. Plan-Übungen sortiert nach position, ohne gelöschte', async () => {
      const user = await createUser();
      const app = buildApp(user);

      const planRes = await app.request('/plans', jsonRequest('POST', { name: 'Push-Tag' }), env);
      const plan = (await planRes.json()) as { id: string };

      const exA = await createExercise(null, 'Bankdrücken');
      const exB = await createExercise(null, 'Schulterdrücken');
      const exC = await createExercise(null, 'Trizepsdrücken');

      await app.request(
        `/plans/${plan.id}/exercises`,
        jsonRequest('POST', { exerciseId: exB, position: 3, targetSets: 3 }),
        env,
      );
      await app.request(
        `/plans/${plan.id}/exercises`,
        jsonRequest('POST', { exerciseId: exA, position: 1, targetSets: 4 }),
        env,
      );
      const toDeleteRes = await app.request(
        `/plans/${plan.id}/exercises`,
        jsonRequest('POST', { exerciseId: exC, position: 2, targetSets: 3 }),
        env,
      );
      const toDelete = (await toDeleteRes.json()) as { id: string };
      await app.request(`/plans/${plan.id}/exercises/${toDelete.id}`, { method: 'DELETE' }, env);

      const detail = await app.request(`/plans/${plan.id}`, {}, env);
      expect(detail.status).toBe(200);
      const body = (await detail.json()) as { planExercises: Array<{ exerciseId: string }> };
      expect(body.planExercises.map((pe) => pe.exerciseId)).toEqual([exA, exB]);
    });

    it('liefert 404 für einen Plan eines anderen Nutzers (kein Existenz-Leak)', async () => {
      const owner = await createUser();
      const intruder = await createUser();

      const planRes = await buildApp(owner).request('/plans', jsonRequest('POST', { name: 'Geheimplan' }), env);
      const plan = (await planRes.json()) as { id: string };

      const res = await buildApp(intruder).request(`/plans/${plan.id}`, {}, env);
      expect(res.status).toBe(404);
    });

    it('liefert 404 für eine nicht existierende id', async () => {
      const user = await createUser();
      const res = await buildApp(user).request(`/plans/${crypto.randomUUID()}`, {}, env);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /plans/:id', () => {
    it('aktualisiert den Plan partiell und ignoriert id/userId/createdAt aus dem Body', async () => {
      const user = await createUser();
      const app = buildApp(user);

      const planRes = await app.request('/plans', jsonRequest('POST', { name: 'Alt', description: 'alt' }), env);
      const plan = (await planRes.json()) as { id: string; createdAt: number; userId: string };

      const putRes = await app.request(
        `/plans/${plan.id}`,
        jsonRequest('PUT', { name: 'Neu', id: 'anderer-wert', userId: 'fremd', createdAt: 1 }),
        env,
      );
      expect(putRes.status).toBe(200);
      const updated = (await putRes.json()) as {
        id: string;
        name: string;
        description: string;
        userId: string;
        createdAt: number;
      };
      expect(updated.id).toBe(plan.id);
      expect(updated.name).toBe('Neu');
      expect(updated.description).toBe('alt');
      expect(updated.userId).toBe(plan.userId);
      expect(updated.createdAt).toBe(plan.createdAt);
    });

    it('liefert 404 beim Versuch, den Plan eines anderen Nutzers zu ändern', async () => {
      const owner = await createUser();
      const intruder = await createUser();

      const planRes = await buildApp(owner).request('/plans', jsonRequest('POST', { name: 'Fremd' }), env);
      const plan = (await planRes.json()) as { id: string };

      const res = await buildApp(intruder).request(`/plans/${plan.id}`, jsonRequest('PUT', { name: 'Übernommen' }), env);
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /plans/:id', () => {
    it('markiert den Plan als gelöscht (Soft-Delete): verschwindet aus GET /, Zeile bleibt mit deleted=1', async () => {
      const user = await createUser();
      const app = buildApp(user);

      const planRes = await app.request('/plans', jsonRequest('POST', { name: 'Zu löschen' }), env);
      const plan = (await planRes.json()) as { id: string };

      const delRes = await app.request(`/plans/${plan.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(204);

      const listRes = await app.request('/plans', {}, env);
      const list = (await listRes.json()) as Array<{ id: string }>;
      expect(list.find((p) => p.id === plan.id)).toBeUndefined();

      const db = drizzle(env.DB);
      const rows = await db.select().from(plans).where(eq(plans.id, plan.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.deleted).toBe(true);
    });

    it('liefert 404 beim Löschen eines fremden Plans', async () => {
      const owner = await createUser();
      const intruder = await createUser();

      const planRes = await buildApp(owner).request('/plans', jsonRequest('POST', { name: 'Fremd 2' }), env);
      const plan = (await planRes.json()) as { id: string };

      const res = await buildApp(intruder).request(`/plans/${plan.id}`, { method: 'DELETE' }, env);
      expect(res.status).toBe(404);
    });
  });

  describe('Plan-Übungen (verschachtelt)', () => {
    it('POST /:planId/exercises legt eine Plan-Übung an, wenn die Übung sichtbar ist', async () => {
      const user = await createUser();
      const app = buildApp(user);

      const planRes = await app.request('/plans', jsonRequest('POST', { name: 'Mit Übungen' }), env);
      const plan = (await planRes.json()) as { id: string };
      const ownExercise = await createExercise(user.id, 'Eigene Übung');

      const res = await app.request(
        `/plans/${plan.id}/exercises`,
        jsonRequest('POST', { exerciseId: ownExercise, position: 1, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12 }),
        env,
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { planId: string; exerciseId: string };
      expect(body.planId).toBe(plan.id);
      expect(body.exerciseId).toBe(ownExercise);
    });

    it('POST /:planId/exercises liefert 400, wenn exerciseId nicht existiert', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const planRes = await app.request('/plans', jsonRequest('POST', { name: 'X' }), env);
      const plan = (await planRes.json()) as { id: string };

      const res = await app.request(
        `/plans/${plan.id}/exercises`,
        jsonRequest('POST', { exerciseId: crypto.randomUUID(), position: 1, targetSets: 3 }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it('POST /:planId/exercises liefert 400 für eine fremde (nicht-globale) Übung', async () => {
      const user = await createUser();
      const otherUser = await createUser();
      const app = buildApp(user);
      const planRes = await app.request('/plans', jsonRequest('POST', { name: 'X' }), env);
      const plan = (await planRes.json()) as { id: string };
      const foreignExercise = await createExercise(otherUser.id, 'Fremde Übung');

      const res = await app.request(
        `/plans/${plan.id}/exercises`,
        jsonRequest('POST', { exerciseId: foreignExercise, position: 1, targetSets: 3 }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it('POST /:planId/exercises liefert 400, wenn targetRepsMin > targetRepsMax', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const planRes = await app.request('/plans', jsonRequest('POST', { name: 'X' }), env);
      const plan = (await planRes.json()) as { id: string };
      const exerciseId = await createExercise();

      const res = await app.request(
        `/plans/${plan.id}/exercises`,
        jsonRequest('POST', { exerciseId, position: 1, targetSets: 3, targetRepsMin: 12, targetRepsMax: 8 }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it('POST /:planId/exercises liefert 404, wenn der Plan nicht dem Nutzer gehört', async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const planRes = await buildApp(owner).request('/plans', jsonRequest('POST', { name: 'Fremd' }), env);
      const plan = (await planRes.json()) as { id: string };
      const exerciseId = await createExercise();

      const res = await buildApp(intruder).request(
        `/plans/${plan.id}/exercises`,
        jsonRequest('POST', { exerciseId, position: 1, targetSets: 3 }),
        env,
      );
      expect(res.status).toBe(404);
    });

    it('PUT und DELETE einer Plan-Übung funktionieren und respektieren Ownership', async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const app = buildApp(owner);

      const planRes = await app.request('/plans', jsonRequest('POST', { name: 'Mit Übung' }), env);
      const plan = (await planRes.json()) as { id: string };
      const exerciseId = await createExercise();

      const createRes = await app.request(
        `/plans/${plan.id}/exercises`,
        jsonRequest('POST', { exerciseId, position: 1, targetSets: 3 }),
        env,
      );
      const planExercise = (await createRes.json()) as { id: string };

      // Fremder Nutzer darf weder ändern noch löschen.
      const foreignPut = await buildApp(intruder).request(
        `/plans/${plan.id}/exercises/${planExercise.id}`,
        jsonRequest('PUT', { targetSets: 5 }),
        env,
      );
      expect(foreignPut.status).toBe(404);

      const putRes = await app.request(
        `/plans/${plan.id}/exercises/${planExercise.id}`,
        jsonRequest('PUT', { targetSets: 5 }),
        env,
      );
      expect(putRes.status).toBe(200);
      const updated = (await putRes.json()) as { targetSets: number };
      expect(updated.targetSets).toBe(5);

      const delRes = await app.request(`/plans/${plan.id}/exercises/${planExercise.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(204);

      const db = drizzle(env.DB);
      const rows = await db.select().from(planExercises).where(eq(planExercises.id, planExercise.id));
      expect(rows[0]?.deleted).toBe(true);
    });
  });
});
