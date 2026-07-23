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
  /**
   * Kontaktangabe für den bei Open-Food-Facts-Aufrufen zwingend vorgeschriebenen
   * User-Agent-Header (docs/KONZEPT_Ernaehrung.md, Abschnitt 3.1: Format
   * "AppName/Version (Kontakt-E-Mail)"). Siehe apps/api/src/routes/foods.ts.
   */
  OFF_USER_AGENT_CONTACT: string;
};
