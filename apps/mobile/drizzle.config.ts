import { defineConfig } from 'drizzle-kit';

// Gleiche Schema-Quelle wie die API (Single Source of Truth in shared);
// driver 'expo' erzeugt zusätzlich drizzle/migrations.js für den
// expo-sqlite-Migrator.
export default defineConfig({
  schema: '../../packages/shared/src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'expo',
});
