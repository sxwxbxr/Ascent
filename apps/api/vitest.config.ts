import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Tests laufen in workerd mit echten (lokalen) D1/R2-Bindings. Jede Testdatei
// bekommt isolierten Storage; die Migrationen werden im Setup-File auf die
// Test-D1 angewendet.
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./drizzle');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET: 'test-secret-nur-fuer-tests',
            BETTER_AUTH_URL: 'http://127.0.0.1:8787',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
