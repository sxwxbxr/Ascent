import { applyD1Migrations, env } from 'cloudflare:test';

// Läuft einmal pro Testdatei (isolierter Storage) und bringt die Test-D1
// auf den aktuellen Migrationsstand aus apps/api/drizzle/.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
