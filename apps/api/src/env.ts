/**
 * Cloudflare-Bindings des Workers, wie in wrangler.jsonc deklariert.
 * Wird als `Bindings` Generic an die Hono-App übergeben (siehe src/index.ts).
 */
export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  /** Signierschlüssel für Better-Auth-Sessions/Tokens (Secret, via `wrangler secret put`). */
  BETTER_AUTH_SECRET: string;
  /** Öffentliche Basis-URL des Workers, von Better Auth für Callback-/Reset-Links genutzt. */
  BETTER_AUTH_URL: string;
};
