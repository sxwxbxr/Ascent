-- MVP-Feature-Flags für die lokale D1-Instanz (Technisches Konzept, Abschnitt 5).
-- Ausführen via: pnpm db:seed:local
-- (setzt voraus, dass die Migrationen bereits angewendet wurden, siehe
-- pnpm db:migrate:local)
INSERT OR REPLACE INTO feature_flags (key, required_tier, enabled, description, updated_at) VALUES
  ('stats.web.basic', 'free', 1, 'Basis-Statistik im Browser', 0),
  ('stats.web.advanced', 'pro', 1, 'Erweiterte Browser-Statistik', 0),
  ('stats.app', 'pro', 1, 'Statistiken in der Android-App', 0),
  ('ai.suggestions', 'pro', 0, 'KI-Trainingsvorschlaege (noch nicht gebaut)', 0),
  ('nutrition.tracking', 'free', 1, 'Ernaehrungs-Tagebuch (Mahlzeiten-CRUD, OFF-Suche/Barcode, Ziele)', 0),
  ('nutrition.water_tracking', 'free', 1, 'Wasser-Tracking-Widget', 0),
  ('nutrition.stats.web', 'free', 1, 'kcal-Trend-Karte im Web-Dashboard', 0);
