import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// API (Cloudflare Worker) läuft lokal auf Port 8787 und mountet ihre Routen
// an der Wurzel (/health, /version, /entitlements, /auth/*, /plans, …).
// Die SPA ruft dieselben Pfade same-origin auf (kein /api-Präfix) – in Prod
// liefert derselbe Worker später sowohl die API als auch die SPA aus, lokal
// übernimmt dieser Proxy die Same-Origin-Illusion. Bewusst OHNE `rewrite`:
// die Pfade müssen 1:1 durchgereicht werden.
const API_TARGET = {
  // 127.0.0.1 statt localhost: wrangler dev bindet nur IPv4,
  // localhost löst auf Windows teils zu ::1 auf
  target: "http://127.0.0.1:8787",
  changeOrigin: true,
};

const PROXIED_PATHS = [
  "/auth",
  "/plans",
  "/workouts",
  "/exercises",
  "/body-metrics",
  "/profile",
  "/invites",
  "/sync",
  "/entitlements",
  "/media",
  "/health",
  "/version",
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: Object.fromEntries(PROXIED_PATHS.map((path) => [path, API_TARGET])),
  },
});
