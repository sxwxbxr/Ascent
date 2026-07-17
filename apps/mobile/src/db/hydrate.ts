import * as SecureStore from 'expo-secure-store';
import { exercises, users } from '@ascent/shared';
import type { SyncPullResult, SyncRow, Tier } from '@ascent/shared';

import { API_URL } from '../config';
import { authClient } from '../auth/client';
import { db } from './client';

/** SecureStore-Key für den Pull-Cursor der Übungen (Epoch-ms des letzten `serverTime`). */
const EXERCISES_CURSOR_KEY = 'ascent.sync.exercises.since';

/** Wie viele Zeilen pro DB-Transaktions-"Batch" verarbeitet werden (spec: Chunks à 100). */
const CHUNK_SIZE = 100;

/**
 * Spiegelt den eingeloggten Session-Nutzer in die lokale `users`-Tabelle
 * (Drizzle, onConflictDoUpdate auf `id`). Grundlage für die FK `userId` auf
 * plans/workouts (siehe src/lib/owner.ts) — funktioniert dadurch auch rein
 * offline, weil die lokale Zeile bereits beim letzten Online-Login geschrieben
 * wurde. createdAt/updatedAt sind hier laut Schema-Konvention (packages/
 * shared/src/db/schema.ts, users-Tabelle) Date-Objekte (mode 'timestamp_ms'),
 * nicht Epoch-ms-Zahlen wie bei den übrigen Sync-Tabellen.
 */
export async function upsertLocalUser(user: {
  id: string;
  email: string;
  name: string;
  tier?: Tier;
}): Promise<void> {
  const now = new Date();
  const tier: Tier = user.tier ?? 'free';

  await db
    .insert(users)
    .values({
      id: user.id,
      email: user.email,
      displayName: user.name,
      tier,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: user.email,
        displayName: user.name,
        tier,
        updatedAt: now,
      },
    });
}

/** Wandelt eine vom Server gepullte Sync-Zeile in die lokale Insert-Form um. */
function toLocalExercise(row: SyncRow<'exercises'>): typeof exercises.$inferInsert {
  return {
    id: row.id,
    userId: row.userId ?? null,
    name: row.name,
    nameDe: row.nameDe ?? null,
    category: row.category ?? null,
    primaryMuscle: row.primaryMuscle ?? null,
    equipment: row.equipment ?? null,
    instructionsEn: row.instructionsEn ?? null,
    instructionsDe: row.instructionsDe ?? null,
    thumbnailUrl: row.thumbnailUrl ?? null,
    gifUrl: row.gifUrl ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
  };
}

/**
 * Holt neue/geänderte Übungen seit dem letzten Cursor via POST /sync/pull und
 * schreibt sie in Chunks à 100 in die lokale DB (insert().onConflictDoUpdate()
 * je Zeile — bewusst NICHT ein gemeinsames Multi-Row-Statement mit
 * `excluded.*`-Referenzen: das wäre auf dem expo-sqlite-Treiber nicht auf
 * einem Gerät verifizierbar gewesen, ein Statement pro Zeile ist dagegen durch
 * Konstruktion korrekt). `since` kommt aus SecureStore (Key oben), Default 0
 * beim allerersten Aufruf. Läuft fire-and-forget vom Root-Layout aus — jeder
 * Fehler (kein Netz, Server nicht erreichbar) wird bewusst nur geloggt, nie
 * geworfen: Hydration darf den Start/Render nie blockieren.
 *
 * Auth: authClient.$fetch hängt die Session-Cookies für JEDE Anfrage über
 * denselben $fetch-Client automatisch an, auch für absolute URLs ausserhalb
 * der konfigurierten baseURL ('${API_URL}/auth') — verifiziert an
 * node_modules/@better-auth/expo/dist/client.js (`init(url, options)`-Hook
 * prüft die Ziel-URL nicht, hängt `cookie` unconditioned für jede
 * Nicht-Web-Anfrage an) und an node_modules/@better-fetch/fetch/dist/index.js
 * (`getURL`: eine mit "http" beginnende URL wird 1:1 verwendet, die
 * `baseURL`-Option wird dabei bewusst ignoriert). Ein manuelles Setzen über
 * den dokumentierten `authClient.getCookie()`-Getter ist dadurch nicht nötig.
 */
export async function hydrateExercises(): Promise<void> {
  try {
    const cursorRaw = SecureStore.getItem(EXERCISES_CURSOR_KEY);
    const since = cursorRaw ? Number(cursorRaw) : 0;

    const res = await authClient.$fetch<SyncPullResult>(`${API_URL}/sync/pull`, {
      method: 'POST',
      body: { since: { exercises: Number.isFinite(since) ? since : 0 } },
    });

    if (res.error || !res.data) {
      console.log('[hydrateExercises] sync/pull fehlgeschlagen (offline toleriert):', res.error);
      return;
    }

    const rows = res.data.tables.exercises;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      for (const row of chunk) {
        const values = toLocalExercise(row);
        await db.insert(exercises).values(values).onConflictDoUpdate({
          target: exercises.id,
          set: values,
        });
      }
    }

    SecureStore.setItem(EXERCISES_CURSOR_KEY, String(res.data.serverTime));
  } catch (err) {
    // Netzwerkfehler (z. B. kein Empfang) sollen die App nie blockieren.
    console.log('[hydrateExercises] Netzwerkfehler (offline toleriert):', err);
  }
}
