/**
 * Ascent E2E-Smoke — autonome Ende-zu-Ende-Prüfung der Backend-Verträge,
 * die die Apps über die Leitung nutzen. Fährt einen kompletten Client-Flow
 * gegen eine laufende API: Registrierung/Login, Profil, Entitlements,
 * Übungssuche (inkl. Übersetzungen + Medien), Plan-/Workout-CRUD,
 * Offline-Sync-Roundtrip, Multi-User-Isolation und Invite-Verbrauch.
 *
 * Kein Gerät, kein Emulator nötig — deckt die gesamte Datenschicht ab, die
 * hinter den App-Screens liegt. UI-Rendering selbst bleibt Gerätetest-Sache.
 *
 * Start:
 *   node --experimental-strip-types scripts/e2e-smoke.ts [--base <url>] [--verbose]
 *   pnpm e2e            (Default-Ziel http://127.0.0.1:8787 — lokaler wrangler dev)
 *
 * Sicherheit: schreibt Daten (legt Test-Nutzer/Pläne/Workouts an). NUR gegen
 * eine lokale/Test-API laufen lassen — NICHT gegen die Produktions-URL, ausser
 * bewusst mit --allow-remote (dann entstehen dort Wegwerf-Testkonten).
 *
 * Exit-Code 0 = alle Schritte grün, 1 = mindestens ein Fehler.
 */

const DEFAULT_BASE = 'http://127.0.0.1:8787';

// ---------------------------------------------------------------------------
// CLI-Argumente
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { base: string; verbose: boolean; allowRemote: boolean } {
  let base = process.env.ASCENT_E2E_BASE ?? DEFAULT_BASE;
  let verbose = false;
  let allowRemote = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') {
      const next = argv[i + 1];
      if (!next) throw new Error('--base benötigt eine URL.');
      base = next;
      i += 1;
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '--allow-remote') {
      allowRemote = true;
    }
  }
  base = base.replace(/\/$/, '');
  if (base.includes('workers.dev') && !allowRemote) {
    throw new Error(
      'Ziel sieht nach Produktion aus (workers.dev). Zum bewussten Ausführen --allow-remote setzen.',
    );
  }
  return { base, verbose, allowRemote };
}

// ---------------------------------------------------------------------------
// HTTP-Client mit eigenem Cookie-Jar (bildet ein App-Gerät/eine Session ab)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown> | unknown[] | null;

class Client {
  private cookies = new Map<string, string>();
  readonly base: string;
  readonly label: string;

  constructor(base: string, label: string) {
    this.base = base;
    this.label = label;
  }

  private captureCookies(res: Response): void {
    // Node 18+/undici: getSetCookie() liefert alle Set-Cookie-Header einzeln.
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const pair = line.split(';', 1)[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (name) this.cookies.set(name, value);
      }
    }
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: Json; text: string }> {
    const headers: Record<string, string> = {};
    const cookie = this.cookieHeader();
    if (cookie) headers['Cookie'] = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // Better Auth verlangt bei zustandsändernden Requests einen Origin-Header
    // (CSRF-Schutz). Die baseURL-Origin ist immer vertrauenswürdig — sie deckt
    // lokal (127.0.0.1:8787) wie Prod (workers.dev) ab.
    headers['Origin'] = new URL(this.base).origin;

    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    this.captureCookies(res);

    const text = await res.text();
    let json: Json = null;
    try {
      json = text ? (JSON.parse(text) as Json) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  }

  get(path: string) {
    return this.request('GET', path);
  }
  post(path: string, body?: unknown) {
    return this.request('POST', path, body);
  }
  put(path: string, body?: unknown) {
    return this.request('PUT', path, body);
  }
  del(path: string) {
    return this.request('DELETE', path);
  }
}

// ---------------------------------------------------------------------------
// Mini-Testrunner
// ---------------------------------------------------------------------------

class AssertError extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssertError(message);
}

type StepResult = { name: string; ok: boolean; ms: number; error?: string };
const results: StepResult[] = [];
let verboseFlag = false;

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    results.push({ name, ok: true, ms });
    console.log(`  \x1b[32m✓\x1b[0m ${name} \x1b[90m(${ms} ms)\x1b[0m`);
  } catch (err) {
    const ms = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, ms, error });
    console.log(`  \x1b[31m✗ ${name}\x1b[0m \x1b[90m(${ms} ms)\x1b[0m`);
    console.log(`    \x1b[31m${error}\x1b[0m`);
  }
}

function log(...args: unknown[]): void {
  if (verboseFlag) console.log('    \x1b[90m', ...args, '\x1b[0m');
}

// crypto.randomUUID ist in Node 22 global verfügbar.
const uuid = (): string => crypto.randomUUID();

// ---------------------------------------------------------------------------
// Haupt-Flow
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { base, verbose } = parseArgs(process.argv.slice(2));
  verboseFlag = verbose;

  const stamp = uuid().slice(0, 8);
  // Fester Primär-Account: Lauf 1 gegen frische DB bootstrappt ihn, jeder
  // weitere Lauf loggt sich ein — so ist der Test ohne DB-Reset wiederholbar.
  const primaryEmail = 'e2e-primary@ascent.test';
  const primaryPassword = 'E2ePruefung!2026';
  // Partner pro Lauf frisch (Invite-Codes sind einmalig; testet Isolation).
  const partnerEmail = `e2e-partner-${stamp}@ascent.test`;
  const partnerPassword = 'E2ePartner!2026';

  console.log(`\n\x1b[1mAscent E2E-Smoke\x1b[0m  →  ${base}`);
  console.log(`Test-Nutzer: ${primaryEmail}\n`);

  const app = new Client(base, 'primary');

  // Geteilter Zustand über die Schritte hinweg.
  const state: {
    exerciseId?: string;
    exerciseNameDe?: string;
    thumbnailUrl?: string;
    planId?: string;
    workoutId?: string;
    inviteCode?: string;
    bootstrapped?: boolean;
  } = {};

  await step('GET /health liefert ok', async () => {
    const { status, json } = await app.get('/health');
    assert(status === 200, `Status ${status}`);
    assert((json as Record<string, unknown>)?.status === 'ok', 'status != ok');
  });

  await step('GET /version liefert eine Version', async () => {
    const { status, json } = await app.get('/version');
    assert(status === 200, `Status ${status}`);
    assert(typeof (json as Record<string, unknown>)?.latestVersion === 'string', 'latestVersion fehlt');
  });

  await step('Datenrouten sind ohne Session geschützt (401)', async () => {
    const { status } = await app.get('/plans');
    assert(status === 401, `erwartet 401, war ${status}`);
  });

  await step('Login (Bootstrap-Registrierung beim allerersten Lauf)', async () => {
    // Erstversuch: Bootstrap-Registrierung ohne Invite — klappt nur, wenn die
    // Nutzertabelle leer ist (allererster Lauf gegen eine frische DB).
    const signup = await app.post('/auth/sign-up/email', {
      email: primaryEmail,
      password: primaryPassword,
      name: 'E2E Prüfer',
    });
    if (signup.status === 200 || signup.status === 201) {
      state.bootstrapped = true;
      log('Bootstrap-Registrierung erfolgreich (leere Nutzertabelle).');
      return;
    }
    // Sonst existiert der feste Account bereits (früherer Lauf) → einloggen.
    const login = await app.post('/auth/sign-in/email', {
      email: primaryEmail,
      password: primaryPassword,
    });
    assert(
      login.status === 200,
      `Weder Bootstrap (${signup.status}) noch Login (${login.status}) möglich. ` +
        `Falls die DB fremde Nutzer, aber nicht ${primaryEmail} enthält: lokale D1 zurücksetzen.`,
    );
    log('Login als bestehender fester Primär-Account.');
  });

  await step('GET /profile spiegelt den Nutzer (Tier free)', async () => {
    const { status, json } = await app.get('/profile');
    assert(status === 200, `Status ${status}`);
    const p = json as Record<string, unknown>;
    assert(p.email === primaryEmail, `Email ${String(p.email)}`);
    assert(p.tier === 'free', `Tier ${String(p.tier)}`);
  });

  await step('GET /entitlements: Basis-Statistik frei, Pro gesperrt', async () => {
    const { status, json } = await app.get('/entitlements');
    assert(status === 200, `Status ${status}`);
    const e = json as { tier?: string; features?: Record<string, boolean> };
    assert(e.tier === 'free', `Tier ${String(e.tier)}`);
    assert(e.features?.['stats.web.basic'] === true, 'stats.web.basic sollte frei sein');
    assert(e.features?.['stats.web.advanced'] === false, 'stats.web.advanced sollte gesperrt sein');
  });

  await step('GET /exercises liefert Treffer mit deutschem Namen + Medien-URL', async () => {
    const { status, json } = await app.get('/exercises?q=bench&limit=5');
    assert(status === 200, `Status ${status}`);
    const rows = json as Array<Record<string, unknown>>;
    assert(Array.isArray(rows) && rows.length > 0, 'keine Übungen gefunden');
    const withDe = rows.find((r) => typeof r.nameDe === 'string' && (r.nameDe as string).length > 0);
    assert(withDe, 'keine Übung mit nameDe (Übersetzungen fehlen?)');
    log(`Beispiel: "${String(withDe!.name)}" → "${String(withDe!.nameDe)}"`);
    const picked = rows.find((r) => typeof r.thumbnailUrl === 'string') ?? rows[0];
    state.exerciseId = picked.id as string;
    state.exerciseNameDe = (picked.nameDe as string) ?? (picked.name as string);
    state.thumbnailUrl = picked.thumbnailUrl as string | undefined;
    assert(typeof state.exerciseId === 'string', 'Übung ohne id');
  });

  await step('Medien-Route liefert das Übungsbild aus', async () => {
    assert(state.thumbnailUrl, 'keine thumbnailUrl aus der Übungssuche');
    // thumbnailUrl ist absolut (Prod-Host). Für den Test den Pfad an die
    // getestete Basis hängen, damit lokal gegen den lokalen R2 geprüft wird.
    const path = new URL(state.thumbnailUrl!).pathname;
    const { status, text } = await app.get(path);
    assert(status === 200, `Status ${status} für ${path}`);
    assert(text.length > 0, 'leere Bildantwort');
  });

  await step('POST /plans legt einen Plan an', async () => {
    const { status, json } = await app.post('/plans', { name: `E2E Plan ${stamp}` });
    assert(status === 201, `Status ${status} ${JSON.stringify(json)}`);
    state.planId = (json as Record<string, unknown>).id as string;
    assert(typeof state.planId === 'string', 'Plan ohne id');
  });

  await step('POST /plans/:id/exercises hängt eine Übung an', async () => {
    const { status, json } = await app.post(`/plans/${state.planId}/exercises`, {
      exerciseId: state.exerciseId,
      position: 0,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
      restSeconds: 90,
    });
    assert(status === 201, `Status ${status} ${JSON.stringify(json)}`);
  });

  await step('GET /plans/:id enthält die Plan-Übung', async () => {
    const { status, json } = await app.get(`/plans/${state.planId}`);
    assert(status === 200, `Status ${status}`);
    const plan = json as { planExercises?: Array<Record<string, unknown>> };
    assert(Array.isArray(plan.planExercises) && plan.planExercises.length === 1, 'Plan-Übung fehlt');
    assert(plan.planExercises![0].exerciseId === state.exerciseId, 'falsche exerciseId');
  });

  await step('Workout starten, Satz loggen, beenden', async () => {
    const now = Date.now();
    const created = await app.post('/workouts', { planId: state.planId, startedAt: now });
    assert(created.status === 201, `Start-Status ${created.status} ${created.text}`);
    state.workoutId = (created.json as Record<string, unknown>).id as string;

    const set = await app.post(`/workouts/${state.workoutId}/sets`, {
      exerciseId: state.exerciseId,
      setNumber: 1,
      weightKg: 80,
      reps: 8,
      completedAt: Date.now(),
    });
    assert(set.status === 201, `Satz-Status ${set.status} ${set.text}`);

    const finished = await app.put(`/workouts/${state.workoutId}`, { finishedAt: Date.now() });
    assert(finished.status === 200, `Beenden-Status ${finished.status}`);
  });

  await step('GET /workouts/:id zeigt den erfassten Satz', async () => {
    const { status, json } = await app.get(`/workouts/${state.workoutId}`);
    assert(status === 200, `Status ${status}`);
    // Die Workout-Route liefert die Sätze unter `sets` (die Plan-Route nutzt
    // `planExercises`) — bewusst so belassen, Clients konsumieren das bereits.
    const w = json as { sets?: Array<Record<string, unknown>> };
    assert(Array.isArray(w.sets) && w.sets.length === 1, 'Satz fehlt');
    assert(w.sets![0].weightKg === 80, 'falsches Gewicht');
  });

  await step('Sync-Pull enthält Plan, Workout und Satz', async () => {
    const { status, json } = await app.post('/sync/pull', { since: {} });
    assert(status === 200, `Status ${status}`);
    const pull = json as { tables?: Record<string, Array<Record<string, unknown>>> };
    const plans = pull.tables?.plans ?? [];
    const workouts = pull.tables?.workouts ?? [];
    const sets = pull.tables?.workout_sets ?? [];
    assert(plans.some((p) => p.id === state.planId), 'Plan nicht im Pull');
    assert(workouts.some((w) => w.id === state.workoutId), 'Workout nicht im Pull');
    assert(sets.length >= 1, 'kein Satz im Pull');
  });

  await step('Sync-Push eines Körpermass-Werts (offline erfasst)', async () => {
    const id = uuid();
    const now = Date.now();
    const push = await app.post('/sync/push', {
      tables: {
        body_metrics: [
          { id, measuredAt: now, weightKg: 82.5, createdAt: now, updatedAt: now, deleted: false },
        ],
      },
    });
    assert(push.status === 200, `Status ${push.status} ${push.text}`);
    const res = push.json as { tables?: Record<string, { applied: number }> };
    assert(res.tables?.body_metrics?.applied === 1, 'body_metric nicht applied');

    const back = await app.get('/body-metrics');
    assert(back.status === 200, `Rücklese-Status ${back.status}`);
    const rows = back.json as Array<Record<string, unknown>>;
    assert(rows.some((r) => r.id === id), 'gepushter Wert nicht wieder auslesbar');
  });

  await step('Invite-Code erstellen (für Partner-Registrierung)', async () => {
    const { status, json } = await app.post('/invites');
    assert(status === 200 || status === 201, `Status ${status} ${JSON.stringify(json)}`);
    state.inviteCode = (json as Record<string, unknown>).code as string;
    assert(typeof state.inviteCode === 'string' && state.inviteCode.length > 0, 'kein Code');
    log(`Invite: ${state.inviteCode}`);
  });

  const partner = new Client(base, 'partner');

  await step('Partner registriert sich mit dem Invite-Code', async () => {
    const { status, text } = await partner.post('/auth/sign-up/email', {
      email: partnerEmail,
      password: partnerPassword,
      name: 'E2E Partner',
      inviteCode: state.inviteCode,
    });
    assert(status === 200 || status === 201, `Status ${status} ${text}`);
  });

  await step('Ownership: Partner sieht die Pläne des Erstnutzers NICHT', async () => {
    const { status, json } = await partner.get('/plans');
    assert(status === 200, `Status ${status}`);
    const rows = json as Array<Record<string, unknown>>;
    assert(!rows.some((p) => p.id === state.planId), 'Partner sieht fremden Plan (Leck!)');
  });

  await step('Ownership: Partner kann fremden Plan nicht abrufen (404)', async () => {
    const { status } = await partner.get(`/plans/${state.planId}`);
    assert(status === 404, `erwartet 404, war ${status}`);
  });

  await step('Invite-Code ist nach Verbrauch nicht wiederverwendbar', async () => {
    const third = new Client(base, 'third');
    const { status } = await third.post('/auth/sign-up/email', {
      email: `e2e-third-${stamp}@ascent.test`,
      password: 'E2eDritter!2026',
      name: 'E2E Dritter',
      inviteCode: state.inviteCode,
    });
    assert(status !== 200 && status !== 201, `verbrauchter Code wurde erneut akzeptiert (${status})`);
  });

  // ---- Bericht ----
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const totalMs = results.reduce((sum, r) => sum + r.ms, 0);

  console.log(`\n\x1b[1mErgebnis:\x1b[0m ${passed}/${results.length} grün, ${failed} rot  \x1b[90m(${totalMs} ms)\x1b[0m`);
  if (failed > 0) {
    console.log('\n\x1b[31mFehlgeschlagene Schritte:\x1b[0m');
    for (const r of results.filter((x) => !x.ok)) console.log(`  • ${r.name}: ${r.error}`);
    process.exitCode = 1;
  } else {
    console.log('\x1b[32mAlle Backend-Verträge der App verifiziert.\x1b[0m');
  }
}

main().catch((err) => {
  console.error('\x1b[31mE2E-Smoke abgebrochen:\x1b[0m', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
