import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { exercises, users } from '@ascent/shared';

import type { AuthEnv, AuthUser } from '../middleware/auth';
import { exercisesRouter } from './exercises';

function buildApp(user: AuthUser) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/exercises', exercisesRouter);
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

async function createGlobalExercise(overrides: {
  name: string;
  nameDe?: string;
  primaryMuscle?: string;
  category?: string;
  equipment?: string;
}): Promise<string> {
  const db = drizzle(env.DB);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(exercises).values({
    id,
    userId: null,
    name: overrides.name,
    nameDe: overrides.nameDe,
    primaryMuscle: overrides.primaryMuscle,
    category: overrides.category,
    equipment: overrides.equipment,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  });
  return id;
}

function jsonRequest(method: string, body: unknown) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

describe('exercisesRouter', () => {
  describe('GET /exercises', () => {
    it('listet globale und eigene Übungen, aber nicht die eines anderen Nutzers', async () => {
      const user = await createUser();
      const other = await createUser();
      await createGlobalExercise({ name: 'Global A' });
      const app = buildApp(user);

      await app.request('/exercises', jsonRequest('POST', { name: 'Eigene Übung' }), env);
      await buildApp(other).request('/exercises', jsonRequest('POST', { name: 'Fremde Übung' }), env);

      const res = await app.request('/exercises', {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ name: string }>;
      const names = body.map((e) => e.name);
      expect(names).toContain('Global A');
      expect(names).toContain('Eigene Übung');
      expect(names).not.toContain('Fremde Übung');
    });

    it('?q durchsucht name UND nameDe case-insensitive', async () => {
      const user = await createUser();
      await createGlobalExercise({ name: 'Bench Press', nameDe: 'Bankdrücken' });
      await createGlobalExercise({ name: 'Squat', nameDe: 'Kniebeuge' });

      const resByEnglish = await buildApp(user).request('/exercises?q=BENCH', {}, env);
      const byEnglish = (await resByEnglish.json()) as Array<{ name: string }>;
      expect(byEnglish.map((e) => e.name)).toEqual(['Bench Press']);

      const resByGerman = await buildApp(user).request('/exercises?q=bankdrück', {}, env);
      const byGerman = (await resByGerman.json()) as Array<{ name: string }>;
      expect(byGerman.map((e) => e.name)).toEqual(['Bench Press']);
    });

    it('?muscle/?category/?equipment filtern exakt', async () => {
      const user = await createUser();
      await createGlobalExercise({ name: 'A', primaryMuscle: 'chest', category: 'push', equipment: 'barbell' });
      await createGlobalExercise({ name: 'B', primaryMuscle: 'back', category: 'pull', equipment: 'dumbbell' });

      const res = await buildApp(user).request('/exercises?muscle=chest&category=push&equipment=barbell', {}, env);
      const body = (await res.json()) as Array<{ name: string }>;
      expect(body.map((e) => e.name)).toEqual(['A']);
    });

    it('unterstützt Pagination via ?limit/?offset', async () => {
      const user = await createUser();
      // Storage ist nur pro Testdatei isoliert — für deterministische
      // Reihenfolge/Anzahl die Übungen vorheriger Tests entfernen.
      await drizzle(env.DB).delete(exercises);
      for (const name of ['A', 'B', 'C', 'D']) {
        await createGlobalExercise({ name });
      }

      const res = await buildApp(user).request('/exercises?limit=2&offset=1', {}, env);
      const body = (await res.json()) as Array<{ name: string }>;
      expect(body.map((e) => e.name)).toEqual(['B', 'C']);
    });
  });

  describe('POST /exercises', () => {
    it('legt eine eigene Übung an (userId = user.id)', async () => {
      const user = await createUser();
      const res = await buildApp(user).request('/exercises', jsonRequest('POST', { name: 'Neue Übung' }), env);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { userId: string };
      expect(body.userId).toBe(user.id);
    });

    it('liefert 400 bei ungültigem Body (leerer Name)', async () => {
      const user = await createUser();
      const res = await buildApp(user).request('/exercises', jsonRequest('POST', { name: '' }), env);
      expect(res.status).toBe(400);
    });
  });

  describe('PUT/DELETE /exercises/:id', () => {
    it('erlaubt das Ändern der eigenen Übung', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const createRes = await app.request('/exercises', jsonRequest('POST', { name: 'Alt' }), env);
      const created = (await createRes.json()) as { id: string };

      const res = await app.request(`/exercises/${created.id}`, jsonRequest('PUT', { name: 'Neu' }), env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string };
      expect(body.name).toBe('Neu');
    });

    it('liefert 404 beim Versuch, eine globale Übung zu ändern oder zu löschen', async () => {
      const user = await createUser();
      const globalId = await createGlobalExercise({ name: 'Global' });

      const putRes = await buildApp(user).request(`/exercises/${globalId}`, jsonRequest('PUT', { name: 'Verändert' }), env);
      expect(putRes.status).toBe(404);

      const delRes = await buildApp(user).request(`/exercises/${globalId}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(404);
    });

    it('liefert 404 beim Versuch, die Übung eines anderen Nutzers zu ändern oder zu löschen', async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const createRes = await buildApp(owner).request('/exercises', jsonRequest('POST', { name: 'Fremd' }), env);
      const created = (await createRes.json()) as { id: string };

      const putRes = await buildApp(intruder).request(`/exercises/${created.id}`, jsonRequest('PUT', { name: 'X' }), env);
      expect(putRes.status).toBe(404);

      const delRes = await buildApp(intruder).request(`/exercises/${created.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(404);
    });

    it('Soft-Delete: eigene Übung verschwindet aus GET /, Zeile bleibt mit deleted=1', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const createRes = await app.request('/exercises', jsonRequest('POST', { name: 'Zu löschen' }), env);
      const created = (await createRes.json()) as { id: string };

      const delRes = await app.request(`/exercises/${created.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(204);

      const listRes = await app.request('/exercises', {}, env);
      const list = (await listRes.json()) as Array<{ id: string }>;
      expect(list.find((e) => e.id === created.id)).toBeUndefined();

      const db = drizzle(env.DB);
      const rows = await db.select().from(exercises).where(eq(exercises.id, created.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.deleted).toBe(true);
    });
  });
});
