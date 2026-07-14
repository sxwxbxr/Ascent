# Technisches Konzept – Weg zum MVP
### Basierend auf dem Lastenheft (Stand 14.07.2026)

Dieses Dokument übersetzt den MVP-Scope aus dem Lastenheft (Abschnitt 2) in eine konkrete technische Architektur und einen Etappenplan. Es deckt bewusst nur Version 1 ab; Ausbaustufen (Ausdauer, Ernährung, Social, KI) werden nur dort berücksichtigt, wo Architekturentscheidungen sie später ermöglichen müssen.

---

## 1. Stack-Entscheidung

**Empfehlung: TypeScript durchgängig.** Eine Sprache für App, Web und Backend, gemeinsame Typen und Logik (z. B. 1RM-Berechnung, Validierung) in einem Shared-Package. Das schlägt den .NET-MAUI-Weg trotz vorhandener C#-Erfahrung, weil der Stitch-Design-Export (HTML/Tailwind) fast 1:1 in React/React-Native-Styling übersetzbar ist und Cloudflare (Free-Tier, siehe Lastenheft Abschnitt 6) ein TypeScript-natives Ökosystem ist.

| Schicht | Technologie | Begründung |
|---|---|---|
| Android-App | **Expo (React Native)** + NativeWind | Tailwind-Klassen aus dem Stitch-Export wiederverwendbar; Expo liefert APK-Builds, lokale Notifications (Pausentimer) und SQLite out of the box |
| Web-Dashboard | **React SPA (Vite)** + Tailwind + Recharts | Kein SEO/SSR nötig (privates Produkt) → SPA statt Next.js hält Deployment auf Cloudflare Pages trivial |
| Backend/API | **Cloudflare Workers + Hono** | Free-Tier, kein Server-Betrieb, HTTPS inklusive |
| Datenbank | **Cloudflare D1** (SQLite) + Drizzle ORM | Free-Tier reicht für 2-3 Nutzer locker; Drizzle-Schema teilt Typen mit den Clients |
| Medien (GIFs/Bilder) | **Cloudflare R2** | Free-Tier 10 GB, reicht für die ~1'300 Übungs-GIFs |
| Auth | **Better Auth** (Email/Passwort, Sessions) | Läuft nativ auf Workers; Passwort-Hashing mit scrypt¹ |
| Monorepo | **pnpm Workspaces** | `apps/mobile`, `apps/web`, `apps/api`, `packages/shared` |

¹ *Abweichung vom Lastenheft (Abschnitt 5, «bcrypt/argon2»): Workers haben keine nativen Bindings für argon2/bcrypt. scrypt ist ein gleichwertig anerkannter memory-harter KDF und erfüllt die Anforderung sinngemäss. Im Lastenheft bei Gelegenheit nachziehen.*

---

## 2. Architektur-Überblick

```
┌─────────────────┐        ┌──────────────────────┐
│  Android (Expo)  │        │  Web-Dashboard (SPA)  │
│  lokale SQLite   │        │  Login, Statistik,    │
│  Offline-First   │        │  Pläne, APK-Download  │
└────────┬────────┘        └──────────┬───────────┘
         │  Sync-API (Pull/Push)      │  REST
         ▼                            ▼
┌─────────────────────────────────────────────────┐
│      Cloudflare Worker (Hono, REST-API)         │
│  Auth · CRUD · Sync · Entitlements · version.json│
└──────┬──────────────────┬───────────────────────┘
       ▼                  ▼
   D1 (SQLite)        R2 (GIFs, APK-Datei)
```

Die App arbeitet **offline-first**: alle Schreiboperationen gehen zuerst in die lokale SQLite, der Sync läuft im Hintergrund. Das Web-Dashboard spricht direkt mit der API (immer online).

---

## 3. Datenmodell (Kern-Tabellen)

| Tabelle | Zweck / wichtige Felder |
|---|---|
| `users` | Profil (Name, Alter, Geschlecht, Gewicht, Grösse, Ziel) |
| `exercises` | Importierte + eigene Übungen; `user_id` nullable (null = global), Kategorie, Zielmuskel, Equipment, Medien-URLs (R2), Anleitung |
| `plans` | Trainingspläne pro Nutzer |
| `plan_exercises` | Übungen im Plan: Reihenfolge, Ziel-Sätze/-Wiederholungen, Pausenzeit |
| `workouts` | Trainingseinheit: `started_at`, `finished_at`, optional `plan_id` |
| `workout_sets` | Satz: `exercise_id`, Gewicht, Wiederholungen, `completed_at` |
| `body_metrics` | Gewicht/Körperfett-Verlauf (für Dashboard) |
| `feature_flags` | `feature_key`, `required_tier` (`free`/`pro`), `enabled` — zentrale Entitlement-Konfiguration |

**Sync-relevante Konventionen auf allen synchronisierten Tabellen:** client-generierte UUIDs als Primärschlüssel, `updated_at`, `deleted` (Soft-Delete). Damit funktionieren Offline-Erstellung und Konfliktauflösung ohne ID-Kollisionen.

---

## 4. Offline-Sync (Muss-Anforderung, Lastenheft 5)

Bewusst einfaches Pull/Push-Verfahren statt CRDT-Framework — bei 2-3 Nutzern, die praktisch nie dasselbe Objekt gleichzeitig auf zwei Geräten bearbeiten, reicht das:

1. **Push:** Client sendet alle lokal geänderten Zeilen (dirty-Flag) mit `updated_at`.
2. **Pull:** Client fragt «alles seit meinem letzten Sync-Cursor» ab (pro Tabelle ein Cursor).
3. **Konflikt:** Last-Write-Wins auf Zeilenebene anhand `updated_at`. Workout-Sätze sind append-only, dort gibt es faktisch keine Konflikte.
4. Sync-Trigger: App-Start, Workout-Abschluss, Netzwerk-Wiederkehr.

---

## 5. Entitlements / Feature-Flags (Architektur-Anforderung, Lastenheft 3)

Von Tag 1 eingebaut, auch wenn im MVP alles kostenlos ist:

- `feature_flags`-Tabelle in D1, editierbar ohne Code-Änderung (SQL/kleines Admin-Script).
- API-Endpoint `GET /entitlements` liefert dem Client die aufgelöste Map `feature → erlaubt`.
- Clients gaten UI ausschliesslich über einen `useEntitlement('stats.advanced')`-Hook, nie über hartcodierte Bedingungen.
- User bekommen ein `tier`-Feld (`free`/`trial`/`pro`); Stripe-Anbindung und Rate-Limits kommen erst nach dem MVP, docken aber an genau dieses Feld an.

---

## 6. Übungsdatenbank-Import

Einmaliges Import-Script (`scripts/import-exercises.ts`):

1. JSON aus [exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) laden (~1'300 Übungen).
2. Thumbnails + GIFs nach R2 hochladen, URLs in `exercises` schreiben.
3. Anleitungstexte vorerst auf Englisch belassen (gemäss Lastenheft akzeptiert), Feld für deutsche Übersetzung vorsehen.

⚠️ **Lizenz-Gate:** Datensatz ist nur nicht-kommerziell nutzbar. Für den privaten MVP ok — **vor Aktivierung des Abo-Modells zwingend ersetzen** (eigene Medien oder kommerzielle Lizenz, z. B. ExerciseDB.io). Dieses Gate im Backlog als Blocker vor «Monetarisierung live» führen.

---

## 7. Kraftsteigerung-Prognose (statistisch, kostenlos)

- Pro Übung und Trainingseinheit: bester Satz → geschätztes 1RM nach Epley: `gewicht × (1 + wdh/30)`.
- Lineare Regression über die 1RM-Werte der letzten Einheiten → Trendlinie.
- Anzeige erst ab 3 Einheiten pro Übung (Lastenheft: 3-5).
- Implementierung als reine Funktion in `packages/shared` — läuft identisch in App und Web, kein Server-Compute nötig.

---

## 8. APK-Verteilung & Updates (Lastenheft 4.11)

- **Build:** `expo prebuild` + Gradle-Release-Build lokal (oder EAS-Build Free-Tier), signiert mit eigenem Keystore. **Keystore sicher extern sichern** — Verlust = Nutzer müssen neu installieren.
- **Verteilung:** APK in R2, Download-Seite im Web-Dashboard mit Schritt-für-Schritt-Sideloading-Anleitung.
- **Update-Check:** Worker-Endpoint liefert `version.json` (`latestVersion`, `apkUrl`, `changelog`); App vergleicht beim Start und zeigt Update-Hinweis (Soll-Anforderung).
- **Push-Notifications:** Timer-Ende als *lokale* Notification (kein Server nötig). Trainingserinnerungen via Expo Push/FCM — funktioniert auch bei Sideloading, solange Google-Play-Dienste auf dem Gerät sind.

---

## 9. Repo-Struktur

```
apps/
  mobile/        Expo-App (Android)
  web/           React SPA (Dashboard, Download-Seite)
  api/           Cloudflare Worker (Hono)
packages/
  shared/        Typen, Drizzle-Schema, 1RM/Trendlinie, Validierung
scripts/
  import-exercises.ts
design/          Stitch-Export (bestehend)
```

CI: GitHub Actions — Typecheck + Tests auf jeden Push, API/Web-Deploy nach Cloudflare via Wrangler.

---

## 10. Etappenplan

Jede Etappe endet mit etwas Benutzbarem; Reihenfolge minimiert Risiko (Sync und Offline sind die heikelsten Teile und kommen früh).

| # | Etappe | Inhalt | Fertig wenn… |
|---|---|---|---|
| M0 | Fundament | Monorepo, CI, Cloudflare-Setup (Worker, D1, R2), Drizzle-Schema | `pnpm dev` startet alle drei Apps, Deploy-Pipeline grün |
| M1 | Backend-Kern | Auth (Registrierung, Login, Passwort-Reset), CRUD für Pläne/Workouts, Sync-Endpoints, Entitlement-Endpoint | API-Tests grün, Auth-Flow via REST durchspielbar |
| M2 | Übungsdatenbank | Import-Script, GIFs in R2, Übungs-API mit Suche/Filter | 1'300 Übungen inkl. GIF über API abrufbar |
| M3 | Android-Kern | Login, Plan-Editor, Übungsauswahl, aktives Training (Satz-Logging, Pausentimer), lokale SQLite, eigene Übungen | Komplettes Workout offline im Flugmodus erfassbar |
| M4 | Sync | Pull/Push-Sync App ↔ Backend, Multi-Device-Test | Workout auf Gerät A offline erfasst → nach Reconnect im Web sichtbar |
| M5 | Web-Dashboard | Login, Basis-Charts (Fortschritt, Körpergewicht), Trendlinie, Trainingskalender/Verlauf, Planverwaltung, APK-Download-Seite | Alle MVP-Dashboard-Anforderungen (Lastenheft 2) im Browser nutzbar |
| M6 | Release | Design-System-Polish (design/), deutsche UI-Texte, APK-Signing, version.json-Update-Check, D1-Backup-Job | Signierte APK installiert, Trainingspartner können eingeladen werden |

---

## 11. Risiken & offene Punkte

| Risiko | Umgang |
|---|---|
| Lizenz exercises-dataset (nicht-kommerziell) | Blocker-Task vor Monetarisierung; MVP unkritisch |
| scrypt statt bcrypt/argon2 | Dokumentierte, gleichwertige Abweichung; Lastenheft anpassen |
| Keystore-Verlust | Backup an zwei Orten ausserhalb des Repos, direkt bei M6 |
| FCM ohne Google-Play-Dienste (z. B. de-googelte Geräte) | Akzeptiert; Timer läuft lokal, Erinnerungen degradieren graceful |
| D1/R2-Free-Tier-Limits | Bei 2-3 Nutzern irrelevant; Monitoring-Task in Ausbaustufe |
| Umlaut-verstümmelte Ordnernamen im Design-Export | Kosmetisch; bei Bedarf umbenennen |

**Bewusst NICHT im MVP:** Stripe/Abo-Abwicklung, Trial-Rate-Limits, KI-Features, Ausdauer/Ernährung, Google Fit, 2FA, OAuth — die Architektur (Entitlements, `tier`-Feld, modulares Schema) hält die Türen dafür offen, gebaut wird davon nichts.
