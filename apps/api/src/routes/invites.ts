import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { inviteCodes } from '@ascent/shared';

import type { AuthEnv } from '../middleware/auth';

/**
 * Router für Einladungscodes (geschlossene Registrierung, siehe
 * src/auth/auth.ts). Wird ohne eigene Auth-Middleware exportiert — der
 * Orchestrator mountet `requireAuth` zentral davor (siehe apps/api/src/index.ts).
 * Zugriff auf den Nutzer: c.get('user').
 */
export const invitesRouter = new Hono<AuthEnv>();

/** A-Z + 2-9 (ohne 0/1, zur Vermeidung von Verwechslung mit O/I). */
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 Tage

/** Erzeugt einen kryptografisch zufälligen, 12-stelligen Einladungscode. */
function generateInviteCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

type InviteStatus = 'offen' | 'verwendet' | 'abgelaufen';

/** Berechnet den Anzeige-Status eines Codes (nichts davon wird persistiert). */
function statusOf(invite: { usedByUserId: string | null; expiresAt: number }, now: number): InviteStatus {
  if (invite.usedByUserId !== null) return 'verwendet';
  if (invite.expiresAt < now) return 'abgelaufen';
  return 'offen';
}

/** POST / — erzeugt einen neuen Einladungscode für den angemeldeten Nutzer (gültig 14 Tage). */
invitesRouter.post('/', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const now = Date.now();
  const expiresAt = now + INVITE_TTL_MS;
  const code = generateInviteCode();

  await db.insert(inviteCodes).values({
    id: crypto.randomUUID(),
    code,
    createdByUserId: user.id,
    usedByUserId: null,
    usedAt: null,
    expiresAt,
    createdAt: now,
  });

  return c.json({ code, expiresAt }, 201);
});

/** GET / — eigene Einladungscodes inkl. berechnetem Status ('offen' | 'verwendet' | 'abgelaufen'). */
invitesRouter.get('/', async (c) => {
  const user = c.get('user');
  const db = drizzle(c.env.DB);
  const now = Date.now();

  const rows = await db.select().from(inviteCodes).where(eq(inviteCodes.createdByUserId, user.id));

  return c.json(
    rows
      .map((row) => ({
        code: row.code,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt,
        status: statusOf(row, now),
      }))
      .sort((a, b) => b.createdAt - a.createdAt),
  );
});
