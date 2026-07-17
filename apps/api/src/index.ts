import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { featureFlags } from "@ascent/shared";
import type { Tier } from "@ascent/shared";

import type { Bindings } from "./env";
import type { AuthUser, AuthVariables } from "./middleware/auth";
import { optionalAuth, requireAuth } from "./middleware/auth";
import { createAuth } from "./auth/auth";
import { invitesRouter } from "./routes/invites";
import { plansRouter } from "./routes/plans";
import { workoutsRouter } from "./routes/workouts";
import { exercisesRouter } from "./routes/exercises";
import { bodyMetricsRouter } from "./routes/body-metrics";
import { mediaRouter } from "./routes/media";
import { profileRouter } from "./routes/profile";
import { syncRouter } from "./routes/sync";

const app = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>();

// ── Öffentlich ────────────────────────────────────────────────────────────

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

// Better Auth: Registrierung (nur mit Invite-Code, Bootstrap-Ausnahme),
// Login, Session, Passwort-Reset. basePath '/auth' ist in auth.ts gespiegelt.
app.on(["GET", "POST"], "/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// R2-Medien (Übungs-GIFs/-Thumbnails, später APK) — bewusst ohne Auth,
// damit <img>/RN-Image ohne Header laden können. Immutable-Cache + ETag.
app.route("/media", mediaRouter);

// Liefert die aufgelöste Feature-Map (Technisches Konzept Abschnitt 5).
// Anonym = Tier "free"; mit Session zählt users.tier. Trial-Nutzer haben
// Zugriff auf Pro-Features (das strengere Trial-Rate-Limit für KI kommt
// mit den KI-Features selbst, nach dem MVP).
const TIER_RANK: Record<Tier, number> = { free: 0, trial: 1, pro: 2 };

app.get("/entitlements", optionalAuth, async (c) => {
  const user = c.get("user") as AuthUser | undefined;
  const tier: Tier = user?.tier ?? "free";

  try {
    const db = drizzle(c.env.DB);
    const flags = await db.select().from(featureFlags).all();

    const features: Record<string, boolean> = {};
    for (const flag of flags) {
      features[flag.key] =
        Boolean(flag.enabled) && TIER_RANK[tier] >= TIER_RANK[flag.requiredTier];
    }

    return c.json({ tier, features });
  } catch {
    // Z. B. wenn die Tabelle noch nicht migriert wurde (frisches D1).
    return c.json({ tier, features: {} });
  }
});

// ── Nur mit Session (requireAuth) ────────────────────────────────────────

const PROTECTED = [
  "/invites",
  "/plans",
  "/workouts",
  "/exercises",
  "/body-metrics",
  "/profile",
  "/sync",
] as const;

for (const path of PROTECTED) {
  app.use(`${path}/*`, requireAuth);
  app.use(path, requireAuth);
}

app.route("/invites", invitesRouter);
app.route("/plans", plansRouter);
app.route("/workouts", workoutsRouter);
app.route("/exercises", exercisesRouter);
app.route("/body-metrics", bodyMetricsRouter);
app.route("/profile", profileRouter);
app.route("/sync", syncRouter);

export default app;
