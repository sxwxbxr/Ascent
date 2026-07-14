# Lastenheft – Fitness-App
### Brainstorming-Entwurf, Stand: 14.07.2026 (aktualisiert)

**Hinweis zur Priorisierung:**
- **Muss** = zwingend erforderlich, ohne das die App nicht funktioniert
- **Soll** = wichtig, aber nicht zwingend für Version 1
- **Kann** = optional, Nice-to-have, spätere Ausbaustufe

---

## 1. Zielbestimmung

**Zweck:** Eigene Fitness-App zur Trainings- und Fortschrittsdokumentation, mit Login und Statistikansicht.

**Nutzerkreis:** Zunächst nur für dich selbst, perspektivisch auch 1-2 Trainingspartner aus dem Gym. Kein öffentliches Produkt, daher können Skalierung, Admin-Tooling und Social-Features bewusst schlank gehalten werden.

**Inhaltlicher Fokus:** Krafttraining, Ausdauersport und Ernährung sind langfristig gleich wichtig. Der erste Build legt das Fundament beim Krafttraining, weil dort die Kernlogik entsteht, die später auf Ausdauer und Ernährung übertragen wird (siehe MVP-Scope).

**Plattformen:** Android-App (aktives Tracking im Gym/unterwegs) und Browser-Anwendung (Login, Auswertung, Verwaltung).

**Verteilung:** Vorerst kein Play Store und kein Apple App Store (Kostengründe), App wird direkt als APK zum Sideloading bereitgestellt. iOS ist damit vorerst nicht im Scope.

**Monetarisierung:** Freemium-Modell, alle MVP-Grundfunktionen kostenlos, KI-Funktionen sind Abo-pflichtig. 5 CHF/Monat oder 50 CHF/Jahr, 14 Tage Trial-Phase mit Rate-Limit (Details siehe Abschnitt 3).

---

## 2. MVP-Scope (Version 1)

Der erste funktionierende Build fokussiert sich auf den Krafttraining-Tracker als Fundament:

| Feature | Beschreibung |
|---|---|
| Login & Sync | Email/Passwort-Login, Multi-Device-Sync Android + Web |
| Trainingsplan-Tracker | Trainingspläne erstellen und im Training abarbeiten |
| Workout-Log | Gewicht & Wiederholungen pro Übung erfassen |
| Übungsdatenbank mit Beispiel | Jede Übung mit Beispiel der korrekten Ausführung (Bild/GIF), Basis-Daten importiert aus [exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset), siehe Lizenzhinweis in Abschnitt 6 |
| Kraftsteigerung-Prognose | Trendlinie berechnet aus dem Verlauf mehrerer vorheriger Trainingseinheiten, rein statistisch, keine KI nötig |
| Statistik-Dashboard (Browser) | Fortschritt anschaulich visualisiert, im Browser abrufbar |

Alles Weitere aus der Gesamtliste unten (Ausdauer, Ernährung, Social, KI-Features etc.) ist Teil der geplanten Ausbaustufen nach dem ersten funktionierenden Build.

---

## 3. Monetarisierung / Freemium-Modell

**Modell:** Freemium. Alle Grundfunktionen des MVP sind kostenlos. Alle KI-Funktionen setzen ein Abo voraus. Weitere Post-MVP-Funktionen werden im Einzelfall je nach Komplexität und Nutzen dem kostenlosen oder dem Abo-Bereich zugeordnet, die konkrete Zuordnung erfolgt erst nach einer Testphase, wenn Nutzungsdaten vorliegen.

**Preismodell:**

| Plan | Preis |
|---|---|
| Monatlich | 5 CHF/Monat |
| Jährlich | 50 CHF/Jahr |
| Trial | 14 Tage, mit striktem Rate-Limit auf KI-Funktionen |

| Bereich | Kostenlos / Abo |
|---|---|
| MVP-Grundfunktionen (Login, Trainingsplan-Tracker, Workout-Log, Übungsdatenbank, Kraftsteigerung-Prognose, Basis-Statistik-Dashboard Browser) | Kostenlos |
| KI-Funktionen (Trainingsvorschläge, weitere später) | Abo-pflichtig |
| Statistiken in der App (Android) | Abo-pflichtig |
| Erweiterte Statistik im Browser (über die Basis-Charts hinaus, z. B. PRs, Muskelgruppen-Volumen, Zeitraumvergleiche, Export) | Abo-pflichtig |
| Weitere Post-MVP-Funktionen (Ausdauer, Ernährung, Social, Gamification, Integrationen) | Noch offen, wird nach Testphase gemeinsam entschieden |

**Wichtige Architektur-Anforderung:** Grundsätzlich soll sich jedes Feature flexibel und ohne grösseren Aufwand zwischen kostenlos und Abo umschalten lassen, nicht fest im Code verdrahtet (siehe Abschnitt 6, Feature-Flags/Entitlements).

---

## 4. Funktionale Anforderungen (Gesamtübersicht inkl. Ausbaustufen)

### 4.1 Benutzerverwaltung & Login

| Feature | Priorität |
|---|---|
| Registrierung/Login mit Email + Passwort | Muss |
| Passwort vergessen / Reset | Muss |
| Profil (Name, Alter, Geschlecht, Gewicht, Grösse, Ziel) | Muss |
| Multi-Device-Sync (gleiche Daten auf Android + Web) | Muss |
| Einfache Einladung/Freigabe für 1-2 Trainingspartner (statt vollem Rollensystem) | Soll |
| Account löschen & Datenexport (DSGVO/revDSG) | Soll |
| OAuth/Social Login (Google, Apple) | Kann |
| 2-Faktor-Authentifizierung | Kann |

### 4.2 Krafttraining

| Feature | Priorität |
|---|---|
| Workout-Log (Sätze/Wiederholungen/Gewicht manuell erfassen) | Muss |
| Übungsdatenbank mit Beschreibung + Bild/Video der Ausführung | Muss |
| Trainingspläne erstellen & abarbeiten | Muss |
| Pausentimer zwischen Sätzen | Muss |
| Eigene Übungen anlegen | Muss |
| Trainingskalender/Verlauf | Muss |
| Supersätze, Zirkeltraining, Dropsets | Kann |
| Fortschrittsfotos | Kann |

### 4.3 Ausdauertraining

| Feature | Priorität |
|---|---|
| Distanz/Zeit/Pace erfassen | Muss |
| Verlauf/Kalender für Ausdauereinheiten | Muss |
| Herzfrequenz erfassen (manuell oder Sensor) | Soll |
| Streckenaufzeichnung per GPS (Android) | Soll |
| Kalorienschätzung Cardio | Soll |

### 4.4 Ernährung

| Feature | Priorität |
|---|---|
| Kalorien-/Makro-Tracking | Muss |
| Lebensmitteldatenbank (z. B. Open Food Facts API) | Muss |
| Wasser-Tracking | Soll |
| Barcode-Scanner | Soll |
| Rezepte/Mahlzeitenplanung | Kann |

### 4.5 Statistik & Auswertung

| Feature | Priorität |
|---|---|
| Dashboard mit Fortschrittscharts für Kraft, Ausdauer und Ernährung | Muss |
| Körpermasse/Gewicht/Körperfett-Verlauf | Muss |
| Kraftsteigerung-Prognose (Trendlinie aus bisherigen Trainingseinheiten, statistisch berechnet) | Muss |
| Persönliche Rekorde (Kraft + Ausdauer) automatisch erkennen | Soll |
| Trainingsvolumen pro Muskelgruppe | Soll |
| Zeitraumvergleiche (Woche/Monat/Jahr) | Soll |
| Export als PDF/CSV | Soll |
| 1RM-Berechnung (geschätztes Maximalgewicht) | Kann |
| Kalender-Heatmap (Trainingsfrequenz, GitHub-Style) | Kann |

*Basis-Dashboard (erste vier Zeilen) ist Teil des kostenlosen MVP im Browser. Alles darüber hinaus sowie jede Statistik-Ansicht in der App ist Abo-pflichtig, siehe Abschnitt 3.*

### 4.6 Gamification & Motivation

| Feature | Priorität |
|---|---|
| Erinnerungen/Reminders | Soll |
| Streak-Tracking (Streak bleibt mit bis zu 4 Restdays erhalten, damit auch Nutzer mit 1x Training/Woche eine Streak aufbauen können) | Soll |
| Achievements/Badges | Kann |
| Challenges (vorgegeben, z. B. 30-Tage-Challenge) | Kann |
| Eigene Challenges erstellen | Kann |

### 4.7 Social (klein, für dich + 1-2 Freunde)

| Feature | Priorität |
|---|---|
| Workouts mit 1-2 Freunden teilen/einsehen | Soll |
| Gemeinsamer Trainingskalender mit Freunden | Kann |
| Kommentare/Reaktionen auf Workouts der Freunde | Kann |

*Leaderboard und öffentlicher Feed entfallen vorerst, da kein öffentliches Produkt geplant ist.*

### 4.8 Benachrichtigungen

| Feature | Priorität |
|---|---|
| Push-Notifications Android (Trainingserinnerung, Timer-Ende) | Muss |
| Email nur für administrative Zwecke (Passwort geändert, Sicherheitshinweise) | Soll |

### 4.9 Integrationen

| Feature | Priorität |
|---|---|
| Google Fit | Soll |
| Bluetooth-Herzfrequenzmesser | Soll |
| Strava-Import/Export | Kann |
| Apple Health (falls später iOS/App Store kommt) | Kann |
| Wear OS Companion App | Kann |

### 4.10 KI-Features (Abo-pflichtig)

| Feature | Priorität |
|---|---|
| Automatisch generierte Trainingsvorschläge basierend auf Verlauf | Kann, erstes geplantes KI-Feature |
| Boss-Kampf-Modus: Gegner mit 10 HP, Nutzer erhält zufällige Übung (z. B. Liegestütze, Pull-Ups), filmt sich bei der Ausführung, Live-Bilderkennung prüft saubere Wiederholung (-1 HP bei Erfolg), mit Zeitlimit | Idee erfasst, bewusst zurückgestellt |
| Weitere KI-Features (z. B. Chat-Coach) | Bewusst zurückgestellt, wird geplant sobald das MVP steht |

*Alle KI-Funktionen sind Teil des Abos, siehe Abschnitt 3 (Monetarisierung). Die Kraftsteigerung-Prognose selbst ist bewusst NICHT KI-gestützt und bleibt daher kostenlos.*

*Kostenkontrolle weiterhin sinnvoll: Rate-Limits pro Nutzer, Caching wo möglich, günstige Modelle für einfache Aufgaben. Für den Boss-Kampf-Modus vermutlich On-Device Pose-Estimation (z. B. MediaPipe/TensorFlow Lite) statt Cloud-KI nötig, da eine Live-Auswertung über eine Cloud-API sonst zu langsam und zu teuer wäre.*

### 4.11 Verteilung & Installation

| Feature | Priorität |
|---|---|
| APK-Download-Bereich auf der Browser-Anwendung mit Installationsanleitung (Sideloading Schritt-für-Schritt) | Muss |
| Versions-Check beim App-Start mit Hinweis auf verfügbares Update | Soll |

### 4.12 Administration

| Feature | Priorität |
|---|---|
| Einfache Übungsdatenbank-Pflege durch dich selbst (kein separates Admin-Panel nötig) | Soll |
| Monitoring/Fehlerprotokollierung | Kann |

---

## 5. Nicht-funktionale Anforderungen

- **Performance:** Dashboard-Ladezeit unter 2 Sekunden, flüssige Bedienung auch bei grossem Trainingsverlauf
- **Sicherheit:** Verschlüsselte Passwortspeicherung (bcrypt/argon2), HTTPS überall, sichere Session-/Token-Verwaltung
- **Datenschutz:** DSGVO/revDSG-konform, relevant sobald Freunde eigene Daten einspeisen
- **Offline-Fähigkeit:** Android-App soll Training auch ohne Internet erfassen können (z. B. im Gym-Keller ohne Empfang), Sync sobald wieder online
- **Mehrsprachigkeit:** Mindestens Deutsch, Englisch optional
- **Design:** Dark Mode, gute Kontraste, klare Bedienung auch mit Trainingshandschuhen/verschwitzten Fingern
- **Wartbarkeit:** Modulare Architektur, damit spätere Erweiterungen (iOS, Wearables, weitere Freunde) möglich sind
- **Backup:** Regelmässige Datensicherung, kein Datenverlust bei App-Update oder Gerätewechsel

---

## 6. Technische Rahmenbedingungen (grober Vorschlag, separat vertiefbar)

- **Android:** Cross-Platform (Flutter oder React Native) für schnellere Entwicklung, oder .NET MAUI mit Shared-Code für Android + Web-Backend, da C#-Erfahrung vorhanden ist
- **Web:** React/Next.js für das Statistik-Dashboard, ggf. als PWA nutzbar
- **Backend:** REST- oder GraphQL-API mit Datenbank, z. B. Cloudflare Workers + D1 im Free-Tier passend zu bestehenden Projekten, alternativ klassisches Node- oder .NET-Backend
- **Auth:** JWT/OAuth2
- **Kraftsteigerung-Prognose:** Einfache lineare Regression/Trendlinie über z. B. geschätztes 1RM oder Trainingsvolumen pro Übung, benötigt eine Mindestanzahl an Trainingseinheiten (z. B. 3-5) bevor eine aussagekräftige Trendlinie angezeigt wird
- **Übungsdatenbank-Import:** [exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) liefert über 1'300 Übungen als JSON, inkl. Kategorie/Zielmuskel/Equipment, Thumbnail-Bild und Animations-GIF sowie Anleitungstext auf Englisch und Türkisch. Die GIFs passen direkt auf die MVP-Anforderung "Beispiel der Ausführung". Anleitungstexte müssten für die App noch ins Deutsche übersetzt oder vorerst auf Englisch angezeigt werden.
  **Wichtiger Lizenzhinweis:** Das Repository erlaubt laut eigener Beschreibung nur Bildungs- und nicht-kommerzielle Nutzung, kommerzielle Verwendung von Datensatz und Medien (Bilder/GIFs) ist ausdrücklich untersagt. Dieser GIF-Stil ist allerdings keine Einzelquelle, sondern über mehrere Repos verbreitet (u. a. ExerciseDB API, exercisedb-pro), was die praktische Verfolgungswahrscheinlichkeit senkt, an den Lizenzbedingungen selbst aber nichts ändert. Für den privaten MVP-Aufbau (nur du + 1-2 Freunde, kein Verkauf) unkritisch, vor dem Start des Freemium/Abo-Modells solltest du das aber sauber lösen: entweder eigene Bilder/Videos erstellen, oder auf eine explizit kommerziell lizenzierte Variante wechseln, z. B. ExerciseDB.io, die denselben Datensatz-Typ als einmaligen Kauf mit kommerzieller Nutzungserlaubnis anbietet.
- **Abo-Verwaltung:** Zahlungsanbieter/Subscription-Handling nötig (z. B. Stripe), 5 CHF/Monat und 50 CHF/Jahr als Preispunkte
- **Feature-Flags/Entitlements:** Zentrale Konfiguration statt Hardcoding, damit jedes Feature einzeln und flexibel zwischen kostenlos und Abo umgeschaltet werden kann, auch nachträglich ohne Code-Änderung
- **Trial-Phase:** 14 Tage, eigenes strengeres Rate-Limit für KI-Funktionen während der Trial-Phase (separat vom regulären Abo-Limit), um Missbrauch/Kosten während der Testphase zu begrenzen
- **APK-Signing:** Eigenes Signing-Zertifikat, da kein Play Store Signing genutzt wird, Nutzer müssen "Installation aus unbekannten Quellen" aktivieren, kurze Anleitung dafür einplanen
- **Updates ohne Store:** Einfacher Versions-Check gegen eine JSON-Datei auf dem eigenen Server, Hinweis auf neue APK im Dashboard
- **KI-Kosten:** Rate-Limiting und Caching einplanen, günstige Modelle für einfache Aufgaben, teurere Modelle gezielt nur wo nötig
- Da die Nutzerzahl klein bleibt (2-3 Personen), ist keine grosse Skalierung nötig, eine schlanke Lösung reicht völlig aus

---

## 7. Abgrenzung (was V1 explizit NICHT macht)

- Keine Veröffentlichung im Play Store oder Apple App Store (Kostengründe)
- Kein iOS-Support
- Keine öffentliche Nutzerregistrierung/kein Onboarding für unbekannte Nutzer
- Kein Leaderboard, kein öffentlicher Feed
- Kein Live-Personal-Training/Coaching durch echte Trainer
- Kein Marketplace für Trainingspläne
- Keine eigene Wearable-Hardware
- Kraftsteigerung-Prognose ist statistisch, keine KI-Analyse

---

## 8. Offene Fragen zur Verfeinerung

Die meisten grösseren Fragen sind geklärt. Bewusst offen gelassen, mit klarem Zeitpunkt zur Klärung:

1. **Feature-zu-Tier-Zuordnung:** Welche Post-MVP-Funktionen (Ausdauer, Ernährung, Social, Gamification) am Ende im Abo landen, wird erst nach der Testphase anhand von Nutzungsdaten gemeinsam entschieden.
2. **Weitere KI-Features:** Bewusst zurückgestellt, wird erst geplant sobald das MVP ein klareres Bild ergibt.
3. **Zahlungsanbieter:** Konkrete Wahl (z. B. Stripe) für die Abo-Abwicklung noch offen, aber technisch unkritisch für die weitere Planung.
