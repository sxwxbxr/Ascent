# Übungsdatenbank-Import (M2)

Importiert das öffentliche Übungsdataset [`hasaneyldrm/exercises-dataset`](https://github.com/hasaneyldrm/exercises-dataset)
(Branch `main`, ~1'324 Übungen) in die `exercises`-Tabelle (global, `user_id IS NULL`)
und lädt die zugehörigen Thumbnails/GIFs nach R2 (`ascent-media/exercises/`).

Das Script (`import-exercises.ts`) läuft **ausschliesslich mit Node-Built-ins**
(kein `pnpm install`, kein zusätzliches Paket) via Node 22's Type-Stripping:

```sh
node --experimental-strip-types scripts/import-exercises.ts <subcommand> [optionen]
```

Voraussetzungen: Node ≥ 22 (getestet mit 22.19), `wrangler` bereits im Repo-Root
installiert (`node_modules/.bin/wrangler`, via `pnpm install` im Monorepo), sowie
`tar` im PATH (Windows 11 bringt `bsdtar` bereits mit, Linux/macOS haben `tar`
ohnehin). Für `--local`-Läufe braucht es sonst nichts weiter; für `--remote`
muss `wrangler` gegen den Cloudflare-Account eingeloggt sein (`wrangler login`).

> Hinweis: Beim Ausführen erscheint eine harmlose Node-Warnung
> (`MODULE_TYPELESS_PACKAGE_JSON` / "Reparsing as ES module") auf stderr, weil
> `scripts/` bewusst kein eigenes `package.json` mit `"type": "module"` hat
> (Datei-Eigentum ist auf `import-exercises.ts`, `README.md`, `.gitignore`
> beschränkt). Die Warnung hat keinen Einfluss auf Funktion oder Exit-Code.

## Subkommandos

### 1. `sql` — SQL-Seed generieren

```sh
node --experimental-strip-types scripts/import-exercises.ts sql [--limit N]
```

- Lädt `data/exercises.json` vom Dataset-Repo (gecacht unter
  `scripts/.cache/exercises.json`; bei vorhandenem Cache kein erneuter Download).
- Transformiert jede Übung in eine Zeile für `exercises` (siehe
  `packages/shared/src/db/schema.ts`): `id` ist eine **deterministische UUIDv5**
  aus der Dataset-`id` (fester Namespace, RFC-4122 v5, selbst implementiert via
  `node:crypto`/SHA-1) — Re-Importe sind dadurch idempotent
  (`INSERT OR REPLACE` aktualisiert bestehende Zeilen statt Duplikate
  anzulegen). `user_id`/`name_de`/`instructions_de` sind `NULL` (global,
  Übersetzung folgt später). `thumbnail_url`/`gif_url` zeigen auf
  `https://ascent-api.sweber.workers.dev/media/exercises/{datasetId}.{jpg,gif}`.
- Schreibt `apps/api/seed/exercises.sql`: Kopfkommentar mit Quelle und
  Lizenz-/Attributionshinweis, danach `INSERT OR REPLACE`-Statements in
  Batches von 50 Zeilen (mehrere `VALUES`-Tupel pro Statement). Single-Quotes
  werden SQL-korrekt verdoppelt (`''`), `NULL` steht unquotiert.
- `--limit N` beschränkt auf die ersten N Einträge des JSON-Arrays (Reihenfolge
  im Dataset ist alphabetisch nach Name, **nicht** nach Dataset-ID) — nützlich
  zum schnellen Verifizieren.

### 2. `media` — Medien nach R2 hochladen

```sh
node --experimental-strip-types scripts/import-exercises.ts media (--local | --remote) [--limit N] [--concurrency N=8]
```

- Beschafft Thumbnails/GIFs bevorzugt **einmalig** als Repo-Tarball
  (`scripts/.cache/repo.tar.gz`, entpackt nach `scripts/.cache/repo/` via
  `tar -xzf ... --strip-components=1`, ~130 MB). Ist das Tarball bereits
  entpackt (Marker: `repo/images/` und `repo/videos/` nicht leer), wird nichts
  erneut geladen. Schlägt der Tarball-Weg fehl (Download- oder Entpackfehler),
  fällt das Script automatisch auf **Einzeldownloads** von
  `raw.githubusercontent.com` pro fehlender Datei zurück (3 Versuche mit
  Backoff, Ablage unter `scripts/.cache/fallback/`).
- Lädt pro Übung Thumbnail (`.jpg`) + GIF (`.gif`) via
  `wrangler r2 object put ascent-media/exercises/{datasetId}.{jpg,gif} --file <pfad> --content-type ... (--local|--remote)`
  hoch. `wrangler` wird mit `cwd = apps/api` gestartet (damit `wrangler.jsonc`
  und der Login greifen); unter Windows via `child_process.spawn` mit
  `shell: true`, da `wrangler.CMD` kein natives Executable ist.
- **Parallelität**: `--concurrency` (Default 8) simultane Worker über eine
  einfache Index-basierte Promise-Queue.
- **Resume/Idempotenz**: Manifest `scripts/.cache/uploaded-{local|remote}.json`
  listet erfolgreich hochgeladene R2-Keys; bereits gelistete werden
  übersprungen (wird alle 25 Dateien zwischengespeichert, damit ein Abbruch
  wenig Fortschritt kostet). Zweiter Lauf mit denselben Parametern überspringt
  alles bereits Hochgeladene.
- **Fehler**: pro Datei 2 Retries (3 Versuche gesamt), danach Sammlung in einer
  Fehlerliste, die am Ende ausgegeben wird; Exit-Code 1 falls Fehler übrig
  bleiben. Fortschritt wird alle 25 Dateien geloggt (`x/2648` bei vollem Lauf).

### 3. `apply` — SQL-Seed anwenden

```sh
node --experimental-strip-types scripts/import-exercises.ts apply (--local | --remote)
```

Führt `wrangler d1 execute ascent-db (--local|--remote) --file <relativer Pfad
zu apps/api/seed/exercises.sql> -y` aus (cwd `apps/api`, Pfad wird per
`node:path.relative` korrekt gebaut statt hartcodiert). Erwartet, dass zuvor
`sql` gelaufen ist.

## Cache-Verzeichnis

`scripts/.cache/` ist gitignored (`scripts/.gitignore`). Inhalt:

| Datei/Ordner | Inhalt |
|---|---|
| `exercises.json` | Dataset-JSON (Download-Cache) |
| `repo.tar.gz` | Repo-Tarball (Download-Cache) |
| `repo/` | Entpacktes Tarball (`images/`, `videos/`, …) |
| `fallback/` | Einzeln nachgeladene Mediendateien (nur falls Tarball-Weg fehlschlägt) |
| `uploaded-local.json` / `uploaded-remote.json` | Upload-Manifeste pro Ziel |

Löschen des ganzen Ordners erzwingt einen kompletten Neu-Download beim
nächsten Lauf; einzelne Dateien/Manifeste können gezielt gelöscht werden, um
z. B. einen Re-Upload zu erzwingen.

## Prod-Rollout (durch den Orchestrator, NICHT durch dieses Script-Testing)

Reihenfolge:

```sh
node --experimental-strip-types scripts/import-exercises.ts media --remote
node --experimental-strip-types scripts/import-exercises.ts apply --remote
```

(`sql` muss vorher lokal schon gelaufen sein und `apps/api/seed/exercises.sql`
muss committet/vorhanden sein — das Script generiert reines SQL ohne
Umgebungsbezug, ein erneuter `sql`-Lauf vor `apply --remote` schadet aber
nicht und hält die Datei aktuell.)

**Laufzeitschätzung `media --remote`**: lokal gemessen (`--local`, Dateien
bereits im Tarball-Cache, `--concurrency 8`) dauerten 100 Objekte (50 Übungen)
rund 50 Sekunden (~0.5 s/Objekt) — die Zeit pro Objekt wird praktisch komplett
vom `wrangler`-Prozessstart dominiert, nicht vom Dateisystem. Hochgerechnet auf
alle 2'648 Objekte (1'324 Übungen × 2 Dateien): **~22 Minuten** als
lokale Untergrenze. Für `--remote` kommt echte Netzwerklatenz zu Cloudflare
pro Prozessaufruf hinzu (Auth, Upload-Roundtrip) — plant realistisch mit
**30–45 Minuten** für den vollständigen Erstlauf. Dank Manifest-Resume ist ein
Abbruch/Neustart verlustfrei (einfach denselben Befehl erneut ausführen).

## Lizenz-/Attributionshinweis

Der Kopfkommentar in `apps/api/seed/exercises.sql` enthält den vollständigen
Hinweis: Medien © Gym visual — https://gymvisual.com/, Metadaten
MIT-lizenziert; aktuell nur für nicht-kommerzielle private Nutzung — **vor
Aktivierung von Freemium/Abos muss die Übungsdatenbank ersetzt werden** (siehe
`Technisches_Konzept_MVP.md` Abschnitt 6 und `PROJEKTSTATUS.md` "Offene
Punkte").
