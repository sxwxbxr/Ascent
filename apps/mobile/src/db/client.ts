import { drizzle } from 'drizzle-orm/expo-sqlite';
import { deleteDatabaseSync, openDatabaseSync } from 'expo-sqlite';

export const DB_NAME = 'ascent.db';

// enableChangeListener: Voraussetzung für useLiveQuery (reaktive Screens)
export const sqlite = openDatabaseSync(DB_NAME, { enableChangeListener: true });

// Gleiche Integritätsregeln wie die Server-D1: FKs erzwingen (expo-sqlite
// hat sie per Default AUS). WAL für flüssige parallele Reads.
sqlite.execSync('PRAGMA journal_mode = WAL;');
sqlite.execSync('PRAGMA foreign_keys = ON;');

/** Lokale Offline-Datenbank — gleiches Schema wie die Server-D1 (@ascent/shared). */
export const db = drizzle(sqlite);

/**
 * Notfall-Reset der lokalen Datenbank (Boot-Guard, siehe app/_layout.tsx):
 * schliesst die Verbindung und löscht die SQLite-Datei. Genutzt, wenn eine
 * Migration auf inkompatiblen Altdaten scheitert (Update-Crash-Recovery) —
 * die Server-Daten kommen nach dem Neustart per Sync vollständig zurück.
 * Nach dem Aufruf MUSS die App neu gestartet werden (der Handle wurde beim
 * Modul-Import geöffnet und kann im selben Prozess nicht sauber neu belegt
 * werden).
 */
export function resetLocalDatabase(): void {
  try {
    sqlite.closeSync();
  } catch {
    // Verbindung evtl. schon zu — ignorieren, Löschung ist das Ziel.
  }
  deleteDatabaseSync(DB_NAME);
}
