# E2E-Smoke — autonome Backend-Prüfung ohne Gerät

`e2e-smoke.ts` fährt einen kompletten Client-Flow gegen eine laufende Ascent-API
und prüft genau die Verträge, die App und Web-Dashboard über die Leitung nutzen —
**ohne Emulator, Gerät oder manuelles Sideloading**. Damit lässt sich nach jeder
Backend-, Schema- oder Sync-Änderung in Sekunden verifizieren, dass die gesamte
Datenschicht hinter den App-Screens funktioniert.

Läuft wie das Import-Script nur mit Node-Built-ins (kein Extra-Paket):

```sh
pnpm e2e                          # Default-Ziel http://127.0.0.1:8787
pnpm e2e -- --verbose             # zusätzliche Detailausgaben
pnpm e2e -- --base http://127.0.0.1:8787
```

## Was getestet wird (20 Schritte)

| Bereich | Prüfung |
|---|---|
| Health/Version | `/health` ok, `/version` liefert `latestVersion` |
| Zugriffsschutz | Datenrouten ohne Session → 401 |
| Auth | Bootstrap-Registrierung (Lauf 1) bzw. Login (fester Account); Session-Cookie |
| Profil/Entitlements | `/profile` spiegelt den Nutzer; `/entitlements` löst Tier `free` korrekt auf (Basis frei, Pro gesperrt) |
| Übungen | `/exercises?q=` liefert Treffer **mit deutschem Namen** (`nameDe`) und Medien-URL |
| Medien | Übungs-Thumbnail wird über `/media/*` ausgeliefert |
| Plan-CRUD | Plan anlegen, Übung anhängen, `/plans/:id` enthält sie |
| Workout | starten, Satz loggen, beenden; `/workouts/:id` zeigt den Satz |
| Sync-Pull | Plan, Workout und Satz kommen im Voll-Pull zurück |
| Sync-Push | offline erfasster Körpermass-Wert → `applied`, wieder auslesbar |
| Invites | Code erstellen; Partner registriert sich damit |
| Ownership | Partner sieht/liest fremde Pläne NICHT (kein Datenleck: 404 statt 403) |
| Invite-Verbrauch | verbrauchter Code ist nicht wiederverwendbar |

Exit-Code 0 = alles grün, 1 = mindestens ein Schritt rot (mit Fehlerdetails).

## Voraussetzung: laufende API mit frischer lokaler D1

Der Test schreibt Daten. **Nur gegen eine lokale/Test-API laufen lassen** — gegen
die Produktions-URL (`workers.dev`) verweigert das Script den Start, ausser mit
`--allow-remote` (dann entstehen dort Wegwerf-Testkonten; nur bewusst nutzen).

Wiederholbarkeit: Der Primär-Account (`e2e-primary@ascent.test`) ist fest — der
allererste Lauf gegen eine leere DB **bootstrappt** ihn (erste Registrierung
braucht keinen Invite-Code), jeder weitere Lauf **loggt sich ein**. Der Partner
ist pro Lauf frisch (Invite-Codes sind einmalig). So läuft der Test beliebig oft
ohne DB-Reset.

Frische lokale D1 herstellen (nötig einmalig bzw. wenn fremde Nutzer die
Bootstrap-Registrierung blockieren):

```sh
# 1. Lokalen D1-Zustand löschen (Windows PowerShell)
Remove-Item apps/api/.wrangler/state/v3/d1 -Recurse -Force
# 2. Migrationen + Seeds
pnpm --filter @ascent/api db:migrate:local
pnpm --filter @ascent/api db:seed:local
node --experimental-strip-types scripts/import-exercises.ts apply --local
# 3. Worker starten (eigenes Terminal), dann in einem zweiten:
pnpm --filter @ascent/api dev
pnpm e2e
```

Verifiziert am 20.07.2026: 20/20 grün gegen lokale D1, über zwei aufeinander-
folgende Läufe (Bootstrap + Wiederanmeldung) hinweg stabil.
