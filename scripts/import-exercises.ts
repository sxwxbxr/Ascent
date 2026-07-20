/**
 * Ascent M2 -- Import-Script fuer die Uebungsdatenbank.
 *
 * Quelle: https://github.com/hasaneyldrm/exercises-dataset (Branch main), ~1'324
 * Uebungen als JSON (data/exercises.json) mit begleitenden Thumbnails/GIFs
 * (images/, videos/). Siehe apps/api/seed/exercises.sql (von diesem Script
 * generiert) fuer den Lizenz-/Attributionshinweis.
 *
 * Laeuft NUR mit Node-Built-ins (kein pnpm/npm install) via:
 *   node --experimental-strip-types scripts/import-exercises.ts <subcommand> [optionen]
 *
 * Subkommandos:
 *   sql   [--limit N]
 *     Laedt exercises.json (gecacht unter scripts/.cache/exercises.json) und
 *     schreibt apps/api/seed/exercises.sql (INSERT OR REPLACE, idempotent
 *     dank deterministischer UUIDv5-IDs).
 *
 *   media (--local | --remote) [--limit N] [--concurrency N=8]
 *     Laedt Thumbnails/GIFs (bevorzugt einmalig als Repo-Tarball, sonst
 *     Einzeldownload-Fallback) und laedt sie per `wrangler r2 object put`
 *     nach R2 hoch. Resume-faehig ueber ein Manifest.
 *
 *   apply (--local | --remote)
 *     Fuehrt die generierte SQL-Datei via `wrangler d1 execute` aus.
 *
 * WICHTIG: --remote/Prod-Laeufe macht der Orchestrator -- dieses Script wird
 * hier nur gegen --local getestet.
 */

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Pfade
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const API_DIR = join(REPO_ROOT, 'apps', 'api');
const CACHE_DIR = join(SCRIPT_DIR, '.cache');
const EXERCISES_JSON_CACHE = join(CACHE_DIR, 'exercises.json');
const REPO_TARBALL_CACHE = join(CACHE_DIR, 'repo.tar.gz');
const REPO_EXTRACT_DIR = join(CACHE_DIR, 'repo');
const FALLBACK_DIR = join(CACHE_DIR, 'fallback');
const SEED_SQL_PATH = join(API_DIR, 'seed', 'exercises.sql');
const WRANGLER_BIN = join(
  REPO_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.CMD' : 'wrangler',
);

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

const EXERCISES_JSON_URL =
  'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json';
const REPO_TARBALL_URL =
  'https://github.com/hasaneyldrm/exercises-dataset/archive/refs/heads/main.tar.gz';
/** Fallback-Einzeldownloads: image/gif_url-Felder sind relativ zum Repo-Root (images/..., videos/...). */
const RAW_BASE_URL = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main';

const MEDIA_BASE_URL = 'https://ascent-api.sweber.workers.dev/media/exercises';
const R2_BUCKET = 'ascent-media';
const D1_DATABASE = 'ascent-db';

/**
 * Fester Namespace fuer die UUIDv5-Ableitung der Uebungs-IDs aus dem
 * Dataset-`id`-Feld ("0001" etc.). NIEMALS aendern -- sonst aendern sich bei
 * einem Re-Import alle IDs und `INSERT OR REPLACE` erzeugt Duplikate statt
 * bestehende Zeilen zu aktualisieren. Einmalig zufaellig generiert
 * (crypto.randomUUID()), hat sonst keine Bedeutung.
 */
const NAMESPACE_UUID = 'ec5d9315-ed75-419f-9601-a508122dff84';

const SQL_BATCH_SIZE = 50;
const MEDIA_PROGRESS_INTERVAL = 25;
const MEDIA_MAX_ATTEMPTS = 3; // 1 Versuch + 2 Retries
const DOWNLOAD_MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Typen (nur erasierbare TS-Syntax -- keine Enums/Namespaces)
// ---------------------------------------------------------------------------

type RawExercise = {
  id: string;
  name: string;
  category: string;
  equipment: string;
  target: string;
  muscle_group?: string;
  secondary_muscles?: string[];
  instructions: { en: string };
  instruction_steps?: { en?: string[] };
  image: string;
  gif_url: string;
};

/**
 * Kuratierte Namens-Uebersetzungen (DE) + orthographisch korrigierte
 * EN-Namen. Generiert via Uebersetzungs-Subagenten, gemergt nach
 * scripts/data/exercise-names.i18n.json (im Repo versioniert).
 */
type NameI18n = Record<string, { en: string; de: string }>;

function loadNameI18n(): NameI18n {
  const path = join(REPO_ROOT, 'scripts', 'data', 'exercise-names.i18n.json');
  if (!existsSync(path)) {
    console.warn('Hinweis: scripts/data/exercise-names.i18n.json fehlt — Namen bleiben unuebersetzt.');
    return {};
  }
  return JSON.parse(readFileSync(path, 'utf8')) as NameI18n;
}

type Target = 'local' | 'remote';

type Flags = Record<string, string | boolean>;

type UploadJob = {
  key: string;
  sourceRelPath: string;
  contentType: string;
};

type Manifest = { uploaded: string[] };

// ---------------------------------------------------------------------------
// CLI-Hilfsfunktionen
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { positionals: string[]; flags: Flags } {
  const flags: Flags = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg?.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg !== undefined) {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function resolveTarget(flags: Flags, subcommand: string): Target {
  const local = Boolean(flags.local);
  const remote = Boolean(flags.remote);
  if (local === remote) {
    throw new Error(`'${subcommand}' braucht genau eine der Optionen --local oder --remote.`);
  }
  return local ? 'local' : 'remote';
}

function resolveLimit(flags: Flags): number | undefined {
  if (flags.limit === undefined) return undefined;
  if (typeof flags.limit !== 'string') {
    throw new Error('--limit braucht einen numerischen Wert (z. B. --limit 5).');
  }
  const n = Number(flags.limit);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Ungueltiger --limit-Wert: ${String(flags.limit)}`);
  }
  return Math.floor(n);
}

function printUsage(): void {
  console.log(`Verwendung:
  node --experimental-strip-types scripts/import-exercises.ts sql [--limit N]
  node --experimental-strip-types scripts/import-exercises.ts media (--local | --remote) [--limit N] [--concurrency N=8]
  node --experimental-strip-types scripts/import-exercises.ts apply (--local | --remote)`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// UUIDv5 (RFC 4122) -- selbst implementiert, da nur Node-Built-ins erlaubt sind
// ---------------------------------------------------------------------------

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) {
    throw new Error(`Ungueltige UUID: ${uuid}`);
  }
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Deterministische UUIDv5 aus `name` innerhalb von `namespace` (SHA-1-basiert). */
function uuidv5(name: string, namespace: string): string {
  const namespaceBytes = uuidToBytes(namespace);
  const nameBytes = Buffer.from(name, 'utf8');
  const hash = createHash('sha1').update(Buffer.concat([namespaceBytes, nameBytes])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // Version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // Variante RFC 4122
  return bytesToUuid(bytes);
}

// ---------------------------------------------------------------------------
// Datenquelle laden (gecacht)
// ---------------------------------------------------------------------------

async function loadExercises(limit?: number): Promise<RawExercise[]> {
  let raw: string;
  if (existsSync(EXERCISES_JSON_CACHE)) {
    console.log(`Verwende Cache: ${EXERCISES_JSON_CACHE}`);
    raw = readFileSync(EXERCISES_JSON_CACHE, 'utf8');
  } else {
    console.log(`Lade Uebungsdaten von ${EXERCISES_JSON_URL} ...`);
    const res = await fetch(EXERCISES_JSON_URL);
    if (!res.ok) {
      throw new Error(`Download von exercises.json fehlgeschlagen: HTTP ${res.status}`);
    }
    raw = await res.text();
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(EXERCISES_JSON_CACHE, raw, 'utf8');
    console.log(`Cache geschrieben: ${EXERCISES_JSON_CACHE}`);
  }
  const all: unknown = JSON.parse(raw);
  if (!Array.isArray(all)) {
    throw new Error('Unerwartetes Format: Wurzel von exercises.json ist kein Array.');
  }
  const exercises = all as RawExercise[];
  const result = limit !== undefined ? exercises.slice(0, limit) : exercises;
  console.log(
    limit !== undefined
      ? `${exercises.length} Uebungen im Dataset, davon ${result.length} verwendet (--limit ${limit}).`
      : `${result.length} Uebungen geladen.`,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Subkommando: sql
// ---------------------------------------------------------------------------

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function cmdSql(flags: Flags): Promise<void> {
  const limit = resolveLimit(flags);
  const exercises = await loadExercises(limit);
  const now = Date.now();

  const nameI18n = loadNameI18n();
  let translated = 0;

  const columns = [
    'id',
    'user_id',
    'name',
    'name_de',
    'category',
    'primary_muscle',
    'equipment',
    'instructions_en',
    'instructions_de',
    'muscle_group',
    'secondary_muscles',
    'instruction_steps_en',
    'thumbnail_url',
    'gif_url',
    'created_at',
    'updated_at',
    'deleted',
  ];

  const rowTuples = exercises.map((ex) => {
    const id = uuidv5(ex.id, NAMESPACE_UUID);
    const i18n = nameI18n[ex.id];
    if (i18n) translated += 1;
    const steps = ex.instruction_steps?.en;
    const values = [
      sqlString(id),
      'NULL', // user_id: global (kein Owner)
      sqlString(i18n?.en ?? ex.name),
      i18n?.de ? sqlString(i18n.de) : 'NULL',
      sqlString(ex.category ?? ''),
      sqlString(ex.target ?? ''),
      sqlString(ex.equipment ?? ''),
      sqlString(ex.instructions?.en ?? ''),
      'NULL', // instructions_de: Uebersetzung folgt spaeter
      ex.muscle_group ? sqlString(ex.muscle_group) : 'NULL',
      Array.isArray(ex.secondary_muscles) && ex.secondary_muscles.length > 0
        ? sqlString(JSON.stringify(ex.secondary_muscles))
        : 'NULL',
      Array.isArray(steps) && steps.length > 0 ? sqlString(JSON.stringify(steps)) : 'NULL',
      sqlString(`${MEDIA_BASE_URL}/${ex.id}.jpg`),
      sqlString(`${MEDIA_BASE_URL}/${ex.id}.gif`),
      String(now),
      String(now),
      '0',
    ];
    return `(${values.join(', ')})`;
  });

  console.log(`Namens-Uebersetzungen angewendet: ${translated}/${exercises.length}`);

  const batches: string[] = [];
  for (let i = 0; i < rowTuples.length; i += SQL_BATCH_SIZE) {
    const batch = rowTuples.slice(i, i + SQL_BATCH_SIZE);
    batches.push(
      `INSERT OR REPLACE INTO exercises (${columns.join(', ')}) VALUES\n  ${batch.join(',\n  ')};`,
    );
  }

  const header = `-- Uebungsdatenbank-Seed fuer Ascent (M2).
-- Automatisch generiert von scripts/import-exercises.ts am ${new Date(now).toISOString()}.
-- NICHT VON HAND BEARBEITEN -- bei Aenderungsbedarf das Script anpassen und neu generieren.
--
-- Quelle: https://github.com/hasaneyldrm/exercises-dataset (Branch main, Datei data/exercises.json).
-- Medien (c) Gym visual -- https://gymvisual.com/, Metadaten MIT-lizenziert.
-- Nicht-kommerzielle private Nutzung -- vor Aktivierung von Freemium/Abos ersetzen
-- (siehe Technisches_Konzept_MVP.md Abschnitt 6 und PROJEKTSTATUS.md "Offene Punkte").
--
-- IDs sind deterministische UUIDv5 aus der Dataset-ID -- Re-Importe sind idempotent
-- (INSERT OR REPLACE aktualisiert bestehende Zeilen statt Duplikate anzulegen).
--
-- Anwenden via: node --experimental-strip-types scripts/import-exercises.ts apply (--local|--remote)
-- Anzahl Uebungen: ${exercises.length}, Batches: ${batches.length} (je bis zu ${SQL_BATCH_SIZE} Zeilen)
`;

  const sql = `${header}\n${batches.join('\n\n')}\n`;
  mkdirSync(dirname(SEED_SQL_PATH), { recursive: true });
  writeFileSync(SEED_SQL_PATH, sql, 'utf8');
  console.log(
    `Geschrieben: ${SEED_SQL_PATH} (${exercises.length} Uebungen in ${batches.length} Batches)`,
  );
}

// ---------------------------------------------------------------------------
// Subkommando: media
// ---------------------------------------------------------------------------

function repoMediaAvailable(): boolean {
  const imagesDir = join(REPO_EXTRACT_DIR, 'images');
  const videosDir = join(REPO_EXTRACT_DIR, 'videos');
  return (
    existsSync(imagesDir) &&
    existsSync(videosDir) &&
    readdirSync(imagesDir).length > 0 &&
    readdirSync(videosDir).length > 0
  );
}

/** Laedt/entpackt das Repo-Tarball genau einmal. Bei Fehlschlag greift der Einzeldownload-Fallback pro Datei. */
async function ensureRepoMedia(): Promise<void> {
  if (repoMediaAvailable()) {
    console.log(`Repo-Medien bereits vorhanden: ${REPO_EXTRACT_DIR}`);
    return;
  }
  try {
    if (!existsSync(REPO_TARBALL_CACHE)) {
      console.log(`Lade Repo-Tarball von ${REPO_TARBALL_URL} ...`);
      const res = await fetch(REPO_TARBALL_URL);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(REPO_TARBALL_CACHE, buf);
      console.log(`Tarball gespeichert: ${REPO_TARBALL_CACHE} (${buf.length} Bytes)`);
    } else {
      console.log(`Verwende gecachtes Tarball: ${REPO_TARBALL_CACHE}`);
    }
    mkdirSync(REPO_EXTRACT_DIR, { recursive: true });
    const result = spawnSync(
      'tar',
      ['-xzf', REPO_TARBALL_CACHE, '-C', REPO_EXTRACT_DIR, '--strip-components=1'],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) {
      throw new Error(`tar-Entpacken fehlgeschlagen (Exit-Code ${result.status})`);
    }
    console.log('Tarball entpackt.');
  } catch (err) {
    console.warn(
      `Tarball-Weg fehlgeschlagen (${err instanceof Error ? err.message : String(err)}) -- ` +
        'falle zurueck auf Einzeldownloads pro Datei.',
    );
  }
}

async function downloadWithRetries(url: string, dest: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} bei ${url}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < DOWNLOAD_MAX_ATTEMPTS) {
        await sleep(500 * attempt);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Liefert einen lokalen Dateipfad fuer `relPath` (z. B. "images/0001-xyz.jpg"). */
async function resolveLocalMediaPath(relPath: string): Promise<string> {
  const extracted = join(REPO_EXTRACT_DIR, relPath);
  if (existsSync(extracted)) {
    return extracted;
  }
  const fallbackDest = join(FALLBACK_DIR, relPath);
  if (existsSync(fallbackDest)) {
    return fallbackDest;
  }
  await downloadWithRetries(`${RAW_BASE_URL}/${relPath}`, fallbackDest);
  return fallbackDest;
}

function r2Put(key: string, filePath: string, contentType: string, target: Target): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = [
      'r2',
      'object',
      'put',
      `${R2_BUCKET}/${key}`,
      '--file',
      filePath,
      '--content-type',
      contentType,
      target === 'local' ? '--local' : '--remote',
    ];
    const child = spawn(WRANGLER_BIN, args, {
      cwd: API_DIR,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(
          new Error(`wrangler r2 object put ${key} fehlgeschlagen (Exit ${code}): ${stderr || stdout}`),
        );
      }
    });
  });
}

async function uploadWithRetries(job: UploadJob, target: Target): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MEDIA_MAX_ATTEMPTS; attempt++) {
    try {
      const filePath = await resolveLocalMediaPath(job.sourceRelPath);
      await r2Put(job.key, filePath, job.contentType, target);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < MEDIA_MAX_ATTEMPTS) {
        await sleep(300 * attempt);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function manifestPathFor(target: Target): string {
  return join(CACHE_DIR, `uploaded-${target}.json`);
}

function loadManifest(path: string): Manifest {
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<Manifest>;
      if (Array.isArray(data.uploaded)) {
        return { uploaded: data.uploaded };
      }
    } catch {
      // Korruptes Manifest -- wird beim Speichern neu geschrieben.
    }
  }
  return { uploaded: [] };
}

function saveManifest(path: string, manifest: Manifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf8');
}

async function cmdMedia(flags: Flags): Promise<void> {
  const target = resolveTarget(flags, 'media');
  const limit = resolveLimit(flags);
  if (flags.concurrency !== undefined && typeof flags.concurrency !== 'string') {
    throw new Error('--concurrency braucht einen numerischen Wert (z. B. --concurrency 8).');
  }
  const concurrency = flags.concurrency ? Number(flags.concurrency) : 8;
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error(`Ungueltiger --concurrency-Wert: ${String(flags.concurrency)}`);
  }

  const exercises = await loadExercises(limit);
  await ensureRepoMedia();

  const jobs: UploadJob[] = [];
  for (const ex of exercises) {
    jobs.push({ key: `exercises/${ex.id}.jpg`, sourceRelPath: ex.image, contentType: 'image/jpeg' });
    jobs.push({ key: `exercises/${ex.id}.gif`, sourceRelPath: ex.gif_url, contentType: 'image/gif' });
  }
  const totalJobs = jobs.length;

  const manifestPath = manifestPathFor(target);
  const manifest = loadManifest(manifestPath);
  const uploadedSet = new Set(manifest.uploaded);
  const pendingJobs = jobs.filter((j) => !uploadedSet.has(j.key));

  console.log(
    `${totalJobs} Objekte gesamt (${target}), ${totalJobs - pendingJobs.length} laut Manifest ` +
      `bereits hochgeladen, ${pendingJobs.length} ausstehend. Konkurrenz: ${concurrency}.`,
  );

  const errors: { key: string; error: string }[] = [];
  let cursor = 0;
  let uploadedThisRun = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor++;
      if (index >= pendingJobs.length) return;
      const job = pendingJobs[index];
      if (!job) return;
      try {
        await uploadWithRetries(job, target);
        uploadedSet.add(job.key);
        manifest.uploaded.push(job.key);
        uploadedThisRun++;
        if (uploadedThisRun % MEDIA_PROGRESS_INTERVAL === 0) {
          console.log(`Fortschritt: ${uploadedSet.size}/${totalJobs}`);
          saveManifest(manifestPath, manifest);
        }
      } catch (err) {
        errors.push({ key: job.key, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const workerCount = Math.min(concurrency, pendingJobs.length) || 1;
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  saveManifest(manifestPath, manifest);

  if (errors.length > 0) {
    console.error(`\n${errors.length} Fehler beim Medien-Upload:`);
    for (const e of errors) {
      console.error(`  - ${e.key}: ${e.error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Fertig: ${uploadedSet.size}/${totalJobs} Objekte in R2 (${target}).`);
  }
}

// ---------------------------------------------------------------------------
// Subkommando: apply
// ---------------------------------------------------------------------------

async function cmdApply(flags: Flags): Promise<void> {
  const target = resolveTarget(flags, 'apply');
  if (!existsSync(SEED_SQL_PATH)) {
    throw new Error(`SQL-Datei fehlt: ${SEED_SQL_PATH} -- zuerst 'sql' ausfuehren.`);
  }
  const relSqlPath = relative(API_DIR, SEED_SQL_PATH);
  const args = [
    'd1',
    'execute',
    D1_DATABASE,
    target === 'local' ? '--local' : '--remote',
    '--file',
    relSqlPath,
    '-y',
  ];
  console.log(`Fuehre aus (cwd=${API_DIR}): wrangler ${args.join(' ')}`);
  const result = spawnSync(WRANGLER_BIN, args, { cwd: API_DIR, shell: true, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute fehlgeschlagen (Exit-Code ${result.status})`);
  }
}

// ---------------------------------------------------------------------------
// Einstiegspunkt
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2);
  const { flags } = parseArgs(rest);

  switch (subcommand) {
    case 'sql':
      await cmdSql(flags);
      break;
    case 'media':
      await cmdMedia(flags);
      break;
    case 'apply':
      await cmdApply(flags);
      break;
    default:
      printUsage();
      process.exitCode = subcommand ? 1 : 0;
  }
}

main().catch((err: unknown) => {
  console.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
