import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { bearer } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { accounts, inviteCodes, rateLimits, sessions, users, verifications } from '@ascent/shared';

import type { Bindings } from '../env';
import { sendMail } from '../mail';

/**
 * Better-Auth-Instanz pro Request statt Modul-Singleton: Cloudflare Workers
 * stellen Bindings (hier: D1 über `env.DB`) erst im Fetch-Kontext bereit, eine
 * einmalig beim Modul-Laden erzeugte Instanz hätte kein gültiges Binding.
 *
 * ENTSCHIEDEN (Nutzer): Registrierung nur mit Invite-Code, Ausnahme ist der
 * allererste Nutzer (Bootstrap) — siehe hooks.before/databaseHooks unten.
 * Passwort-Reset ist vollständig verdrahtet, der Mail-Versand ist aber ein
 * Log-Stub (src/mail.ts) bis ein echter Anbieter (Resend o. Ä.) angebunden ist.
 */
export function createAuth(env: Bindings) {
  // Kein `schema`-Argument an drizzle() nötig: wir nutzen unten nur die
  // Kern-Query-Builder-API (select/update), keine relationale db.query-API.
  const db = drizzle(env.DB);

  // Explizites Schema-Mapping für den Drizzle-Adapter: unsere Tabellennamen
  // (users/sessions/accounts/verifications/rate_limits) statt Better Auths
  // Standardnamen (user/session/account/verification/rateLimit). Siehe
  // https://www.better-auth.com/docs/adapters/drizzle ("Custom Table Name
  // Mapping") — kombiniert mit den `modelName`-Optionen unten pro Tabelle.
  const authSchema = { users, sessions, accounts, verifications, rateLimits };

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    // Muss den Hono-Mount-Punkt spiegeln (siehe index.ts: `/auth/*`, analog zu
    // den bestehenden Top-Level-Routen /health, /entitlements — der Vite-Proxy
    // von apps/web streift das führende /api bereits ab, siehe vite.config.ts).
    // Ohne diesen Override wäre Better Auths Default '/api/auth' inkonsistent
    // mit dem tatsächlichen Mount-Pfad: Rate-Limit-Pfad-Normalisierung und
    // generierte Links (Passwort-Reset-URL) würden dann auf einen falschen
    // Pfad zeigen.
    basePath: '/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],

    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: authSchema,
    }),

    user: {
      modelName: 'users',
      // Better Auths `name`-Feld liegt bei uns in `displayName` (siehe
      // packages/shared/src/db/schema.ts).
      fields: { name: 'displayName' },
      additionalFields: {
        // `input: false`: Clients können tier beim Sign-up nicht selbst setzen
        // (Better Auth ignoriert/überschreibt den Wert dann mit defaultValue,
        // siehe better-auth/dist/db/schema.mjs parseInputData). Wird als Teil
        // des User-Objekts in der Session zurückgegeben (Better-Auth-Doku
        // "Additional Fields": additionalFields sind automatisch Teil des
        // Session-User-Typs).
        tier: {
          type: 'string',
          input: false,
          defaultValue: 'free',
        },
      },
    },
    session: { modelName: 'sessions' },
    account: { modelName: 'accounts' },
    verification: { modelName: 'verifications' },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: 'Ascent: Passwort zurücksetzen',
          text:
            `Hallo ${user.email}\n\n` +
            `Zum Zurücksetzen deines Passworts folgenden Link öffnen (läuft ab):\n${url}\n\n` +
            `Wenn du das nicht angefordert hast, ignoriere diese E-Mail.`,
        });
      },
    },

    advanced: {
      // Unsere UUID-Konvention (siehe CLAUDE.md: client-generierte UUID-Text-
      // PKs) statt Better Auths Standard-ID-Generator.
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },

    // rateLimit.enabled explizit true setzen: Better Auth aktiviert Rate-
    // Limiting per Default nur in production, greift also sonst weder in
    // dev noch in Tests (verifiziert gegen
    // https://www.better-auth.com/docs/concepts/rate-limit).
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rateLimits',
      window: 60,
      max: 100,
      customRules: {
        // Bewusst strenger als Better Auths eingebaute Default-Regeln für
        // sign-in/sign-up (window 10s/max 3) bzw. request-password-reset
        // (window 60s/max 3): wir wollen unsere eigenen, dokumentierten
        // Werte statt der impliziten Defaults.
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 10 },
        '/request-password-reset': { window: 60, max: 10 },
      },
    },

    plugins: [
      // Mobile nutzt später Bearer-Token statt Cookie (kein Cookie-Jar in
      // React Native). Siehe https://www.better-auth.com/docs/plugins/bearer
      bearer(),
    ],

    hooks: {
      // Erzwingt den Invite-Code VOR der User-Anlage. Markiert den Code aber
      // absichtlich noch nicht als verwendet (siehe databaseHooks unten) —
      // so verfällt er nicht, falls sign-up danach aus anderem Grund
      // scheitert (z. B. E-Mail bereits vergeben).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return;

        const totalUsers = await ctx.context.internalAdapter.countTotalUsers();
        if (totalUsers === 0) {
          // Bootstrap: der allererste Nutzer registriert sich ohne Code.
          return;
        }

        const body = ctx.body as Record<string, unknown> | undefined;
        const inviteCode = body?.inviteCode;
        if (typeof inviteCode !== 'string' || inviteCode.length === 0) {
          throw new APIError('FORBIDDEN', {
            message: 'Registrierung erfordert einen gültigen Einladungscode.',
          });
        }

        const now = Date.now();
        const rows = await db.select().from(inviteCodes).where(eq(inviteCodes.code, inviteCode)).limit(1);
        const invite = rows[0];

        if (!invite || invite.usedByUserId !== null || invite.expiresAt < now) {
          throw new APIError('FORBIDDEN', {
            message: 'Einladungscode ist ungültig, bereits verwendet oder abgelaufen.',
          });
        }
      }),
    },

    databaseHooks: {
      user: {
        create: {
          // Läuft erst NACH erfolgreicher User-Anlage (siehe
          // better-auth/dist/db/with-hooks.mjs: `after` feuert nach dem
          // adapter.create-Aufruf, `context` stammt aus derselben Request-
          // AsyncLocalStorage wie ctx.body im before-Hook oben, ist bei
          // sign-up/email also nicht null). Damit ist das saubere Markieren
          // nach User-Anlage hier zuverlässig möglich — der im Auftrag
          // erwähnte Trade-off (Konsumieren bereits im before-Hook) ist
          // dadurch nicht nötig.
          after: async (user, context) => {
            const body = context?.body as Record<string, unknown> | undefined;
            const inviteCode = body?.inviteCode;
            if (typeof inviteCode !== 'string' || inviteCode.length === 0) return;

            await db
              .update(inviteCodes)
              .set({ usedByUserId: user.id, usedAt: Date.now() })
              .where(eq(inviteCodes.code, inviteCode));
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
