import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// API (Cloudflare Worker) läuft lokal auf Port 8787 und mountet ihre Routen
// an der Wurzel (/health, /version, /entitlements, …) statt unter /api.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        // 127.0.0.1 statt localhost: wrangler dev bindet nur IPv4,
        // localhost löst auf Windows teils zu ::1 auf
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
