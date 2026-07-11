import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { CONTRACTS_VERSION, OPENAPI_PATHS, createSigfaClient } from "./index.js";

describe("@sigfa/contracts", () => {
  it("exports CONTRACTS_VERSION", () => {
    expect(CONTRACTS_VERSION).toBe("0.0.0");
  });

  // ─── CONTRACT-010 : OPENAPI_PATHS couvre tous les modules ────────────────────
  it("CONTRACT-010: OPENAPI_PATHS exporte les 7 modules OpenAPI", () => {
    const expectedModules = ["core", "agents", "public", "admin", "notifications", "reporting", "ai"] as const;
    for (const mod of expectedModules) {
      expect(
        OPENAPI_PATHS[mod],
        `OPENAPI_PATHS doit exporter le module ${mod}`,
      ).toBeDefined();
      expect(
        typeof OPENAPI_PATHS[mod],
        `OPENAPI_PATHS.${mod} doit être une string (chemin absolu)`,
      ).toBe("string");
    }
  });

  it("CONTRACT-010: tous les fichiers YAML référencés dans OPENAPI_PATHS existent sur le disque", () => {
    for (const [mod, path] of Object.entries(OPENAPI_PATHS)) {
      expect(
        existsSync(path),
        `Le fichier YAML du module ${mod} doit exister : ${path}`,
      ).toBe(true);
    }
  });

  it("CONTRACT-010: OPENAPI_PATHS contient exactement 7 modules (ni plus, ni moins)", () => {
    expect(
      Object.keys(OPENAPI_PATHS).length,
      "OPENAPI_PATHS doit avoir exactement 7 modules",
    ).toBe(7);
  });

  // ─── CONTRACT-009a : createSigfaClient exporté depuis l'index ────────────────
  it("CONTRACT-009a: createSigfaClient est exporté depuis l'index public", () => {
    expect(typeof createSigfaClient).toBe("function");
  });

  it("CONTRACT-009a: createSigfaClient retourne un client openapi-fetch valide depuis l'index", () => {
    const client = createSigfaClient("core", "https://api.sigfa.example.com");
    expect(typeof client.GET).toBe("function");
    expect(typeof client.POST).toBe("function");
  });
});
