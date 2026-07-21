import { drizzle } from 'drizzle-orm/expo-sqlite';
import { deleteDatabaseSync, openDatabaseSync } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

export const DB_NAME = 'ascent.db';

/**
 * Öffnet die lokale DB und setzt die Integritäts-Pragmas.
 *
 * Bewusst KEIN journal_mode = WAL (im Gegenteil: explizit DELETE): WAL
 * hinterlässt -wal/-shm-Begleitdateien, die auf Android beim Kaltstart
 * (Prozess-Neustart mit bereits vorhandener DB) zu Abstürzen führten
 * (Gerätetest 21.07.2026: App liess sich nach dem ersten vollständigen
 * Schliessen nicht mehr öffnen, nur Neuinstallation half). DELETE erzwingt den
 * robusten Rollback-Journalmodus und checkpointet/entfernt eine evtl. bereits
 * vorhandene WAL-Datei beim Install-über-die-Vorversion. Der
 * Performance-Unterschied ist bei dieser Datenmenge irrelevant.
 *
 * `enableChangeListener` bleibt an (Voraussetzung für useLiveQuery) — der
 * Change-Listener funktioniert unabhängig vom Journalmodus.
 */
function openWithPragmas(): SQLiteDatabase {
  const conn = openDatabaseSync(DB_NAME, { enableChangeListener: true });
  conn.execSync('PRAGMA journal_mode = DELETE;');
  conn.execSync('PRAGMA foreign_keys = ON;');
  return conn;
}

/**
 * Öffnet die DB fehlertolerant: Schlägt Öffnen oder Pragma-Setzen fehl (korrupte
 * oder inkompatible lokale Datei), wird die Datei gelöscht und frisch geöffnet —
 * die App heilt sich beim Start selbst, statt hart abzustürzen (Server-Daten
 * kommen anschliessend per Sync zurück). Dieser Guard läuft zur MODUL-IMPORT-Zeit
 * und ergänzt damit die ErrorBoundary in app/_layout.tsx, die nur Render-Fehler
 * abfängt — NICHT Fehler beim Import (genau hier lag der Kaltstart-Absturz).
 */
function openResilient(): SQLiteDatabase {
  try {
    return openWithPragmas();
  } catch (err) {
    console.log('[db] Öffnen fehlgeschlagen — lokale DB wird zurückgesetzt und neu angelegt:', err);
    try {
      deleteDatabaseSync(DB_NAME);
    } catch (delErr) {
      console.log('[db] Löschen der beschädigten DB fehlgeschlagen:', delErr);
    }
    return openWithPragmas();
  }
}

export const sqlite = openResilient();

/** Lokale Offline-Datenbank — gleiches Schema wie die Server-D1 (@ascent/shared). */
export const db = drizzle(sqlite);

/**
 * Notfall-Reset der lokalen Datenbank (Boot-Guard, siehe app/_layout.tsx):
 * schliesst die Verbindung und löscht die SQLite-Datei. Genutzt, wenn eine
 * Migration auf inkompatiblen Altdaten scheitert (Recovery-Screen) — die
 * Server-Daten kommen nach dem Neustart per Sync vollständig zurück. Nach dem
 * Aufruf muss die App neu gestartet werden (der Handle wurde beim Modul-Import
 * geöffnet und kann im selben Prozess nicht sauber neu belegt werden).
 */
export function resetLocalDatabase(): void {
  try {
    sqlite.closeSync();
  } catch {
    // Verbindung evtl. schon zu — ignorieren, Löschung ist das Ziel.
  }
  deleteDatabaseSync(DB_NAME);
}
