/**
 * Tests unitaires de la table des rate-limits globaux — API-011.
 *
 * Vérifie que la config LA LOI est présente (devices 10/min) et que chaque route
 * expose un nom de dimension DISTINCT → fenêtres Redis indépendantes.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { GLOBAL_RATE_LIMITS } from "src/config/rate-limits.js";

describe("API-011: rate-limits globaux (config)", () => {
  it("API-011: devices borné à 10/min/IP (LA LOI)", () => {
    const devices = GLOBAL_RATE_LIMITS.find((r) => r.path === "/notifications/devices");
    expect(devices).toBeDefined();
    expect(devices?.limit).toBe(10);
    expect(devices?.windowSeconds).toBe(60);
  });

  it("API-011: chaque route a une dimension distincte (fenêtres indépendantes)", () => {
    const names = GLOBAL_RATE_LIMITS.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("API-011: routes publiques et webhooks bornées", () => {
    const paths = GLOBAL_RATE_LIMITS.map((r) => r.path);
    expect(paths).toContain("/public/tickets");
    expect(paths).toContain("/webhooks");
  });

  it("MODEL-API-B: /public/agencies borné 60/min (anti-énumération D5)", () => {
    const agencies = GLOBAL_RATE_LIMITS.find((r) => r.path === "/public/agencies");
    expect(agencies).toBeDefined();
    expect(agencies?.name).toBe("public-agencies");
    expect(agencies?.limit).toBe(60);
    expect(agencies?.windowSeconds).toBe(60);
  });
});
