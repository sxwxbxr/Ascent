import { and, asc, eq, isNull, like, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { foodCreateSchema, foodUpdateSchema, foods } from '@ascent/shared';

import type { AuthEnv } from '../middleware/auth';
import { notFound, parseBody, parsePagination } from './helpers';

/**
 * Router für die Lebensmitteldatenbank (docs/KONZEPT_Ernaehrung.md, Abschnitt
 * 3): globaler Open-Food-Facts-Cache (userId = null) + eigene Lebensmittel
 * (userId gesetzt, source 'custom') teilen sich dieselbe Tabelle — analog zu
 * `exercises.ts`. Wird ohne eigene Auth-Middleware exportiert — der
 * Orchestrator mountet `requireAuth` zentral davor (siehe apps/api/src/index.ts).
 */
export const foodsRouter = new Hono<AuthEnv>();

/** Fallback-Kontakt für den OFF-User-Agent, falls die Env-Var fehlt (z. B. in Tests). */
const DEFAULT_OFF_CONTACT = 'https://github.com/sxwxbxr/Ascent';

/** App-Version im OFF-User-Agent — hält sich an den /version-Stub in index.ts. */
const OFF_APP_VERSION = '0.1.0';

/** Timeout für OFF-Calls: lieber sauber auf lokale Treffer zurückfallen als lange hängen. */
const OFF_FETCH_TIMEOUT_MS = 5000;

/** Ab wie vielen lokalen Treffern KEIN Live-OFF-Suchaufruf mehr ausgelöst wird. */
const OFF_SEARCH_RESULT_THRESHOLD = 5;

/** Mindestlänge der Sucheingabe, ab der ein Live-OFF-Suchaufruf überhaupt sinnvoll ist. */
const MIN_OFF_QUERY_LENGTH = 2;

function offHeaders(contact: string): HeadersInit {
  return {
    'User-Agent': `Ascent/${OFF_APP_VERSION} (${contact})`,
    Accept: 'application/json',
  };
}

/** fetch mit Timeout — OFF-Ausfälle/Hänger dürfen den eigenen Request nie blockieren. */
async function fetchWithTimeout(url: string, contact: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OFF_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: offHeaders(contact), signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Rohform eines OFF-Produkts (nur die für uns relevanten Felder). */
type OffProduct = {
  code?: string;
  product_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: Record<string, number | string | undefined>;
};

/** Auf unser Schema gemapptes OFF-Produkt (vor dem Upsert). */
type MappedOffFood = {
  barcode: string | null;
  name: string;
  brand: string | null;
  kcalPer100: number;
  proteinPer100: number | null;
  carbsPer100: number | null;
  fatPer100: number | null;
  servingSizeG: number | null;
};

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Extrahiert die führende Zahl aus einem Text wie "30 g" (Fallback, falls serving_quantity fehlt). */
function parseLeadingNumber(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = /^([\d.,]+)/.exec(text.trim());
  if (!match?.[1]) return undefined;
  return toFiniteNumber(match[1].replace(',', '.'));
}

/**
 * Mapping OFF-Produkt -> unser Schema (Konzept Abschnitt 3.3). `kcalPer100`
 * ist bei uns NOT NULL — Produkte ohne verwertbaren kcal-Wert oder ohne Namen
 * werden verworfen (null), damit sie erst gar nicht in `foods` landen.
 */
function mapOffProduct(product: OffProduct): MappedOffFood | null {
  const name = product.product_name?.trim();
  if (!name) return null;

  const nutriments = product.nutriments ?? {};
  const kcalPer100 = toFiniteNumber(nutriments['energy-kcal_100g']);
  if (kcalPer100 === undefined) return null;

  const servingSizeG = toFiniteNumber(product.serving_quantity) ?? parseLeadingNumber(product.serving_size);

  return {
    barcode: product.code?.trim() || null,
    name,
    brand: product.brands?.split(',')[0]?.trim() || null,
    kcalPer100,
    proteinPer100: toFiniteNumber(nutriments.proteins_100g) ?? null,
    carbsPer100: toFiniteNumber(nutriments.carbohydrates_100g) ?? null,
    fatPer100: toFiniteNumber(nutriments.fat_100g) ?? null,
    servingSizeG: servingSizeG ?? null,
  };
}

/**
 * Strukturierte OFF-Suche (Konzept Abschnitt 3.1/3.3): `GET /api/v2/search`.
 * Fehler/Timeout werden abgefangen — die Suche fällt dann auf die lokalen
 * Treffer zurück, kein Fehler an den Client.
 */
async function searchOff(query: string, contact: string): Promise<MappedOffFood[]> {
  const url =
    'https://world.openfoodfacts.org/api/v2/search' +
    `?search_terms=${encodeURIComponent(query)}` +
    '&page_size=20&json=1&fields=code,product_name,brands,nutriments,serving_size,serving_quantity';

  try {
    const res = await fetchWithTimeout(url, contact);
    if (!res.ok) return [];
    const data = (await res.json()) as { products?: OffProduct[] };
    const mapped = (data.products ?? []).map(mapOffProduct);
    return mapped.filter((food): food is MappedOffFood => food !== null);
  } catch {
    return [];
  }
}

/**
 * Barcode-Lookup (Konzept Abschnitt 3.1/3.3): `GET /api/v3/product/{code}.json`.
 * Liefert null bei Fehler/Timeout/unbekanntem Produkt — der Aufrufer antwortet
 * dann mit 404, der Client fällt auf den manuellen Schnelleintrag zurück.
 */
async function fetchOffProductByBarcode(code: string, contact: string): Promise<MappedOffFood | null> {
  const url = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(code)}.json`;

  try {
    const res = await fetchWithTimeout(url, contact);
    if (!res.ok) return null;
    const data = (await res.json()) as { product?: OffProduct };
    if (!data.product) return null;
    return mapOffProduct({ ...data.product, code: data.product.code ?? code });
  } catch {
    return null;
  }
}

type Db = ReturnType<typeof drizzle>;

/**
 * Legt ein OFF-Produkt als globale Zeile (userId = null, source 'off') an
 * oder aktualisiert eine bestehende — Cache-Refresh bei erneutem Treffer.
 * Matching primär über `barcode` (Cache-Schlüssel laut Konzept); ohne
 * Barcode wird zusätzlich per Name gegen bestehende OFF-Zeilen gematcht, um
 * bei wiederholten Suchen nicht unbegrenzt Duplikate anzulegen.
 */
async function upsertGlobalOffFood(db: Db, mapped: MappedOffFood): Promise<typeof foods.$inferSelect> {
  const matchCondition = mapped.barcode
    ? and(isNull(foods.userId), eq(foods.barcode, mapped.barcode))
    : and(isNull(foods.userId), eq(foods.source, 'off'), sql`lower(${foods.name}) = lower(${mapped.name})`);

  const existing = (await db.select().from(foods).where(matchCondition).limit(1))[0];
  const now = Date.now();

  if (existing) {
    const [updated] = await db
      .update(foods)
      .set({
        name: mapped.name,
        brand: mapped.brand,
        kcalPer100: mapped.kcalPer100,
        proteinPer100: mapped.proteinPer100,
        carbsPer100: mapped.carbsPer100,
        fatPer100: mapped.fatPer100,
        servingSizeG: mapped.servingSizeG,
        offLastFetchedAt: now,
        updatedAt: now,
      })
      .where(eq(foods.id, existing.id))
      .returning();
    // updated ist garantiert vorhanden (WHERE trifft die soeben gelesene id).
    return updated as typeof foods.$inferSelect;
  }

  const [inserted] = await db
    .insert(foods)
    .values({
      id: crypto.randomUUID(),
      userId: null,
      barcode: mapped.barcode,
      name: mapped.name,
      brand: mapped.brand,
      kcalPer100: mapped.kcalPer100,
      proteinPer100: mapped.proteinPer100,
      carbsPer100: mapped.carbsPer100,
      fatPer100: mapped.fatPer100,
      servingSizeG: mapped.servingSizeG,
      source: 'off',
      offLastFetchedAt: now,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();
  return inserted as typeof foods.$inferSelect;
}

/**
 * GET /?q= — lokale Treffer (global + eigene) per LIKE auf name/brand; bei
 * gesetzter, ausreichend langer Suche UND dünnen lokalen Treffern zusätzlich
 * ein Live-OFF-Suchaufruf, dessen Ergebnisse als globale Zeilen upgeserted
 * und mit den Cache-Treffern zusammen zurückgegeben werden (Konzept 3.3).
 */
foodsRouter.get('/', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const { limit, offset } = parsePagination(c);

  const conditions = [eq(foods.deleted, false), or(isNull(foods.userId), eq(foods.userId, user.id))];

  const q = c.req.query('q')?.trim();
  if (q) {
    const pattern = `%${q.toLowerCase()}%`;
    conditions.push(or(like(sql`lower(${foods.name})`, pattern), like(sql`lower(${foods.brand})`, pattern)));
  }

  let rows = await db
    .select()
    .from(foods)
    .where(and(...conditions))
    .orderBy(asc(foods.name))
    .limit(limit)
    .offset(offset);

  if (q && q.length >= MIN_OFF_QUERY_LENGTH && rows.length < OFF_SEARCH_RESULT_THRESHOLD) {
    const contact = c.env.OFF_USER_AGENT_CONTACT || DEFAULT_OFF_CONTACT;
    const offResults = await searchOff(q, contact);
    for (const mapped of offResults) {
      await upsertGlobalOffFood(db, mapped);
    }
    if (offResults.length > 0) {
      // Neu abfragen, damit der Client dieselbe Zeilenform (inkl. id) wie bei reinen Cache-Treffern sieht.
      rows = await db
        .select()
        .from(foods)
        .where(and(...conditions))
        .orderBy(asc(foods.name))
        .limit(limit)
        .offset(offset);
    }
  }

  return c.json(rows);
});

/**
 * GET /barcode/:code — Cache-first per barcode-Spalte (sichtbar: global oder
 * eigen); bei Miss Live-Lookup gegen OFF, Upsert als globale Zeile, sonst 404
 * (Client fällt auf den manuellen Schnelleintrag zurück, Konzept 3.4).
 */
foodsRouter.get('/barcode/:code', async (c) => {
  const user = c.get('user');
  const code = c.req.param('code');
  const db = drizzle(c.env.DB);

  const cached = (
    await db
      .select()
      .from(foods)
      .where(
        and(eq(foods.barcode, code), eq(foods.deleted, false), or(isNull(foods.userId), eq(foods.userId, user.id))),
      )
      .limit(1)
  )[0];
  if (cached) return c.json(cached);

  const contact = c.env.OFF_USER_AGENT_CONTACT || DEFAULT_OFF_CONTACT;
  const mapped = await fetchOffProductByBarcode(code, contact);
  if (!mapped) return notFound(c);

  const row = await upsertGlobalOffFood(db, { ...mapped, barcode: mapped.barcode ?? code });
  return c.json(row);
});

/** POST / — eigenes Lebensmittel anlegen (source 'custom', client-generierte id optional). */
foodsRouter.post('/', async (c) => {
  const user = c.get('user');
  const parsed = await parseBody(c, foodCreateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);
  const now = Date.now();
  const [row] = await db
    .insert(foods)
    .values({
      id: parsed.data.id ?? crypto.randomUUID(),
      userId: user.id,
      barcode: parsed.data.barcode,
      name: parsed.data.name,
      brand: parsed.data.brand,
      kcalPer100: parsed.data.kcalPer100,
      proteinPer100: parsed.data.proteinPer100,
      carbsPer100: parsed.data.carbsPer100,
      fatPer100: parsed.data.fatPer100,
      servingSizeG: parsed.data.servingSizeG,
      source: 'custom',
      createdAt: now,
      updatedAt: now,
      deleted: false,
    })
    .returning();

  return c.json(row, 201);
});

/**
 * PUT /:id — nur für eigene Lebensmittel (globale Zeilen, userId = null,
 * matchen die Ownership-Bedingung nie -> 404 statt 403, kein Existenz-Leak).
 */
foodsRouter.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const parsed = await parseBody(c, foodUpdateSchema);
  if ('error' in parsed) return parsed.error;

  const db = drizzle(c.env.DB);
  const [row] = await db
    .update(foods)
    .set({
      barcode: parsed.data.barcode,
      name: parsed.data.name,
      brand: parsed.data.brand,
      kcalPer100: parsed.data.kcalPer100,
      proteinPer100: parsed.data.proteinPer100,
      carbsPer100: parsed.data.carbsPer100,
      fatPer100: parsed.data.fatPer100,
      servingSizeG: parsed.data.servingSizeG,
      updatedAt: Date.now(),
    })
    .where(and(eq(foods.id, id), eq(foods.userId, user.id), eq(foods.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.json(row);
});

/** DELETE /:id — Soft-Delete, nur für eigene Lebensmittel (global -> 404). */
foodsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = drizzle(c.env.DB);

  const [row] = await db
    .update(foods)
    .set({ deleted: true, updatedAt: Date.now() })
    .where(and(eq(foods.id, id), eq(foods.userId, user.id), eq(foods.deleted, false)))
    .returning();

  if (!row) return notFound(c);
  return c.body(null, 204);
});
