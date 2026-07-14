import { defineConfig } from "drizzle-kit";

// Schema lebt bewusst in @ascent/shared (packages/shared), damit App, Web und
// API dieselben Typen und Tabellen-Definitionen verwenden. drizzle-kit liest
// hier direkt aus der Quelldatei, kein separates Kopieren nötig.
export default defineConfig({
  schema: "../../packages/shared/src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
});
