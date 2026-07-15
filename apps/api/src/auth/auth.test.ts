import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { inviteCodes, verifications } from '@ascent/shared';

import type { AuthEnv } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { invitesRouter } from '../routes/invites';
import { createAuth } from './auth';

// Test-App, die die spätere Verdrahtung in src/index.ts nachbildet: Better
// Auths eigener Request-Handler unter /auth/*, plus /invites mit derselben
// requireAuth-Middleware, die der Orchestrator später auch vor die echten
// Datenrouten hängt (Router selbst kennen keine Auth-Middleware, siehe
// apps/api/src/routes/invites.ts).
const app = new Hono<AuthEnv>();
app.on(['GET', 'POST'], '/auth/*', (c) => createAuth(c.env).handler(c.req.raw));
app.use('/invites', requireAuth);
app.use('/invites/*', requireAuth);
app.route('/invites', invitesRouter);

/** Fasst alle Set-Cookie-Header einer Response zu einem sendefertigen Cookie-Header zusammen. */
function cookieHeaderFrom(res: Response): string {
  const cookies = res.headers.getSetCookie();
  if (cookies.length === 0) {
    throw new Error('Erwartete mindestens einen Set-Cookie-Header in der Antwort');
  }
  return cookies.map((raw) => raw.split(';')[0]).join('; ');
}

async function signUp(email: string, password: string, inviteCode?: string): Promise<Response> {
  return app.request(
    '/auth/sign-up/email',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `Test-Nutzer ${email}`,
        email,
        password,
        ...(inviteCode ? { inviteCode } : {}),
      }),
    },
    env,
  );
}

async function signIn(email: string, password: string): Promise<Response> {
  return app.request(
    '/auth/sign-in/email',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    env,
  );
}

describe('Bootstrap: Registrierung ohne Invite-Code', () => {
  it('erlaubt den allerersten Nutzer ohne Code (200)', async () => {
    const res = await signUp('bootstrap@example.com', 'sicheres-passwort-1');
    expect(res.status).toBe(200);
  });

  it('lehnt eine weitere Registrierung ohne Code ab (403), sobald ein Nutzer existiert', async () => {
    const res = await signUp('ohne-code@example.com', 'sicheres-passwort-2');
    expect(res.status).toBe(403);

    const body = await res.json<{ message?: string }>();
    expect(body.message ?? '').toMatch(/Einladungscode/);
  });
});

describe('Invite-Code-Flow', () => {
  let ownerCookie: string;
  let inviteCode: string;

  it('Nutzer 1 (Bootstrap-Nutzer) meldet sich an', async () => {
    const res = await signIn('bootstrap@example.com', 'sicheres-passwort-1');
    expect(res.status).toBe(200);
    ownerCookie = cookieHeaderFrom(res);
  });

  it('erstellt einen Einladungscode via POST /invites', async () => {
    const res = await app.request('/invites', { method: 'POST', headers: { cookie: ownerCookie } }, env);
    expect(res.status).toBe(201);

    const body = await res.json<{ code: string; expiresAt: number }>();
    expect(body.code).toHaveLength(12);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    inviteCode = body.code;
  });

  it('listet den Code als "offen" via GET /invites', async () => {
    const res = await app.request('/invites', { headers: { cookie: ownerCookie } }, env);
    expect(res.status).toBe(200);

    const body = await res.json<Array<{ code: string; status: string }>>();
    expect(body.find((entry) => entry.code === inviteCode)?.status).toBe('offen');
  });

  it('registriert einen zweiten Nutzer mit dem Code (200)', async () => {
    const res = await signUp('zweiter@example.com', 'sicheres-passwort-3', inviteCode);
    expect(res.status).toBe(200);
  });

  it('lehnt denselben Code für einen dritten Nutzer ab (403, bereits verwendet)', async () => {
    const res = await signUp('dritter@example.com', 'sicheres-passwort-4', inviteCode);
    expect(res.status).toBe(403);
  });

  it('lehnt einen abgelaufenen Code ab (403)', async () => {
    const db = drizzle(env.DB);
    const expiredCode = 'EXPIREDCODE01';
    await db.insert(inviteCodes).values({
      id: crypto.randomUUID(),
      code: expiredCode,
      createdByUserId: null,
      usedByUserId: null,
      usedAt: null,
      expiresAt: Date.now() - 1000,
      createdAt: Date.now() - 2000,
    });

    const res = await signUp('vierter@example.com', 'sicheres-passwort-5', expiredCode);
    expect(res.status).toBe(403);
  });
});

describe('Login', () => {
  it('lehnt falsches Passwort ab (401)', async () => {
    const res = await signIn('bootstrap@example.com', 'ganz-falsches-passwort');
    expect(res.status).toBe(401);
  });
});

describe('Zugriffsschutz auf /invites', () => {
  it('lehnt Zugriff ohne Session ab (401)', async () => {
    const res = await app.request('/invites', {}, env);
    expect(res.status).toBe(401);
  });
});

describe('Passwort-Reset-Flow', () => {
  const email = 'bootstrap@example.com';
  const newPassword = 'ein-ganz-neues-passwort-9';

  it('request-password-reset legt einen Verification-Token an', async () => {
    const res = await app.request(
      '/auth/request-password-reset',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      },
      env,
    );
    expect(res.status).toBe(200);

    const db = drizzle(env.DB);
    const rows = await db.select().from(verifications);
    const tokenRow = rows.find((row) => row.identifier.startsWith('reset-password:'));
    expect(tokenRow).toBeDefined();
  });

  it('reset-password mit dem Token funktioniert, Login mit dem neuen Passwort auch', async () => {
    const db = drizzle(env.DB);
    const rows = await db.select().from(verifications);
    const tokenRow = rows.find((row) => row.identifier.startsWith('reset-password:'));
    if (!tokenRow) throw new Error('Kein Reset-Password-Token in der verifications-Tabelle gefunden');
    const token = tokenRow.identifier.slice('reset-password:'.length);

    const resetRes = await app.request(
      '/auth/reset-password',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPassword, token }),
      },
      env,
    );
    expect(resetRes.status).toBe(200);

    const loginRes = await signIn(email, newPassword);
    expect(loginRes.status).toBe(200);
  });
});

describe('Rate-Limiting', () => {
  it('ist konfiguriert und greift nach genügend Anfragen auf /request-password-reset (429)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      const res = await app.request(
        '/auth/request-password-reset',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'rate-limit-ziel@example.com' }),
        },
        env,
      );
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
