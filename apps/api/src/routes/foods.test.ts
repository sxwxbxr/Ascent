import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { foods, users } from '@ascent/shared';

import type { AuthEnv, AuthUser } from '../middleware/auth';
import { foodsRouter } from './foods';
import { syncRouter } from './sync';

function buildApp(user: AuthUser) {
  const app = new Hono<AuthEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/foods', foodsRouter);
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

async function createGlobalFood(overrides: {
  name: string;
  brand?: string;
  barcode?: string;
  kcalPer100?: number;
  source?: 'off' | 'custom';
}): Promise<string> {
  const db = drizzle(env.DB);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(foods).values({
    id,
    userId: null,
    barcode: overrides.barcode,
    name: overrides.name,
    brand: overrides.brand,
    kcalPer100: overrides.kcalPer100 ?? 100,
    source: overrides.source ?? 'off',
    createdAt: now,
    updatedAt: now,
    deleted: false,
  });
  return id;
}

function jsonRequest(method: string, body: unknown) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Minimales, aber vollständiges OFF-Produkt für Mocks (Konzept Abschnitt 3.3). */
function offProduct(overrides: {
  code?: string;
  product_name?: string;
  brands?: string;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  serving_quantity?: number;
}) {
  return {
    code: overrides.code,
    product_name: overrides.product_name ?? 'Test-Produkt',
    brands: overrides.brands,
    serving_quantity: overrides.serving_quantity,
    nutriments: {
      'energy-kcal_100g': overrides.kcal ?? 250,
      proteins_100g: overrides.protein,
      carbohydrates_100g: overrides.carbs,
      fat_100g: overrides.fat,
    },
  };
}

describe('foodsRouter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('GET /foods', () => {
    it('listet globale und eigene Lebensmittel, aber nicht die eines anderen Nutzers (kein OFF-Call ohne q)', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const user = await createUser();
      const other = await createUser();
      await createGlobalFood({ name: 'Globaler Apfel', kcalPer100: 52 });
      const app = buildApp(user);

      await app.request('/foods', jsonRequest('POST', { name: 'Eigenes Gericht', kcalPer100: 300 }), env);
      await buildApp(other).request('/foods', jsonRequest('POST', { name: 'Fremdes Gericht', kcalPer100: 400 }), env);

      const res = await app.request('/foods', {}, env);
      expect(res.status).toBe(200);
      const list = (await res.json()) as Array<{ name: string }>;
      const names = list.map((f) => f.name);
      expect(names).toContain('Globaler Apfel');
      expect(names).toContain('Eigenes Gericht');
      expect(names).not.toContain('Fremdes Gericht');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('?q durchsucht name UND brand case-insensitive, rein lokal bei genug Treffern', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const user = await createUser();
      for (let i = 0; i < 6; i += 1) {
        await createGlobalFood({ name: `Protein Riegel ${i}`, brand: 'Marke X' });
      }
      await createGlobalFood({ name: 'Banane' });

      const res = await buildApp(user).request('/foods?q=riegel', {}, env);
      const body = (await res.json()) as Array<{ name: string }>;
      expect(body.map((f) => f.name)).toHaveLength(6);
      // 6 lokale Treffer >= Schwellwert -> kein Live-OFF-Aufruf nötig.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('ruft bei dünnen lokalen Treffern und ausreichend langem q die OFF-Suche auf und upserted global', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          products: [offProduct({ code: '1234567890123', product_name: 'Hafermilch', brands: 'Hafi', kcal: 45 })],
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const user = await createUser();
      const res = await buildApp(user).request('/foods?q=hafermilch', {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ name: string; source: string; userId: string | null; kcalPer100: number }>;
      const found = body.find((f) => f.name === 'Hafermilch');
      expect(found).toBeDefined();
      expect(found?.source).toBe('off');
      expect(found?.userId).toBeNull();
      expect(found?.kcalPer100).toBe(45);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('api/v2/search');
      expect(url).toContain('search_terms=hafermilch');
      const headers = new Headers(init.headers);
      expect(headers.get('User-Agent')).toMatch(/^Ascent\/.+\(.+\)$/);

      const db = drizzle(env.DB);
      const rows = await db.select().from(foods).where(eq(foods.barcode, '1234567890123'));
      expect(rows).toHaveLength(1);
    });

    it('aktualisiert eine bestehende OFF-Zeile per Barcode statt sie zu duplizieren', async () => {
      const barcode = '9999999999999';
      await createGlobalFood({ name: 'Alter Name', barcode, kcalPer100: 10, source: 'off' });

      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          products: [offProduct({ code: barcode, product_name: 'Neuer Name', kcal: 99 })],
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const user = await createUser();
      await buildApp(user).request('/foods?q=neuername', {}, env);

      const db = drizzle(env.DB);
      const rows = await db.select().from(foods).where(eq(foods.barcode, barcode));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe('Neuer Name');
      expect(rows[0]?.kcalPer100).toBe(99);
    });

    it('unterlässt den OFF-Call bei zu kurzem q', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const user = await createUser();
      await buildApp(user).request('/foods?q=a', {}, env);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fällt bei OFF-Fehler/Timeout sauber auf die lokalen Treffer zurück', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('Netzwerkfehler'));
      vi.stubGlobal('fetch', fetchMock);

      const user = await createUser();
      await createGlobalFood({ name: 'Bekannter Riegel' });

      const res = await buildApp(user).request('/foods?q=riegel', {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ name: string }>;
      expect(body.map((f) => f.name)).toContain('Bekannter Riegel');
    });
  });

  describe('GET /foods/barcode/:code', () => {
    it('liefert einen Cache-Treffer ohne OFF-Aufruf', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await createGlobalFood({ name: 'Gecachtes Produkt', barcode: '111' });
      const user = await createUser();

      const res = await buildApp(user).request('/foods/barcode/111', {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string };
      expect(body.name).toBe('Gecachtes Produkt');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('lädt bei Cache-Miss live von OFF, mapped und upserted global', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          product: offProduct({ product_name: 'Müsliriegel', brands: 'Knusper, Marke', kcal: 400, protein: 8, carbs: 60, fat: 12 }),
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const user = await createUser();
      const res = await buildApp(user).request('/foods/barcode/222', {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        name: string;
        barcode: string;
        brand: string;
        kcalPer100: number;
        proteinPer100: number;
        carbsPer100: number;
        fatPer100: number;
        userId: string | null;
        source: string;
      };
      expect(body.name).toBe('Müsliriegel');
      expect(body.barcode).toBe('222');
      expect(body.brand).toBe('Knusper');
      expect(body.kcalPer100).toBe(400);
      expect(body.proteinPer100).toBe(8);
      expect(body.carbsPer100).toBe(60);
      expect(body.fatPer100).toBe(12);
      expect(body.userId).toBeNull();
      expect(body.source).toBe('off');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://world.openfoodfacts.org/api/v3/product/222.json');
      const headers = new Headers(init.headers);
      expect(headers.get('User-Agent')).toMatch(/^Ascent\/.+\(.+\)$/);
    });

    it('liefert 404 bei OFF-Miss (kein Produkt)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ product: null }, 404)));
      const user = await createUser();
      const res = await buildApp(user).request('/foods/barcode/unbekannt', {}, env);
      expect(res.status).toBe(404);
    });

    it('liefert 404 bei OFF-Netzwerkfehler', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')));
      const user = await createUser();
      const res = await buildApp(user).request('/foods/barcode/999', {}, env);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /foods', () => {
    it('legt ein eigenes Lebensmittel an (userId = user.id, source custom)', async () => {
      const user = await createUser();
      const res = await buildApp(user).request(
        '/foods',
        jsonRequest('POST', { name: 'Eigener Shake', kcalPer100: 120 }),
        env,
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { userId: string; source: string };
      expect(body.userId).toBe(user.id);
      expect(body.source).toBe('custom');
    });

    it('liefert 400 bei ungültigem Body (negatives kcalPer100)', async () => {
      const user = await createUser();
      const res = await buildApp(user).request(
        '/foods',
        jsonRequest('POST', { name: 'Kaputt', kcalPer100: -5 }),
        env,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('PUT/DELETE /foods/:id', () => {
    it('erlaubt das Ändern des eigenen Lebensmittels', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const createRes = await app.request('/foods', jsonRequest('POST', { name: 'Alt', kcalPer100: 100 }), env);
      const created = (await createRes.json()) as { id: string };

      const res = await app.request(`/foods/${created.id}`, jsonRequest('PUT', { name: 'Neu', kcalPer100: 150 }), env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string; kcalPer100: number };
      expect(body.name).toBe('Neu');
      expect(body.kcalPer100).toBe(150);
    });

    it('liefert 404 beim Ändern/Löschen eines globalen Lebensmittels', async () => {
      const globalId = await createGlobalFood({ name: 'Global' });
      const user = await createUser();

      const putRes = await buildApp(user).request(`/foods/${globalId}`, jsonRequest('PUT', { name: 'X' }), env);
      expect(putRes.status).toBe(404);

      const delRes = await buildApp(user).request(`/foods/${globalId}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(404);
    });

    it('liefert 404 beim Ändern/Löschen des Lebensmittels eines anderen Nutzers', async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const createRes = await buildApp(owner).request(
        '/foods',
        jsonRequest('POST', { name: 'Fremd', kcalPer100: 100 }),
        env,
      );
      const created = (await createRes.json()) as { id: string };

      const putRes = await buildApp(intruder).request(`/foods/${created.id}`, jsonRequest('PUT', { name: 'X' }), env);
      expect(putRes.status).toBe(404);

      const delRes = await buildApp(intruder).request(`/foods/${created.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(404);
    });

    it('Soft-Delete: eigenes Lebensmittel verschwindet aus GET /, Zeile bleibt mit deleted=1', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const createRes = await app.request('/foods', jsonRequest('POST', { name: 'Zu löschen', kcalPer100: 100 }), env);
      const created = (await createRes.json()) as { id: string };

      const delRes = await app.request(`/foods/${created.id}`, { method: 'DELETE' }, env);
      expect(delRes.status).toBe(204);

      const listRes = await app.request('/foods', {}, env);
      const list = (await listRes.json()) as Array<{ id: string }>;
      expect(list.find((f) => f.id === created.id)).toBeUndefined();

      const db = drizzle(env.DB);
      const rows = await db.select().from(foods).where(eq(foods.id, created.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.deleted).toBe(true);
    });
  });

  describe('Sync-Roundtrip (foods)', () => {
    it('pusht eine eigene Zeile (applied) und liefert sie beim Pull zurück', async () => {
      const user = await createUser();
      const app = buildApp(user);
      const id = crypto.randomUUID();
      const now = Date.now();

      const pushRes = await app.request(
        '/sync/push',
        jsonRequest('POST', {
          tables: {
            foods: [
              {
                id,
                name: 'Sync-Lebensmittel',
                kcalPer100: 200,
                source: 'custom',
                createdAt: now,
                updatedAt: now,
                deleted: false,
              },
            ],
          },
        }),
        env,
      );
      const pushBody = (await pushRes.json()) as { tables: { foods: { applied: number; skipped: number; rejected: number } } };
      expect(pushBody.tables.foods).toEqual({ applied: 1, skipped: 0, rejected: 0 });

      const pullRes = await app.request('/sync/pull', jsonRequest('POST', { since: {} }), env);
      const pullBody = (await pullRes.json()) as { tables: { foods: Array<{ id: string; userId: string }> } };
      const found = pullBody.tables.foods.find((f) => f.id === id);
      expect(found).toBeDefined();
      expect(found?.userId).toBe(user.id);
    });

    it('lehnt das Überschreiben einer globalen (OFF-)Zeile per Push ab, zeigt sie aber weiterhin im Pull', async () => {
      const globalId = await createGlobalFood({ name: 'Globales Original', kcalPer100: 50 });
      const user = await createUser();
      const app = buildApp(user);
      const now = Date.now();

      const pushRes = await app.request(
        '/sync/push',
        jsonRequest('POST', {
          tables: {
            foods: [
              { id: globalId, name: 'Gehackt', kcalPer100: 999, source: 'off', createdAt: now, updatedAt: now + 1000, deleted: false },
            ],
          },
        }),
        env,
      );
      const pushBody = (await pushRes.json()) as { tables: { foods: { applied: number; skipped: number; rejected: number } } };
      expect(pushBody.tables.foods).toEqual({ applied: 0, skipped: 0, rejected: 1 });

      const pullRes = await app.request('/sync/pull', jsonRequest('POST', { since: {} }), env);
      const pullBody = (await pullRes.json()) as { tables: { foods: Array<{ id: string; name: string; userId: string | null }> } };
      const found = pullBody.tables.foods.find((f) => f.id === globalId);
      expect(found?.name).toBe('Globales Original');
      expect(found?.userId).toBeNull();
    });
  });
});
