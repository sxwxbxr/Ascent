import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { exercises, plans, users, workoutSets, workouts } from '@ascent/shared';

import type { AuthEnv, AuthUser } from '../middleware/auth';
import { workoutsRouter } from './workouts';

function buildApp(user: AuthUser) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/workouts', workoutsRouter);
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

async function createExercise(userId: string | null = null, name = 'Kniebeuge'): Promise<string> {
  const db = drizzle(env.DB);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(exercises).values({ id, userId, name, createdAt: now, updatedAt: now, deleted: false });
  return id;
}

async function createPlan(userId: string, name = 'Plan'): Promise<string> {
  const db = drizzle(env.DB);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(plans).values({ id, userId, name, createdAt: now, updatedAt: now, deleted: false });
  return id;
}

function jsonRequest(method: string, body: unknown) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

describe('workoutsRouter', () => {
  describe('GET/POST /workouts', () => {
    it('legt ein Workout an und listet eigene Workouts neueste zuerst', async () => {
      const user = await createUser();
      const app = buildApp(user);

      await app.request('/workouts', jsonRequest('POST', { startedAt: 1000 }), env);
      await app.request('/workouts', jsonRequest('POST', { startedAt: 3000 }), env);
      await app.request('/workouts', jsonRequest('POST', { startedAt: 2000 }), env);

      const res = await app.request('/workouts', {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ startedAt: number }>;
      expect(body.map((w) => w.startedAt)).toEqual([3000, 2000, 1000]);
    });

    it('filtert nach ?from/?to auf startedAt und blendet fremde Workouts aus', async () => {
      const user = await createUser();
      const other = await createUser();
      const app = buildApp(user);

      await app.request('/workouts', jsonRequest('POST', { startedAt: 1000 }), env);
      await app.request('/workouts', jsonRequest('POST', { startedAt: 2000 }), env);
      await app.request('/workouts', jsonRequest('POST', { startedAt: 3000 }), env);
      await buildApp(other).request('/workouts', jsonRequest('POST', { startedAt: 2000 }), env);

      const res = await app.request('/workouts?from=1500&to=2500', {}, env);
      const body = (await res.json()) as Array<{ startedAt: number; userId: string }>;
      expect(body).toHaveLength(1);
      expect(body[0]?.startedAt).toBe(2000);
      expect(body.every((w) => w.userId === user.id)).toBe(true);
    });

    it('POST / mit planId eines anderen Nutzers liefert 400', async () => {
      const user = await createUser();
      const other = await createUser();
      const foreignPlanId = await createPlan(other.id);

      const res = await buildApp(user).request('/workouts', jsonRequest('POST', { startedAt: 1000, planId: foreignPlanId }), env);
      expect(res.status).toBe(400);
    });

    it('POST / mit eigenem planId funktioniert', async () => {
      const user = await createUser();
      const ownPlanId = await createPlan(user.id);

      const res = await buildApp(user).request('/workouts', jsonRequest('POST', { startedAt: 1000, planId: ownPlanId }), env);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { planId: string };
      expect(body.planId).toBe(ownPlanId);
    });

    it('POST / liefert 400 bei ungültigem Body (finishedAt vor startedAt)', async () => {
      const user = await createUser();
      const res = await buildApp(user).request(
        '/workouts',
        jsonRequest('POST', { startedAt: 2000, finishedAt: 1000 }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it('unterstützt Pagination via ?limit/?offset', async () => {
      const user = await createUser();
      const app = buildApp(user);
      for (let i = 0; i < 5; i += 1) {
        await app.request('/workouts', jsonRequest('POST', { startedAt: 1000 + i }), env);
      }

      const res = await app.request('/workouts?limit=2&offset=1', {}, env);
      const body = (await res.json()) as Array<{ startedAt: number }>;
      expect(body).toHaveLength(2);
    });
  });

  describe('GET /workouts/:id', () => {
    it('liefert das Workout inkl. Sätzen sortiert nach setNumber, ohne gelöschte', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const exerciseId = await createExercise();

      const workoutRes = await app.request('/workouts', jsonRequest('POST', { startedAt: 1000 }), env);
      const workout = (await workoutRes.json()) as { id: string };

      await app.request(
        `/workouts/${workout.id}/sets`,
        jsonRequest('POST', { exerciseId, setNumber: 2, weightKg: 100, reps: 5, completedAt: 100 }),
        env,
      );
      await app.request(
        `/workouts/${workout.id}/sets`,
        jsonRequest('POST', { exerciseId, setNumber: 1, weightKg: 90, reps: 8, completedAt: 90 }),
        env,
      );
      const toDeleteRes = await app.request(
        `/workouts/${workout.id}/sets`,
        jsonRequest('POST', { exerciseId, setNumber: 3, weightKg: 110, reps: 3, completedAt: 110 }),
        env,
      );
      const toDelete = (await toDeleteRes.json()) as { id: string };
      await app.request(`/workouts/${workout.id}/sets/${toDelete.id}`, { method: 'DELETE' }, env);

      const detail = await app.request(`/workouts/${workout.id}`, {}, env);
      expect(detail.status).toBe(200);
      const body = (await detail.json()) as { sets: Array<{ setNumber: number }> };
      expect(body.sets.map((s) => s.setNumber)).toEqual([1, 2]);
    });

    it('liefert 404 für ein Workout eines anderen Nutzers', async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const workoutRes = await buildApp(owner).request('/workouts', jsonRequest('POST', { startedAt: 1000 }), env);
      const workout = (await workoutRes.json()) as { id: string };

      const res = await buildApp(intruder).request(`/workouts/${workout.id}`, {}, env);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT/DELETE /workouts/:id', () => {
    it('aktualisiert partiell und ignoriert id/userId/createdAt', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const workoutRes = await app.request('/workouts', jsonRequest('POST', { startedAt: 1000, notes: 'alt' }), env);
      const workout = (await workoutRes.json()) as { id: string; createdAt: number };

      const putRes = await app.request(
        `/workouts/${workout.id}`,
        jsonRequest('PUT', { startedAt: 5000, id: 'x', createdAt: 1 }),
        env,
      );
      expect(putRes.status).toBe(200);
      const updated = (await putRes.json()) as { startedAt: number; notes: string; createdAt: number };
      expect(updated.startedAt).toBe(5000);
      expect(updated.notes).toBe('alt');
      expect(updated.createdAt).toBe(workout.createdAt);
    });

    it('Soft-Delete: verschwindet aus GET /, Zeile bleibt mit deleted=1', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const workoutRes = await app.request('/workouts', jsonRequest('POST', { startedAt: 1000 }), env);
      const workout = (await workoutRes.json()) as { id: string };

      const delRes = await app.request(`/workouts/${workout.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(204);

      const listRes = await app.request('/workouts', {}, env);
      const list = (await listRes.json()) as Array<{ id: string }>;
      expect(list.find((w) => w.id === workout.id)).toBeUndefined();

      const db = drizzle(env.DB);
      const rows = await db.select().from(workouts).where(eq(workouts.id, workout.id));
      expect(rows[0]?.deleted).toBe(true);
    });

    it('liefert 404 beim Ändern/Löschen eines fremden Workouts', async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const workoutRes = await buildApp(owner).request('/workouts', jsonRequest('POST', { startedAt: 1000 }), env);
      const workout = (await workoutRes.json()) as { id: string };

      const putRes = await buildApp(intruder).request(`/workouts/${workout.id}`, jsonRequest('PUT', { notes: 'x' }), env);
      expect(putRes.status).toBe(404);

      const delRes = await buildApp(intruder).request(`/workouts/${workout.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(404);
    });
  });

  describe('Sätze (verschachtelt)', () => {
    it('POST /:workoutId/sets liefert 400 für eine nicht sichtbare Übung', async () => {
      const user = await createUser();
      const other = await createUser();
      const app = buildApp(user);
      const workoutRes = await app.request('/workouts', jsonRequest('POST', { startedAt: 1000 }), env);
      const workout = (await workoutRes.json()) as { id: string };
      const foreignExercise = await createExercise(other.id);

      const res = await app.request(
        `/workouts/${workout.id}/sets`,
        jsonRequest('POST', { exerciseId: foreignExercise, setNumber: 1, weightKg: 50, reps: 10, completedAt: 10 }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it('POST /:workoutId/sets liefert 404, wenn das Workout nicht dem Nutzer gehört', async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const workoutRes = await buildApp(owner).request('/workouts', jsonRequest('POST', { startedAt: 1000 }), env);
      const workout = (await workoutRes.json()) as { id: string };
      const exerciseId = await createExercise();

      const res = await buildApp(intruder).request(
        `/workouts/${workout.id}/sets`,
        jsonRequest('POST', { exerciseId, setNumber: 1, weightKg: 50, reps: 10, completedAt: 10 }),
        env,
      );
      expect(res.status).toBe(404);
    });

    it('PUT/DELETE eines Satzes funktionieren und respektieren Ownership', async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const app = buildApp(owner);
      const exerciseId = await createExercise();
      const workoutRes = await app.request('/workouts', jsonRequest('POST', { startedAt: 1000 }), env);
      const workout = (await workoutRes.json()) as { id: string };

      const setRes = await app.request(
        `/workouts/${workout.id}/sets`,
        jsonRequest('POST', { exerciseId, setNumber: 1, weightKg: 50, reps: 10, completedAt: 10 }),
        env,
      );
      const set = (await setRes.json()) as { id: string };

      const foreignPut = await buildApp(intruder).request(
        `/workouts/${workout.id}/sets/${set.id}`,
        jsonRequest('PUT', { weightKg: 60 }),
        env,
      );
      expect(foreignPut.status).toBe(404);

      const putRes = await app.request(`/workouts/${workout.id}/sets/${set.id}`, jsonRequest('PUT', { weightKg: 60 }), env);
      expect(putRes.status).toBe(200);
      const updated = (await putRes.json()) as { weightKg: number };
      expect(updated.weightKg).toBe(60);

      const delRes = await app.request(`/workouts/${workout.id}/sets/${set.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(204);

      const db = drizzle(env.DB);
      const rows = await db.select().from(workoutSets).where(eq(workoutSets.id, set.id));
      expect(rows[0]?.deleted).toBe(true);
    });
  });
});
