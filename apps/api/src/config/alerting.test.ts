/**
 * Tests unitaires — API-007 : config/alerting (intervalles injectables via env).
 *
 * Critère 8 : `API-007: intervalle alerting exporté config/alerting.ts, injectable
 * via env (AGENT_INACTIVE_SCAN_INTERVAL_S…)`.
 *
 * @module
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  getAlertingConfig,
  DEFAULT_AGENT_INACTIVE_SCAN_INTERVAL_S,
  DEFAULT_SLA_SCAN_INTERVAL_S,
  DEFAULT_AGENT_DISCONNECT_GRACE_S,
} from "src/config/alerting.js";

const KEYS = [
  "AGENT_INACTIVE_SCAN_INTERVAL_S",
  "SLA_SCAN_INTERVAL_S",
  "AGENT_DISCONNECT_GRACE_S",
] as const;

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("API-007: intervalle alerting exporté config/alerting.ts, injectable via env (AGENT_INACTIVE_SCAN_INTERVAL_S…)", () => {
  it("API-007: défauts sûrs quand aucune variable n'est définie", () => {
    for (const k of KEYS) delete process.env[k];
    const cfg = getAlertingConfig();
    expect(cfg.agentInactiveScanIntervalS).toBe(DEFAULT_AGENT_INACTIVE_SCAN_INTERVAL_S);
    expect(cfg.slaScanIntervalS).toBe(DEFAULT_SLA_SCAN_INTERVAL_S);
    expect(cfg.agentDisconnectGraceS).toBe(DEFAULT_AGENT_DISCONNECT_GRACE_S);
  });

  it("API-007: chaque intervalle est injectable via sa variable d'environnement", () => {
    process.env["AGENT_INACTIVE_SCAN_INTERVAL_S"] = "5";
    process.env["SLA_SCAN_INTERVAL_S"] = "7";
    process.env["AGENT_DISCONNECT_GRACE_S"] = "12";
    const cfg = getAlertingConfig();
    expect(cfg.agentInactiveScanIntervalS).toBe(5);
    expect(cfg.slaScanIntervalS).toBe(7);
    expect(cfg.agentDisconnectGraceS).toBe(12);
  });

  it("API-007: valeur non numérique ou ≤0 → retombe sur le défaut (fail-safe)", () => {
    process.env["AGENT_INACTIVE_SCAN_INTERVAL_S"] = "abc";
    process.env["SLA_SCAN_INTERVAL_S"] = "0";
    process.env["AGENT_DISCONNECT_GRACE_S"] = "-3";
    const cfg = getAlertingConfig();
    expect(cfg.agentInactiveScanIntervalS).toBe(DEFAULT_AGENT_INACTIVE_SCAN_INTERVAL_S);
    expect(cfg.slaScanIntervalS).toBe(DEFAULT_SLA_SCAN_INTERVAL_S);
    expect(cfg.agentDisconnectGraceS).toBe(DEFAULT_AGENT_DISCONNECT_GRACE_S);
  });
});
