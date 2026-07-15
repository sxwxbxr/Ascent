import { Hono } from 'hono';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import {
  bodyMetrics,
  exercises,
  planExercises,
  plans,
  syncPullRequestSchema,
  syncPushRequestSchema,
  workoutSets,
  workouts,
} from '@ascent/shared';
import type { SyncPullResult, SyncPushResult, SyncPushTableResult, SyncRow } from '@ascent/shared';
import type { AuthEnv } from '../middleware/auth';

/**
 * Offline-Sync (Technisches Konzept, Abschnitt 4): einfaches Pull/Push statt
 * CRDT, Konfliktauflösung per Last-Write-Wins auf Zeilenebene. Wird zentral
 * unter `/sync` gemountet (`app.route('/sync', syncRouter)`), NACH der
 * `requireAuth`-Middleware — dieser Router bringt bewusst keine eigene Auth
 * mit (siehe apps/api/src/middleware/auth.ts). Tests injizieren stattdessen
 * eine Fake-User-Middleware.
 */
export const syncRouter = new Hono<AuthEnv>();

type Db = ReturnType<typeof drizzle>;

type ApplyOutcome = 'applied' | 'skipped' | 'rejected';

function emptyCounts(): SyncPushTableResult {
  return { applied: 0, skipped: 0, rejected: 0 };
}

/** Reine LWW-Entscheidung: darf geschrieben werden (kein Bestand oder Bestand älter)? */
function isNewer(incomingUpdatedAt: number, existingUpdatedAt: number): boolean {
  return existingUpdatedAt < incomingUpdatedAt;
}

/**
 * Owner-Auflösung für Tabellen ohne eigene `user_id`-Spalte: `plan_exercises`
 * gehört demjenigen, dem der referenzierte Plan gehört.
 */
async function ownerOfPlan(db: Db, planId: string): Promise<string | undefined> {
  const rows = await db.select({ userId: plans.userId }).from(plans).where(eq(plans.id, planId)).all();
  return rows[0]?.userId;
}

/** Wie {@link ownerOfPlan}, aber für `workout_sets` über das referenzierte Workout. */
async function ownerOfWorkout(db: Db, workoutId: string): Promise<string | undefined> {
  const rows = await db.select({ userId: workouts.userId }).from(workouts).where(eq(workouts.id, workoutId)).all();
  return rows[0]?.userId;
}

/**
 * Push-Algorithmus je Zeile (gilt für alle sechs Tabellen sinngemäss):
 * (1) userId/Owner wird serverseitig erzwungen bzw. über die Eltern-Zeile
 *     aufgelöst — der Client kann das nicht beeinflussen.
 * (2) Gehört eine bereits existierende Zeile gleicher ID einem anderen Nutzer
 *     (oder ist sie global, `userId = null`) → rejected. Clients dürfen weder
 *     fremde noch globale Daten überschreiben.
 * (3) Last-Write-Wins: `existing.updatedAt >= incoming.updatedAt` → skipped.
 * (4) Sonst Update bzw. Insert → applied.
 * DB-Fehler (z. B. Fremdschlüsselverletzung durch eine ungültige `exerciseId`)
 * werden pro Zeile abgefangen → rejected. Das ist bewusst NICHT global atomar
 * (keine Transaktion über die ganze Charge): dank Last-Write-Wins ist der
 * Push idempotent, ein Client kann eine teilweise fehlgeschlagene Charge
 * gefahrlos erneut senden.
 */
async function applyExercise(db: Db, userId: string, input: SyncRow<'exercises'>): Promise<ApplyOutcome> {
  const incoming = { ...input, userId };
  const existing = (await db.select().from(exercises).where(eq(exercises.id, incoming.id)).all())[0];

  if (existing) {
    if (existing.userId !== userId) return 'rejected';
    if (!isNewer(incoming.updatedAt, existing.updatedAt)) return 'skipped';
  }

  try {
    if (existing) {
      await db.update(exercises).set(incoming).where(eq(exercises.id, incoming.id));
    } else {
      await db.insert(exercises).values(incoming);
    }
    return 'applied';
  } catch {
    return 'rejected';
  }
}

async function applyPlan(db: Db, userId: string, input: SyncRow<'plans'>): Promise<ApplyOutcome> {
  const incoming = { ...input, userId };
  const existing = (await db.select().from(plans).where(eq(plans.id, incoming.id)).all())[0];

  if (existing) {
    if (existing.userId !== userId) return 'rejected';
    if (!isNewer(incoming.updatedAt, existing.updatedAt)) return 'skipped';
  }

  try {
    if (existing) {
      await db.update(plans).set(incoming).where(eq(plans.id, incoming.id));
    } else {
      await db.insert(plans).values(incoming);
    }
    return 'applied';
  } catch {
    return 'rejected';
  }
}

async function applyWorkout(db: Db, userId: string, input: SyncRow<'workouts'>): Promise<ApplyOutcome> {
  const incoming = { ...input, userId };
  const existing = (await db.select().from(workouts).where(eq(workouts.id, incoming.id)).all())[0];

  if (existing) {
    if (existing.userId !== userId) return 'rejected';
    if (!isNewer(incoming.updatedAt, existing.updatedAt)) return 'skipped';
  }

  try {
    if (existing) {
      await db.update(workouts).set(incoming).where(eq(workouts.id, incoming.id));
    } else {
      await db.insert(workouts).values(incoming);
    }
    return 'applied';
  } catch {
    return 'rejected';
  }
}

async function applyBodyMetric(db: Db, userId: string, input: SyncRow<'body_metrics'>): Promise<ApplyOutcome> {
  const incoming = { ...input, userId };
  const existing = (await db.select().from(bodyMetrics).where(eq(bodyMetrics.id, incoming.id)).all())[0];

  if (existing) {
    if (existing.userId !== userId) return 'rejected';
    if (!isNewer(incoming.updatedAt, existing.updatedAt)) return 'skipped';
  }

  try {
    if (existing) {
      await db.update(bodyMetrics).set(incoming).where(eq(bodyMetrics.id, incoming.id));
    } else {
      await db.insert(bodyMetrics).values(incoming);
    }
    return 'applied';
  } catch {
    return 'rejected';
  }
}

async function applyPlanExercise(db: Db, userId: string, input: SyncRow<'plan_exercises'>): Promise<ApplyOutcome> {
  const existing = (await db.select().from(planExercises).where(eq(planExercises.id, input.id)).all())[0];

  // Kein eigenes userId-Feld: Owner kommt vom (Ziel-)Plan. Bei einer bereits
  // existierenden Zeile zählt zusätzlich deren AKTUELLER Plan, falls der
  // Client die planId in derselben Charge geändert hat.
  const targetOwner = await ownerOfPlan(db, input.planId);
  if (targetOwner === undefined || targetOwner !== userId) return 'rejected';

  if (existing) {
    const existingOwner =
      existing.planId === input.planId ? targetOwner : await ownerOfPlan(db, existing.planId);
    if (existingOwner === undefined || existingOwner !== userId) return 'rejected';
    if (!isNewer(input.updatedAt, existing.updatedAt)) return 'skipped';
  }

  try {
    if (existing) {
      await db.update(planExercises).set(input).where(eq(planExercises.id, input.id));
    } else {
      await db.insert(planExercises).values(input);
    }
    return 'applied';
  } catch {
    return 'rejected';
  }
}

async function applyWorkoutSet(db: Db, userId: string, input: SyncRow<'workout_sets'>): Promise<ApplyOutcome> {
  const existing = (await db.select().from(workoutSets).where(eq(workoutSets.id, input.id)).all())[0];

  const targetOwner = await ownerOfWorkout(db, input.workoutId);
  if (targetOwner === undefined || targetOwner !== userId) return 'rejected';

  if (existing) {
    const existingOwner =
      existing.workoutId === input.workoutId ? targetOwner : await ownerOfWorkout(db, existing.workoutId);
    if (existingOwner === undefined || existingOwner !== userId) return 'rejected';
    if (!isNewer(input.updatedAt, existing.updatedAt)) return 'skipped';
  }

  try {
    if (existing) {
      await db.update(workoutSets).set(input).where(eq(workoutSets.id, input.id));
    } else {
      await db.insert(workoutSets).values(input);
    }
    return 'applied';
  } catch {
    return 'rejected';
  }
}

syncRouter.post('/push', async (c) => {
  const user = c.get('user');
  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = syncPushRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'Ungültige Push-Anfrage', details: parsed.error.issues }, 400);
  }

  const db = drizzle(c.env.DB);
  const { tables } = parsed.data;

  const result: SyncPushResult = {
    tables: {
      exercises: emptyCounts(),
      plans: emptyCounts(),
      plan_exercises: emptyCounts(),
      workouts: emptyCounts(),
      workout_sets: emptyCounts(),
      body_metrics: emptyCounts(),
    },
  };

  // Reihenfolge = SYNC_TABLES (packages/shared/src/sync.ts): Eltern vor
  // Kindern, sowohl wegen der Fremdschlüssel als auch, damit die Owner-
  // Auflösung von plan_exercises/workout_sets bereits verarbeitete
  // Eltern-Zeilen aus derselben Charge sieht.
  for (const row of tables.exercises ?? []) {
    result.tables.exercises[await applyExercise(db, user.id, row)]++;
  }
  for (const row of tables.plans ?? []) {
    result.tables.plans[await applyPlan(db, user.id, row)]++;
  }
  for (const row of tables.plan_exercises ?? []) {
    result.tables.plan_exercises[await applyPlanExercise(db, user.id, row)]++;
  }
  for (const row of tables.workouts ?? []) {
    result.tables.workouts[await applyWorkout(db, user.id, row)]++;
  }
  for (const row of tables.workout_sets ?? []) {
    result.tables.workout_sets[await applyWorkoutSet(db, user.id, row)]++;
  }
  for (const row of tables.body_metrics ?? []) {
    result.tables.body_metrics[await applyBodyMetric(db, user.id, row)]++;
  }

  return c.json(result);
});

syncRouter.post('/pull', async (c) => {
  const user = c.get('user');
  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = syncPullRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'Ungültige Pull-Anfrage', details: parsed.error.issues }, 400);
  }

  // serverTime wird VOR den Queries erfasst: lieber eine kurze Überlappung
  // als eine Lücke. Die Überlappung ist dank Last-Write-Wins idempotent —
  // der Client sieht eine Zeile im schlimmsten Fall nochmal, übernimmt sie
  // aber verlustfrei erneut (gleicher Stand, keine Datenverfälschung).
  const serverTime = Date.now();
  const since = parsed.data.since ?? {};
  const db = drizzle(c.env.DB);

  const [exerciseRows, planRows, planExerciseRows, workoutRows, workoutSetRows, bodyMetricRows] = await Promise.all([
    db
      .select()
      .from(exercises)
      .where(
        and(
          gt(exercises.updatedAt, since.exercises ?? 0),
          or(eq(exercises.userId, user.id), isNull(exercises.userId)),
        ),
      )
      .all(),
    db
      .select()
      .from(plans)
      .where(and(gt(plans.updatedAt, since.plans ?? 0), eq(plans.userId, user.id)))
      .all(),
    db
      .select({
        id: planExercises.id,
        planId: planExercises.planId,
        exerciseId: planExercises.exerciseId,
        position: planExercises.position,
        targetSets: planExercises.targetSets,
        targetRepsMin: planExercises.targetRepsMin,
        targetRepsMax: planExercises.targetRepsMax,
        restSeconds: planExercises.restSeconds,
        createdAt: planExercises.createdAt,
        updatedAt: planExercises.updatedAt,
        deleted: planExercises.deleted,
      })
      .from(planExercises)
      .innerJoin(plans, eq(planExercises.planId, plans.id))
      .where(and(gt(planExercises.updatedAt, since.plan_exercises ?? 0), eq(plans.userId, user.id)))
      .all(),
    db
      .select()
      .from(workouts)
      .where(and(gt(workouts.updatedAt, since.workouts ?? 0), eq(workouts.userId, user.id)))
      .all(),
    db
      .select({
        id: workoutSets.id,
        workoutId: workoutSets.workoutId,
        exerciseId: workoutSets.exerciseId,
        setNumber: workoutSets.setNumber,
        weightKg: workoutSets.weightKg,
        reps: workoutSets.reps,
        completedAt: workoutSets.completedAt,
        createdAt: workoutSets.createdAt,
        updatedAt: workoutSets.updatedAt,
        deleted: workoutSets.deleted,
      })
      .from(workoutSets)
      .innerJoin(workouts, eq(workoutSets.workoutId, workouts.id))
      .where(and(gt(workoutSets.updatedAt, since.workout_sets ?? 0), eq(workouts.userId, user.id)))
      .all(),
    db
      .select()
      .from(bodyMetrics)
      .where(and(gt(bodyMetrics.updatedAt, since.body_metrics ?? 0), eq(bodyMetrics.userId, user.id)))
      .all(),
  ]);

  const result: SyncPullResult = {
    serverTime,
    tables: {
      exercises: exerciseRows,
      plans: planRows,
      plan_exercises: planExerciseRows,
      workouts: workoutRows,
      workout_sets: workoutSetRows,
      body_metrics: bodyMetricRows,
    },
  };

  return c.json(result);
});
