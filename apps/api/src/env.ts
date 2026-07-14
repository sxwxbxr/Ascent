/**
 * Cloudflare-Bindings des Workers, wie in wrangler.jsonc deklariert.
 * Wird als `Bindings` Generic an die Hono-App übergeben (siehe src/index.ts).
 */
export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
};
