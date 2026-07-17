import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

// enableChangeListener: Voraussetzung für useLiveQuery (reaktive Screens)
export const sqlite = openDatabaseSync('ascent.db', { enableChangeListener: true });

// Gleiche Integritätsregeln wie die Server-D1: FKs erzwingen (expo-sqlite
// hat sie per Default AUS). WAL für flüssige parallele Reads.
sqlite.execSync('PRAGMA journal_mode = WAL;');
sqlite.execSync('PRAGMA foreign_keys = ON;');

/** Lokale Offline-Datenbank — gleiches Schema wie die Server-D1 (@ascent/shared). */
export const db = drizzle(sqlite);
