/**
 * Tests unitaires des constantes de supervision borne — API-011.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { KIOSK_HEARTBEAT_INTERVAL_S, KIOSK_SILENT_THRESHOLD_S } from "src/config/kiosk.js";

describe("API-011: constantes de supervision borne", () => {
  it("API-011: KIOSK_HEARTBEAT_INTERVAL_S = 60 exporté (config/kiosk.ts)", () => {
    expect(KIOSK_HEARTBEAT_INTERVAL_S).toBe(60);
  });

  it("API-011: seuil SILENT = 3× l'intervalle nominal (180 s)", () => {
    expect(KIOSK_SILENT_THRESHOLD_S).toBe(180);
    expect(KIOSK_SILENT_THRESHOLD_S).toBe(KIOSK_HEARTBEAT_INTERVAL_S * 3);
  });
});
