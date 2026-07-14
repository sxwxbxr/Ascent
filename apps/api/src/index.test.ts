import { describe, expect, it } from "vitest";

import app from "./index";

// Hinweis: /entitlements wird hier bewusst nicht getestet, da die Route ein
// D1-Binding (c.env.DB) benötigt, das in diesem einfachen Unit-Test-Setup
// nicht bereitgestellt wird.

describe("GET /health", () => {
  it("liefert 200 mit dem erwarteten JSON-Body", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "ascent-api" });
  });
});

describe("GET /version", () => {
  it("liefert 200 und enthaelt latestVersion", async () => {
    const res = await app.request("/version");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("latestVersion", "0.1.0");
  });
});
