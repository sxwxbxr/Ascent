import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { Bindings } from '../env';
import { mediaRouter } from './media';

function buildApp() {
  const app = new Hono<{ Bindings: Bindings }>();
  app.route('/media', mediaRouter);
  return app;
}

describe('mediaRouter', () => {
  it('liefert ein vorhandenes Objekt mit Content-Type, Cache-Control und ETag', async () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    await env.MEDIA.put('exercises/0001.gif', bytes, {
      httpMetadata: { contentType: 'image/gif' },
    });

    const res = await buildApp().request('/media/exercises/0001.gif', {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/gif');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('ETag')).toBeTruthy();
    expect(res.headers.get('Content-Length')).toBe('6');

    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual(Array.from(bytes));
  });

  it('liefert 304 ohne Body, wenn If-None-Match mit dem ETag übereinstimmt', async () => {
    await env.MEDIA.put('exercises/0002.gif', 'gif-inhalt', {
      httpMetadata: { contentType: 'image/gif' },
    });
    const app = buildApp();

    const first = await app.request('/media/exercises/0002.gif', {}, env);
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();

    const second = await app.request(
      '/media/exercises/0002.gif',
      { headers: { 'If-None-Match': etag ?? '' } },
      env,
    );

    expect(second.status).toBe(304);
    expect(second.headers.get('ETag')).toBe(etag);
    expect(second.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect((await second.arrayBuffer()).byteLength).toBe(0);
  });

  it('liefert 404 für einen unbekannten Key', async () => {
    const res = await buildApp().request('/media/exercises/nicht-vorhanden.gif', {}, env);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Nicht gefunden');
  });

  it('leitet den Content-Type aus der Dateiendung ab, wenn httpMetadata fehlt', async () => {
    // put() ohne httpMetadata → R2 kennt keinen Content-Type, die Route muss
    // ihn selbst aus der Endung ableiten.
    await env.MEDIA.put('exercises/0003.png', 'png-inhalt');

    const res = await buildApp().request('/media/exercises/0003.png', {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('unterstützt verschachtelte Keys', async () => {
    await env.MEDIA.put('exercises/thumbnails/0001-thumb.jpg', 'jpg-inhalt', {
      httpMetadata: { contentType: 'image/jpeg' },
    });

    const res = await buildApp().request('/media/exercises/thumbnails/0001-thumb.jpg', {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
  });
});
