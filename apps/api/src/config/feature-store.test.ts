/**
 * F10-FEATURE-STORE — Tests unitaires du gating `FEATURE_STORE_PROVIDER`.
 *
 * Vérifie le DÉFAUT SÛR (aucune variable → `none` → feature-store DB désactivé) et
 * l'activation EXPLICITE (`db`), avec retombée sûre sur toute valeur inconnue/vide.
 * Nommage strict : `F10: <description>`.
 *
 * @module
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_FEATURE_STORE_PROVIDER,
  isDbFeatureStoreEnabled,
  resolveFeatureStoreProvider,
} from "src/config/feature-store.js";

const ENV_KEY = "FEATURE_STORE_PROVIDER";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("config/feature-store gating", () => {
  it("F10: défaut SÛR — sans variable, provider = 'none' et DB désactivé", () => {
    delete process.env[ENV_KEY];
    expect(DEFAULT_FEATURE_STORE_PROVIDER).toBe("none");
    expect(resolveFeatureStoreProvider()).toBe("none");
    expect(isDbFeatureStoreEnabled()).toBe(false);
  });

  it("F10: activation EXPLICITE — FEATURE_STORE_PROVIDER=db active le store DB", () => {
    process.env[ENV_KEY] = "db";
    expect(resolveFeatureStoreProvider()).toBe("db");
    expect(isDbFeatureStoreEnabled()).toBe(true);
  });

  it("F10: activation tolérante à la casse/espaces — ' DB ' active aussi", () => {
    process.env[ENV_KEY] = "  DB  ";
    expect(isDbFeatureStoreEnabled()).toBe(true);
  });

  it("F10: valeur inconnue → retombe sur 'none' (jamais d'activation par erreur de frappe)", () => {
    process.env[ENV_KEY] = "postgres";
    expect(resolveFeatureStoreProvider()).toBe("none");
    expect(isDbFeatureStoreEnabled()).toBe(false);
  });

  it("F10: valeur vide → 'none'", () => {
    process.env[ENV_KEY] = "";
    expect(isDbFeatureStoreEnabled()).toBe(false);
  });
});
