import { and, asc, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  foodCreateSchema,
  foodEntries,
  foodEntryCreateSchema,
  foodEntryUpdateSchema,
  foods,
  nutritionGoalCreateSchema,
  nutritionGoals,
} from '@ascent/shared';
import type { Food, FoodEntry, NutritionGoal } from '@ascent/shared';

import { API_URL } from '../config';
import { authClient } from '../auth/client';
import { db } from '../db/client';
import { queueSyncPush } from '../db/sync';
import { newId } from '../lib/ids';
import { getOwnerUserId } from '../lib/owner';

/**
 * Datenschicht des Ernährungs-Moduls (docs/KONZEPT_Ernaehrung.md, Abschnitte
 * 2/3.3/3.4/6): Lebensmittelsuche (online + lokaler Offline-Fallback),
 * Tagebuch (Mahlzeiten + Wasser), Ernährungsziele. Muster wie src/data/plans.ts
 * bzw. src/data/body-metrics.ts: client-generierte UUIDs (newId), Epoch-ms
 * (Date.now()), Soft-Delete über `deleted`, queueSyncPush nach jeder Mutation.
 *
 * TODO(Entitlements): Es existiert noch kein mobiles Entitlement-Gate (siehe
 * Suche nach "entitlement"/"Entitlement" in apps/mobile — kein Treffer). Laut
 * Konzept Abschnitt 5 ist `nutrition.tracking` aktuell ohnehin auf `free`
 * geseedet. Sobald ein mobiles Äquivalent zu `useEntitlement` existiert, HIER
 * (und in app/(tabs)/ernaehrung.tsx) auf 'nutrition.tracking' gaten statt neu
 * zu bauen.
 */

async function requireOwnerUserId(): Promise<string> {
  const userId = await getOwnerUserId();
  if (!userId) {
    throw new Error('Kein lokaler Nutzer gefunden — bitte neu anmelden.');
  }
  return userId;
}

// ---------------------------------------------------------------------------
// Datums-Helfer — loggedDate/effectiveFrom sind ISO-Daten (YYYY-MM-DD) in der
// LOKALEN Kalenderzeit des Geräts (nicht UTC): ein Tagebuch-Tag soll dem Tag
// entsprechen, den der Nutzer auf seinem Gerät gerade erlebt.
// ---------------------------------------------------------------------------

/** ISO-Datum (YYYY-MM-DD) aus einem Epoch-ms-Zeitpunkt, LOKALE Kalenderzeit. */
export function isoDateFromMs(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Heutiges Datum (lokale Kalenderzeit) als ISO-Datum. */
export function todayIsoDate(): string {
  return isoDateFromMs(Date.now());
}

/** Verschiebt ein ISO-Datum um `deltaDays` (negativ = zurück) — für den Datums-Navigator. */
export function shiftIsoDate(date: string, deltaDays: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(year, (month ?? 1) - 1, day);
  shifted.setDate(shifted.getDate() + deltaDays);
  return isoDateFromMs(shifted.getTime());
}

/** true, wenn `date` dem heutigen Tag (lokale Kalenderzeit) entspricht. */
export function isTodayIsoDate(date: string): boolean {
  return date === todayIsoDate();
}

// ---------------------------------------------------------------------------
// Mahlzeiten-Slots (Konzept Abschnitt 6) — deutsche Labels für die Sektionen.
// ---------------------------------------------------------------------------

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEAL_SLOTS: ReadonlyArray<{ value: MealSlot; labelDe: string }> = [
  { value: 'breakfast', labelDe: 'Frühstück' },
  { value: 'lunch', labelDe: 'Mittag' },
  { value: 'dinner', labelDe: 'Abend' },
  { value: 'snack', labelDe: 'Snack' },
];

export function mealSlotLabelDe(slot: MealSlot): string {
  return MEAL_SLOTS.find((s) => s.value === slot)?.labelDe ?? slot;
}

// ---------------------------------------------------------------------------
// Lebensmittelsuche (Konzept Abschnitt 3.3/3.4): online über GET /foods?q=,
// mit lokalem Offline-Fallback (LIKE auf name/brand, global + eigene).
// ---------------------------------------------------------------------------

function foodsSearchErrorMessage(status: number | undefined): string {
  if (!status) return 'Offline — Produkt kann erst online gesucht werden.';
  if (status === 401) return 'Sitzung abgelaufen. Bitte erneut anmelden.';
  return 'Suche fehlgeschlagen. Bitte später erneut versuchen.';
}

/**
 * Spiegelt eine Server-Food-Zeile SOFORT lokal (LWW-Upsert, analog zu
 * upsertFood in src/db/sync.ts). Nötig, weil `food_entries.food_id` eine
 * lokale Fremdschlüssel-Prüfung hat (PRAGMA foreign_keys=ON, src/db/client.ts)
 * — ohne diesen Sofort-Spiegel müsste der Nutzer nach einer Online-Suche bis
 * zum nächsten Sync-Pull warten, bevor er den Treffer verbuchen kann. Rein
 * additiv, KEIN queueSyncPush (globale Zeilen werden nie zurückgepusht, siehe
 * pushChanges in src/db/sync.ts — global bleibt hier so, weil nur `foods` mit
 * `userId` aus einer Server-Antwort stammt, wenn es eine eigene Zeile eines
 * ANDEREN Sync-Vorgangs ist; OFF-Treffer sind aber praktisch immer userId=null).
 */
async function mirrorFoodLocally(row: Food): Promise<void> {
  const values: typeof foods.$inferInsert = {
    id: row.id,
    userId: row.userId ?? null,
    barcode: row.barcode ?? null,
    name: row.name,
    brand: row.brand ?? null,
    kcalPer100: row.kcalPer100,
    proteinPer100: row.proteinPer100 ?? null,
    carbsPer100: row.carbsPer100 ?? null,
    fatPer100: row.fatPer100 ?? null,
    servingSizeG: row.servingSizeG ?? null,
    source: row.source,
    offLastFetchedAt: row.offLastFetchedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
  };

  await db.insert(foods).values(values).onConflictDoUpdate({
    target: foods.id,
    set: values,
  });
}

/**
 * Online-Produktsuche (`GET /foods?q=`, Konzept Abschnitt 3.3): liefert lokale
 * Cache-Treffer + (bei dünnen Treffern) frische OFF-Treffer, bereits vom
 * Server als globale Zeilen upgesertet. Wirft bei fehlendem Netz/Fehler — der
 * Aufrufer (Picker-Modal) fängt das ab und bietet den manuellen Schnelleintrag
 * an (Konzept Abschnitt 3.4). Debounce (400 ms) ist Aufgabe des Aufrufers.
 */
export async function searchFoodsOnline(query: string): Promise<Food[]> {
  const q = query.trim();
  if (!q) return [];

  const res = await authClient.$fetch<Food[]>(`${API_URL}/foods?q=${encodeURIComponent(q)}`, { method: 'GET' });
  if (res.error || !res.data) {
    throw new Error(foodsSearchErrorMessage(res.error?.status));
  }

  for (const row of res.data) {
    await mirrorFoodLocally(row);
  }

  return res.data;
}

/**
 * Lokale Lebensmittelsuche (Offline-Fallback, Konzept 3.4): global (userId
 * null) + eigene Zeilen, LIKE case-insensitive auf name/brand — Muster wie
 * buildExerciseListQuery in src/data/exercises.ts. Query-Builder (NICHT
 * ausgeführt) für useLiveQuery.
 */
export function buildLocalFoodSearchQuery(ownerUserId: string, search: string, limit = 20) {
  const conditions: (SQL | undefined)[] = [
    eq(foods.deleted, false),
    or(isNull(foods.userId), eq(foods.userId, ownerUserId)),
  ];

  const trimmed = search.trim();
  if (trimmed) {
    const pattern = `%${trimmed.toLowerCase()}%`;
    conditions.push(or(like(sql`lower(${foods.name})`, pattern), like(sql`lower(${foods.brand})`, pattern)));
  }

  return db
    .select()
    .from(foods)
    .where(and(...conditions))
    .orderBy(asc(foods.name))
    .limit(limit);
}

export type CustomFoodInput = {
  name: string;
  brand?: string;
  kcalPer100: number;
  proteinPer100?: number;
  carbsPer100?: number;
  fatPer100?: number;
  servingSizeG?: number;
};

/** Eigenes Lebensmittel anlegen (source 'custom', userId gesetzt) — z. B. selbst gekochte Gerichte ohne Barcode. */
export async function createCustomFood(input: CustomFoodInput): Promise<Food> {
  const userId = await requireOwnerUserId();
  const parsed = foodCreateSchema.parse(input);
  const now = Date.now();

  const [row] = await db
    .insert(foods)
    .values({
      id: parsed.id ?? newId(),
      userId,
      barcode: parsed.barcode ?? null,
      name: parsed.name,
      brand: parsed.brand ?? null,
      kcalPer100: parsed.kcalPer100,
      proteinPer100: parsed.proteinPer100 ?? null,
      carbsPer100: parsed.carbsPer100 ?? null,
      fatPer100: parsed.fatPer100 ?? null,
      servingSizeG: parsed.servingSizeG ?? null,
      source: 'custom',
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  queueSyncPush();
  return row;
}

// ---------------------------------------------------------------------------
// Nährwert-Snapshot (Konzept Abschnitt 2.2): kcal/Makros werden ZUM
// ERFASSUNGSZEITPUNKT aus food × Menge berechnet und auf food_entries
// eingefroren — spätere Änderungen am foods-Cache-Eintrag wirken sich NICHT
// rückwirkend auf bereits geloggte Einträge aus (Snapshot-Stabilität, analog
// zu workout_sets' bereits geloggten weightKg/reps).
// ---------------------------------------------------------------------------

export type NutrientSnapshot = {
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** kcal/Makros für `amountG` Gramm eines Lebensmittels (dessen *Per100-Werte je 100g/ml gelten, OFF-Konvention). */
export function computeSnapshot(
  food: Pick<Food, 'kcalPer100' | 'proteinPer100' | 'carbsPer100' | 'fatPer100'>,
  amountG: number,
): NutrientSnapshot {
  const factor = amountG / 100;
  return {
    kcal: round1(food.kcalPer100 * factor),
    proteinG: food.proteinPer100 != null ? round1(food.proteinPer100 * factor) : null,
    carbsG: food.carbsPer100 != null ? round1(food.carbsPer100 * factor) : null,
    fatG: food.fatPer100 != null ? round1(food.fatPer100 * factor) : null,
  };
}

// ---------------------------------------------------------------------------
// Tagebuch — Mahlzeiten (Konzept Abschnitt 2.2/3.4/6).
// ---------------------------------------------------------------------------

export type AddFoodEntryInput = {
  foodId: string;
  amountG: number;
  mealSlot: MealSlot;
  loggedDate: string;
};

/**
 * Mahlzeit-Eintrag aus dem Katalog (Picker-Auswahl oder manueller
 * Schnelleintrag, siehe addManualFoodEntry unten) — berechnet den
 * Nährwert-Snapshot aus dem LOKAL vorhandenen `foods`-Eintrag × Menge und
 * friert ihn auf food_entries ein. `foodId` muss lokal existieren (bei
 * Katalog-Treffern durch searchFoodsOnline/Sync-Pull sichergestellt, bei
 * eigenen Lebensmitteln durch createCustomFood).
 */
export async function addFoodEntry(input: AddFoodEntryInput): Promise<FoodEntry> {
  const userId = await requireOwnerUserId();

  const foodRow = (await db.select().from(foods).where(eq(foods.id, input.foodId)).limit(1))[0];
  if (!foodRow) {
    throw new Error('Lebensmittel nicht gefunden — bitte erneut suchen.');
  }

  const snapshot = computeSnapshot(foodRow, input.amountG);
  const now = Date.now();

  const parsed = foodEntryCreateSchema.parse({
    entryType: 'food',
    foodId: input.foodId,
    loggedDate: input.loggedDate,
    mealSlot: input.mealSlot,
    amountG: input.amountG,
    kcal: snapshot.kcal,
    proteinG: snapshot.proteinG ?? undefined,
    carbsG: snapshot.carbsG ?? undefined,
    fatG: snapshot.fatG ?? undefined,
    loggedAt: now,
  });

  const [row] = await db
    .insert(foodEntries)
    .values({
      id: parsed.id ?? newId(),
      userId,
      entryType: 'food',
      foodId: input.foodId,
      loggedDate: parsed.loggedDate,
      mealSlot: parsed.mealSlot ?? null,
      amountG: parsed.amountG ?? null,
      amountMl: null,
      kcal: parsed.kcal ?? null,
      proteinG: parsed.proteinG ?? null,
      carbsG: parsed.carbsG ?? null,
      fatG: parsed.fatG ?? null,
      loggedAt: parsed.loggedAt,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  queueSyncPush();
  return row;
}

export type ManualFoodEntryInput = {
  name: string;
  kcal: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  mealSlot: MealSlot;
  loggedDate: string;
};

/**
 * Manueller Schnelleintrag (Konzept Abschnitt 3.4/6): Fallback ohne
 * Katalog-Treffer/offline. Das Konzept beschreibt dafür `foodId = null` mit
 * frei eingegebenen kcal/Makros direkt auf food_entries — `food_entries` hat
 * laut committetem Schema (packages/shared/src/db/schema.ts) aber KEIN
 * Namensfeld, ein foodId=null-Eintrag könnte den eingegebenen Namen also
 * nirgends dauerhaft anzeigen (auch nicht nach einem Neustart). Deshalb legt
 * dieser Pfad — wie "eigene Übung anlegen" bei Übungen ohne Treffer — eine
 * eigene `foods`-Zeile an (source 'custom') und referenziert sie ganz normal
 * per foodId; die 100g-Referenzmenge entspricht dabei exakt der eingegebenen
 * Portion (amountG=100 → computeSnapshot liefert 1:1 die eingegebenen Werte).
 * Funktional identisch zum Konzept (kein Katalog-Treffer nötig, komplett
 * offline-fähig), nur dass der Name dauerhaft sichtbar bleibt.
 */
export async function addManualFoodEntry(input: ManualFoodEntryInput): Promise<FoodEntry> {
  const food = await createCustomFood({
    name: input.name,
    kcalPer100: input.kcal,
    proteinPer100: input.proteinG,
    carbsPer100: input.carbsG,
    fatPer100: input.fatG,
  });

  return addFoodEntry({
    foodId: food.id,
    amountG: 100,
    mealSlot: input.mealSlot,
    loggedDate: input.loggedDate,
  });
}

export type FoodEntryPatch = {
  amountG?: number;
  mealSlot?: MealSlot;
  loggedDate?: string;
};

/**
 * Partielles Update eines Mahlzeit-Eintrags. Ändert sich `amountG` UND ist
 * der Eintrag an ein lokal vorhandenes Lebensmittel gebunden, wird der
 * Nährwert-Snapshot neu aus food × neue Menge berechnet (Snapshot-Stabilität
 * bleibt gewahrt: nur eine EXPLIZITE Mengen-Änderung löst eine Neuberechnung
 * aus, kein automatisches Nachziehen bei Änderungen am foods-Cache-Eintrag).
 */
export async function updateFoodEntry(id: string, patch: FoodEntryPatch): Promise<FoodEntry | undefined> {
  const existing = (await db.select().from(foodEntries).where(eq(foodEntries.id, id)).limit(1))[0];
  if (!existing) return undefined;

  let snapshot: NutrientSnapshot | null = null;
  if (patch.amountG !== undefined && existing.foodId) {
    const foodRow = (await db.select().from(foods).where(eq(foods.id, existing.foodId)).limit(1))[0];
    if (foodRow) snapshot = computeSnapshot(foodRow, patch.amountG);
  }

  const parsed = foodEntryUpdateSchema.parse({
    amountG: patch.amountG,
    mealSlot: patch.mealSlot,
    loggedDate: patch.loggedDate,
    kcal: snapshot?.kcal,
    proteinG: snapshot?.proteinG ?? undefined,
    carbsG: snapshot?.carbsG ?? undefined,
    fatG: snapshot?.fatG ?? undefined,
  });

  const [row] = await db
    .update(foodEntries)
    .set({
      amountG: parsed.amountG ?? existing.amountG,
      mealSlot: parsed.mealSlot ?? existing.mealSlot,
      loggedDate: parsed.loggedDate ?? existing.loggedDate,
      kcal: parsed.kcal ?? existing.kcal,
      proteinG: parsed.proteinG ?? existing.proteinG,
      carbsG: parsed.carbsG ?? existing.carbsG,
      fatG: parsed.fatG ?? existing.fatG,
      updatedAt: Date.now(),
    })
    .where(eq(foodEntries.id, id))
    .returning();

  queueSyncPush();
  return row;
}

/** Soft-Delete eines Tagebuch-Eintrags (Mahlzeit ODER Wasser). */
export async function deleteFoodEntry(id: string): Promise<void> {
  await db.update(foodEntries).set({ deleted: true, updatedAt: Date.now() }).where(eq(foodEntries.id, id));
  queueSyncPush();
}

// ---------------------------------------------------------------------------
// Tagebuch — Wasser (Konzept Abschnitt 2.2/6): eigener entryType statt eigener
// Tabelle. `amountMl` ist laut Validierungsschema (foodEntryFieldsSchema)
// strikt positiv — der "-250 ml"-Schritt des Steppers löscht deshalb den
// zuletzt erfassten Wasser-Eintrag DES TAGES (LIFO-Undo), statt einen
// negativen Betrag zu speichern.
// ---------------------------------------------------------------------------

/** Fügt einen Wasser-Eintrag hinzu (Stepper "+250 ml" o. ä.). */
export async function addWaterEntry(loggedDate: string, amountMl: number): Promise<FoodEntry> {
  const userId = await requireOwnerUserId();
  const now = Date.now();

  const parsed = foodEntryCreateSchema.parse({
    entryType: 'water',
    loggedDate,
    amountMl,
    loggedAt: now,
  });

  const [row] = await db
    .insert(foodEntries)
    .values({
      id: parsed.id ?? newId(),
      userId,
      entryType: 'water',
      foodId: null,
      loggedDate: parsed.loggedDate,
      mealSlot: null,
      amountG: null,
      amountMl: parsed.amountMl ?? amountMl,
      kcal: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
      loggedAt: parsed.loggedAt,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  queueSyncPush();
  return row;
}

/** Entfernt den zuletzt erfassten Wasser-Eintrag des Tages (Stepper "-250 ml"); No-Op, falls keiner existiert. */
export async function removeLastWaterEntry(loggedDate: string): Promise<void> {
  const userId = await requireOwnerUserId();

  const row = (
    await db
      .select({ id: foodEntries.id })
      .from(foodEntries)
      .where(
        and(
          eq(foodEntries.userId, userId),
          eq(foodEntries.entryType, 'water'),
          eq(foodEntries.loggedDate, loggedDate),
          eq(foodEntries.deleted, false),
        ),
      )
      .orderBy(desc(foodEntries.loggedAt))
      .limit(1)
  )[0];

  if (!row) return;
  await deleteFoodEntry(row.id);
}

// ---------------------------------------------------------------------------
// Lese-Queries (Query-Builder, NICHT ausgeführt) — für useLiveQuery, Muster
// wie src/data/plans.ts. Basistabelle bleibt `food_entries` (useLiveQuery
// reagiert nur auf die FROM-Basistabelle) — der Join auf `foods` liefert nur
// das Anzeige-Label und löst selbst keine Reaktivität aus (Lebensmittelnamen
// ändern sich praktisch nie nachträglich, akzeptierter Kompromiss wie bei
// buildPlanExercisesQuery).
// ---------------------------------------------------------------------------

export type DayEntryRow = {
  id: string;
  entryType: 'food' | 'water';
  foodId: string | null;
  loggedDate: string;
  mealSlot: MealSlot | null;
  amountG: number | null;
  amountMl: number | null;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  loggedAt: number;
  foodName: string | null;
  foodBrand: string | null;
};

/** Alle (nicht gelöschten) Tagebuch-Einträge eines Tages, älteste zuerst — Tagesansicht (Konzept Abschnitt 6). */
export function buildDayEntriesQuery(ownerUserId: string, loggedDate: string) {
  return db
    .select({
      id: foodEntries.id,
      entryType: foodEntries.entryType,
      foodId: foodEntries.foodId,
      loggedDate: foodEntries.loggedDate,
      mealSlot: foodEntries.mealSlot,
      amountG: foodEntries.amountG,
      amountMl: foodEntries.amountMl,
      kcal: foodEntries.kcal,
      proteinG: foodEntries.proteinG,
      carbsG: foodEntries.carbsG,
      fatG: foodEntries.fatG,
      loggedAt: foodEntries.loggedAt,
      foodName: foods.name,
      foodBrand: foods.brand,
    })
    .from(foodEntries)
    .leftJoin(foods, eq(foods.id, foodEntries.foodId))
    .where(
      and(
        eq(foodEntries.userId, ownerUserId),
        eq(foodEntries.loggedDate, loggedDate),
        eq(foodEntries.deleted, false),
      ),
    )
    .orderBy(asc(foodEntries.loggedAt));
}

// ---------------------------------------------------------------------------
// Ernährungsziele (Konzept Abschnitt 2.3): eigene, anfügende History-Tabelle —
// "verwende immer das neueste, nicht gelöschte Ziel" reicht für V1.
// ---------------------------------------------------------------------------

export type SetNutritionGoalInput = {
  kcalTarget: number;
  proteinTargetG?: number;
  carbsTargetG?: number;
  fatTargetG?: number;
  waterTargetMl?: number;
};

/** Legt ein neues Ernährungsziel an (effectiveFrom = heute) — ändert keine bestehenden Ziele (History bleibt erhalten). */
export async function setNutritionGoal(input: SetNutritionGoalInput): Promise<NutritionGoal> {
  const userId = await requireOwnerUserId();
  const parsed = nutritionGoalCreateSchema.parse({ ...input, effectiveFrom: todayIsoDate() });
  const now = Date.now();

  const [row] = await db
    .insert(nutritionGoals)
    .values({
      id: parsed.id ?? newId(),
      userId,
      effectiveFrom: parsed.effectiveFrom,
      kcalTarget: parsed.kcalTarget,
      proteinTargetG: parsed.proteinTargetG ?? null,
      carbsTargetG: parsed.carbsTargetG ?? null,
      fatTargetG: parsed.fatTargetG ?? null,
      waterTargetMl: parsed.waterTargetMl ?? null,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  queueSyncPush();
  return row;
}

/** Neuestes, nicht gelöschtes Ernährungsziel (V1: kein Blick auf effectiveFrom nötig, siehe Konzept 2.3). */
export function buildLatestGoalQuery(ownerUserId: string) {
  return db
    .select()
    .from(nutritionGoals)
    .where(and(eq(nutritionGoals.userId, ownerUserId), eq(nutritionGoals.deleted, false)))
    .orderBy(desc(nutritionGoals.createdAt))
    .limit(1);
}
