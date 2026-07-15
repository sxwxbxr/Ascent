import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Bindings } from '../src/env';

// vitest-pool-workers 0.18.x typisiert `env` aus 'cloudflare:test' als
// Cloudflare.Env — wir erweitern diese global um unsere Worker-Bindings
// plus die nur im Test vorhandenen Migrations.
declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
