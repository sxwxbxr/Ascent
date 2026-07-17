import { Hono } from 'hono';

import type { Bindings } from '../env';

/**
 * Öffentliche Medien-Route für R2-Objekte (M2): Übungs-GIFs/-Thumbnails
 * (`exercises/0001.gif`, `exercises/0001.jpg`) und später APK-Downloads.
 * BEWUSST OHNE Auth — wird als `<img src="…">`/RN-`Image` ohne Header
 * eingebunden und muss daher öffentlich abrufbar sein. Wird VOR dem
 * `requireAuth`-Block gemountet (siehe apps/api/src/index.ts):
 *
 * ```ts
 * app.route('/media', mediaRouter);
 * ```
 */
export const mediaRouter = new Hono<{ Bindings: Bindings }>();

/** Dateiendung → Content-Type, falls das R2-Objekt keine httpMetadata trägt. */
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  apk: 'application/vnd.android.package-archive',
};

/** Fällt auf application/octet-stream zurück, falls die Endung unbekannt/fehlend ist. */
function guessContentType(key: string): string {
  const dotIndex = key.lastIndexOf('.');
  if (dotIndex === -1) return 'application/octet-stream';
  const extension = key.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * Normalisiert den Key: führenden Slash entfernen, leeren Key oder Keys mit
 * '..' ablehnen (Defense in depth — R2-Keys sind flach, daher keine echte
 * Path-Traversal-Gefahr, aber wir wollen so etwas trotzdem nie an R2 durchreichen).
 */
function normalizeKey(rawKey: string): string | null {
  const key = rawKey.startsWith('/') ? rawKey.slice(1) : rawKey;
  if (key.length === 0 || key.includes('..')) return null;
  return key;
}

/** Prüft den If-None-Match-Header (kommagetrennte Liste möglich) gegen das ETag des Objekts. */
function ifNoneMatchHits(header: string, etag: string): boolean {
  return header.split(',').some((tag) => {
    const trimmed = tag.trim();
    return trimmed === '*' || trimmed === etag;
  });
}

// Leerer Key (z. B. GET /media selbst) → 404, statt gegen R2 mit key='' zu fragen.
mediaRouter.get('/', (c) => c.json({ error: 'Nicht gefunden' }, 404));

// Mehrsegmentige Keys (z. B. exercises/0001.gif) erfordern das Hono-Pattern
// `:key{.+}` — der reguläre `:key`-Platzhalter matcht nur ein Segment ohne
// Slash (Default-Regexp `[^/]+`). Verifiziert gegen die installierte
// hono@4.12-.d.ts/Quellcode: node_modules/hono/dist/utils/url.js
// (`getPattern`) und node_modules/hono/dist/router/reg-exp-router/node.js
// (`token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/)`) — der Teil in `{…}` wird als
// Regexp für das gesamte restliche Pfadsegment inkl. Slashes verwendet.
// Achtung: `{.*}` (leer erlaubt) ist für benannte Parameter nicht zulässig
// und wirft beim Routenaufbau einen PATH_ERROR — daher `.+` plus die
// separate `/`-Route oben für den leeren Fall.
mediaRouter.get('/:key{.+}', async (c) => {
  const key = normalizeKey(c.req.param('key'));
  if (key === null) return c.json({ error: 'Nicht gefunden' }, 404);

  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.json({ error: 'Nicht gefunden' }, 404);

  const contentType = obj.httpMetadata?.contentType ?? guessContentType(key);
  c.header('Content-Type', contentType);
  c.header('Content-Length', String(obj.size));
  c.header('ETag', obj.httpEtag);
  // Medien-Keys sind versionslos-stabil (Übungs-GIFs ändern sich nie) —
  // daher aggressives, unveränderliches Caching.
  c.header('Cache-Control', 'public, max-age=31536000, immutable');

  const ifNoneMatch = c.req.header('If-None-Match');
  if (ifNoneMatch && ifNoneMatchHits(ifNoneMatch, obj.httpEtag)) {
    return c.body(null, 304);
  }

  // Kein Range-Support (bewusst): Übungs-GIFs/-Thumbnails sind klein genug,
  // dass Teil-Downloads nicht nötig sind. Für grosse APK-Dateien (M6) kann
  // Range-Handling über R2GetOptions.range bei Bedarf nachgerüstet werden.
  return c.body(obj.body, 200);
});
