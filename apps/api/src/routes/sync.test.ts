/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { bodyMetrics, exercises, planExercises, plans, users, workoutSets, workouts } from '@ascent/shared';

import type { AuthEnv, AuthUser } from '../middleware/auth';
import { syncRouter } from './sync';

// Fake-Auth statt der echten requireAuth-Middleware (die zentral in index.ts
// gemountet wird und syncRouter selbst nicht kennt — siehe sync.ts-Kommentar).
function buildApp(user: AuthUser) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/sync', syncRouter);
  return app;
}

function jsonInit(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

type PushBody = {
  tables: Record<string, { applied: number; skipped: number; rejected: number }>;
};

type PullBody = {
  serverTime: number;
  tables: Record<string, { id: string; [key: string]: unknown }[]>;
};

async function seedUser(id: string, email: string) {
  const db = drizzle(env.DB);
  await db.insert(users).values({
    id,
    email,
    displayName: email,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

let ownerUser: AuthUser;
let otherUser: AuthUser;

// @cloudflare/vitest-pool-workers (0.18.x) isoliert den D1-Storage nur pro
// TESTDATEI, nicht pro Test. Daher raeumen wir vor jedem Test selbst auf
// (umgekehrte FK-Reihenfolge) und legen die Nutzer frisch an.
beforeEach(async () => {
  const db = drizzle(env.DB);
  await db.delete(workoutSets);
  await db.delete(planExercises);
  await db.delete(bodyMetrics);
  await db.delete(workouts);
  await db.delete(plans);
  await db.delete(exercises);
  await db.delete(users);
  ownerUser = { id: crypto.randomUUID(), email: 'owner@ascent.test', tier: 'free' };
  otherUser = { id: crypto.randomUUID(), email: 'other@ascent.test', tier: 'free' };
  await seedUser(ownerUser.id, ownerUser.email);
  await seedUser(otherUser.id, otherUser.email);
});

describe('POST /sync/push und /sync/pull', () => {
  it('wendet neue Zeilen an (Plan, Workout, Sets) und liefert sie beim Pull mit since=0 zurueck', async () => {
    const db = drizzle(env.DB);
    const exerciseId = crypto.randomUUID();
    const now = Date.now();
    await db.insert(exercises).values({
      id: exerciseId,
      userId: null,
      name: 'Kniebeuge',
      createdAt: now,
      updatedAt: now,
      deleted: false,
    });

    const app = buildApp(ownerUser);
    const planId = crypto.randomUUID();
    const workoutId = crypto.randomUUID();
    const setId = crypto.randomUUID();

    const pushRes = await app.request(
      '/sync/push',
      jsonInit({
        tables: {
          plans: [{ id: planId, name: 'Push-Plan', createdAt: now, updatedAt: now, deleted: false }],
          workouts: [{ id: workoutId, planId, startedAt: now, createdAt: now, updatedAt: now, deleted: false }],
          workout_sets: [
            {
              id: setId,
              workoutId,
              exerciseId,
              setNumber: 1,
              weightKg: 80,
              reps: 5,
              completedAt: now,
              createdAt: now,
              updatedAt: now,
              deleted: false,
            },
          ],
        },
      }),
      env,
    );

    expect(pushRes.status).toBe(200);
    const pushBody = (await pushRes.json()) as PushBody;
    expect(pushBody.tables.plans).toEqual({ applied: 1, skipped: 0, rejected: 0 });
    expect(pushBody.tables.workouts).toEqual({ applied: 1, skipped: 0, rejected: 0 });
    expect(pushBody.tables.workout_sets).toEqual({ applied: 1, skipped: 0, rejected: 0 });

    const pullRes = await app.request('/sync/pull', jsonInit({ since: {} }), env);
    expect(pullRes.status).toBe(200);
    const pullBody = (await pullRes.json()) as PullBody;
    expect(pullBody.tables.plans?.map((r) => r.id)).toContain(planId);
    expect(pullBody.tables.workouts?.map((r) => r.id)).toContain(workoutId);
    expect(pullBody.tables.workout_sets?.map((r) => r.id)).toContain(setId);
  });

  it('LWW: aelterer Push wird uebersprungen (DB unveraendert), neuerer Push wird angewendet', async () => {
    const db = drizzle(env.DB);
    const planId = crypto.randomUUID();
    const baseTime = Date.now();
    await db.insert(plans).values({
      id: planId,
      userId: ownerUser.id,
      name: 'Original',
      createdAt: baseTime,
      updatedAt: baseTime,
      deleted: false,
    });

    const app = buildApp(ownerUser);

    const olderRes = await app.request(
      '/sync/push',
      jsonInit({
        tables: {
          plans: [
            { id: planId, name: 'Aelterer Versuch', createdAt: baseTime, updatedAt: baseTime - 1000, deleted: false },
          ],
        },
      }),
      env,
    );
    const olderBody = (await olderRes.json()) as PushBody;
    expect(olderBody.tables.plans).toEqual({ applied: 0, skipped: 1, rejected: 0 });

    const afterOlder = (await db.select().from(plans).where(eq(plans.id, planId)).all())[0];
    expect(afterOlder?.name).toBe('Original');
    expect(afterOlder?.updatedAt).toBe(baseTime);

    const newerRes = await app.request(
      '/sync/push',
      jsonInit({
        tables: {
          plans: [
            { id: planId, name: 'Aktualisiert', createdAt: baseTime, updatedAt: baseTime + 1000, deleted: false },
          ],
        },
      }),
      env,
    );
    const newerBody = (await newerRes.json()) as PushBody;
    expect(newerBody.tables.plans).toEqual({ applied: 1, skipped: 0, rejected: 0 });

    const afterNewer = (await db.select().from(plans).where(eq(plans.id, planId)).all())[0];
    expect(afterNewer?.name).toBe('Aktualisiert');
  });

  it('lehnt Push auf eine fremde Zeile ab (existierende Zeile gehoert anderem Nutzer)', async () => {
    const db = drizzle(env.DB);
    const planId = crypto.randomUUID();
    const now = Date.now();
    await db.insert(plans).values({
      id: planId,
      userId: otherUser.id,
      name: 'Fremder Plan',
      createdAt: now,
      updatedAt: now,
      deleted: false,
    });

    const app = buildApp(ownerUser);
    const res = await app.request(
      '/sync/push',
      jsonInit({
        tables: {
          plans: [{ id: planId, name: 'Uebernahme-Versuch', createdAt: now, updatedAt: now + 1000, deleted: false }],
        },
      }),
      env,
    );
    const body = (await res.json()) as PushBody;
    expect(body.tables.plans).toEqual({ applied: 0, skipped: 0, rejected: 1 });

    const unchanged = (await db.select().from(plans).where(eq(plans.id, planId)).all())[0];
    expect(unchanged?.userId).toBe(otherUser.id);
    expect(unchanged?.name).toBe('Fremder Plan');
  });

  it('lehnt das Ueberschreiben einer globalen Uebung ab, zeigt sie aber weiterhin im Pull', async () => {
    const db = drizzle(env.DB);
    const exerciseId = crypto.randomUUID();
    const now = Date.now();
    await db.insert(exercises).values({
      id: exerciseId,
      userId: null,
      name: 'Kreuzheben',
      createdAt: now,
      updatedAt: now,
      deleted: false,
    });

    const app = buildApp(ownerUser);
    const pushRes = await app.request(
      '/sync/push',
      jsonInit({
        tables: {
          exercises: [{ id: exerciseId, name: 'Gehackt', createdAt: now, updatedAt: now + 1000, deleted: false }],
        },
      }),
      env,
    );
    const pushBody = (await pushRes.json()) as PushBody;
    expect(pushBody.tables.exercises).toEqual({ applied: 0, skipped: 0, rejected: 1 });

    const pullRes = await app.request('/sync/pull', jsonInit({ since: {} }), env);
    const pullBody = (await pullRes.json()) as PullBody;
    const found = pullBody.tables.exercises?.find((r) => r.id === exerciseId);
    expect(found).toBeDefined();
    expect(found?.name).toBe('Kreuzheben');
    expect(found?.userId).toBeNull();
  });

  it('deleted-Roundtrip: Push mit deleted=true liefert die Zeile beim Pull mit deleted=true', async () => {
    const app = buildApp(ownerUser);
    const planId = crypto.randomUUID();
    const now = Date.now();

    const pushRes = await app.request(
      '/sync/push',
      jsonInit({
        tables: {
          plans: [{ id: planId, name: 'Zu loeschen', createdAt: now, updatedAt: now, deleted: true }],
        },
      }),
      env,
    );
    expect(((await pushRes.json()) as PushBody).tables.plans).toEqual({ applied: 1, skipped: 0, rejected: 0 });

    const pullRes = await app.request('/sync/pull', jsonInit({ since: {} }), env);
    const pullBody = (await pullRes.json()) as PullBody;
    const found = pullBody.tables.plans?.find((r) => r.id === planId);
    expect(found?.deleted).toBe(true);
  });

  it('lehnt ungueltigen Payload und Chargen ueber 500 Zeilen mit 400 ab', async () => {
    const app = buildApp(ownerUser);

    const invalidRes = await app.request('/sync/push', jsonInit({ tables: { plans: 'nope' } }), env);
    expect(invalidRes.status).toBe(400);

    const now = Date.now();
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      id: crypto.randomUUID(),
      measuredAt: now,
      weightKg: 80 + i * 0.01,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    }));
    const overflowRes = await app.request('/sync/push', jsonInit({ tables: { body_metrics: tooMany } }), env);
    expect(overflowRes.status).toBe(400);
  });

  it('lehnt workout_set mit nicht existentem Workout ab, Rest der Charge bleibt applied', async () => {
    const db = drizzle(env.DB);
    const exerciseId = crypto.randomUUID();
    const workoutId = crypto.randomUUID();
    const now = Date.now();

    await db.insert(exercises).values({
      id: exerciseId,
      userId: null,
      name: 'Bankdruecken',
      createdAt: now,
      updatedAt: now,
      deleted: false,
    });
    await db.insert(workouts).values({
      id: workoutId,
      userId: ownerUser.id,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    });

    const app = buildApp(ownerUser);
    const validSetId = crypto.randomUUID();
    const orphanSetId = crypto.randomUUID();

    const res = await app.request(
      '/sync/push',
      jsonInit({
        tables: {
          workout_sets: [
            {
              id: validSetId,
              workoutId,
              exerciseId,
              setNumber: 1,
              weightKg: 60,
              reps: 8,
              completedAt: now,
              createdAt: now,
              updatedAt: now,
              deleted: false,
            },
            {
              id: orphanSetId,
              workoutId: crypto.randomUUID(),
              exerciseId,
              setNumber: 1,
              weightKg: 60,
              reps: 8,
              completedAt: now,
              createdAt: now,
              updatedAt: now,
              deleted: false,
            },
          ],
        },
      }),
      env,
    );

    const body = (await res.json()) as PushBody;
    expect(body.tables.workout_sets).toEqual({ applied: 1, skipped: 0, rejected: 1 });
  });

  it('Pull-since filtert: nur Zeilen neuer als der Cursor kommen zurueck', async () => {
    const db = drizzle(env.DB);
    const olderPlanId = crypto.randomUUID();
    const newerPlanId = crypto.randomUUID();
    const t1 = Date.now();
    const t2 = t1 + 5000;

    await db.insert(plans).values([
      { id: olderPlanId, userId: ownerUser.id, name: 'Alt', createdAt: t1, updatedAt: t1, deleted: false },
      { id: newerPlanId, userId: ownerUser.id, name: 'Neu', createdAt: t2, updatedAt: t2, deleted: false },
    ]);

    const app = buildApp(ownerUser);
    const res = await app.request('/sync/pull', jsonInit({ since: { plans: t1 } }), env);
    const body = (await res.json()) as PullBody;
    const ids = body.tables.plans?.map((r) => r.id) ?? [];
    expect(ids).not.toContain(olderPlanId);
    expect(ids).toContain(newerPlanId);
  });
});
