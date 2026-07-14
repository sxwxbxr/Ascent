import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { featureFlags } from "@ascent/shared";

import type { Bindings } from "./env";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => {
  return c.json({ status: "ok", service: "ascent-api" });
});

// Stub für den App-Update-Check (Lastenheft 4.11 / Technisches Konzept
// Abschnitt 8). Die App vergleicht `latestVersion` beim Start gegen ihre
// eigene Version. Wird später aus KV/Config gespeist, sobald echte APK-
// Releases existieren (M6).
app.get("/version", (c) => {
  return c.json({
    latestVersion: "0.1.0",
    minSupportedVersion: "0.1.0",
    apkUrl: null,
    changelog: [],
  });
});

// Liefert die aufgelöste Feature-Map für den aktuellen Nutzer (Technisches
// Konzept Abschnitt 5). M0-Stub: Es gibt noch keine Auth, daher wird jeder
// Aufrufer als Tier "free" behandelt. Die echte Tier-Auflösung anhand des
// eingeloggten Nutzers (users.tier) kommt mit Auth in M1.
app.get("/entitlements", async (c) => {
  const tier = "free" as const;

  try {
    const db = drizzle(c.env.DB);
    const flags = await db.select().from(featureFlags).all();

    const features: Record<string, boolean> = {};
    for (const flag of flags) {
      features[flag.key] = Boolean(flag.enabled) && flag.requiredTier === "free";
    }

    return c.json({ tier, features });
  } catch {
    // Z. B. wenn die Tabelle noch nicht migriert wurde (frisches D1).
    return c.json({ tier, features: {} });
  }
});

export default app;
