/**
 * Tests unitaires — NET-003 : config/observability (seuils + destinataires).
 *
 * Critère : seuils as-code injectables via env ; destinataires = placeholders
 * (valeurs réelles fournies par le PO/ops avant activation).
 *
 * @module
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  getObservabilityConfig,
  DEFAULT_CPU_THRESHOLD,
  DEFAULT_MEM_THRESHOLD,
  DEFAULT_ERROR_RATE_THRESHOLD,
  DEFAULT_RT_P95_SLA_MS,
  DEFAULT_WINDOW_S,
  DEFAULT_DEDUP_WINDOW_S,
  OPS_RECIPIENT_PLACEHOLDER,
  ONCALL_RECIPIENT_PLACEHOLDER,
} from "src/config/observability.js";

const KEYS = [
  "OBS_CPU_THRESHOLD",
  "OBS_MEM_THRESHOLD",
  "OBS_ERROR_RATE_THRESHOLD",
  "OBS_RT_P95_SLA_MS",
  "OBS_WINDOW_S",
  "OBS_DEDUP_WINDOW_S",
  "OBS_OPS_RECIPIENT",
  "OBS_ONCALL_RECIPIENT",
] as const;

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("NET-003: seuils d'alerte as-code (CPU>80% / mem>85% / err>1% / 5 min) injectables via env", () => {
  it("NET-003: défauts sûrs — CPU 0.8, mem 0.85, err 0.01, RT 500ms, fenêtre 300s, dédup 600s", () => {
    for (const k of KEYS) delete process.env[k];
    const cfg = getObservabilityConfig();
    expect(cfg.thresholds.cpuThreshold).toBe(DEFAULT_CPU_THRESHOLD);
    expect(cfg.thresholds.memThreshold).toBe(DEFAULT_MEM_THRESHOLD);
    expect(cfg.thresholds.errorRateThreshold).toBe(DEFAULT_ERROR_RATE_THRESHOLD);
    expect(cfg.thresholds.rtP95SlaMs).toBe(DEFAULT_RT_P95_SLA_MS);
    expect(cfg.thresholds.windowS).toBe(DEFAULT_WINDOW_S);
    expect(cfg.thresholds.dedupWindowS).toBe(DEFAULT_DEDUP_WINDOW_S);
    expect(DEFAULT_CPU_THRESHOLD).toBe(0.8);
    expect(DEFAULT_MEM_THRESHOLD).toBe(0.85);
    expect(DEFAULT_ERROR_RATE_THRESHOLD).toBe(0.01);
    expect(DEFAULT_RT_P95_SLA_MS).toBe(500);
    expect(DEFAULT_WINDOW_S).toBe(300);
    expect(DEFAULT_DEDUP_WINDOW_S).toBe(600);
  });

  it("NET-003: chaque seuil est injectable via sa variable d'environnement", () => {
    process.env["OBS_CPU_THRESHOLD"] = "0.7";
    process.env["OBS_MEM_THRESHOLD"] = "0.9";
    process.env["OBS_ERROR_RATE_THRESHOLD"] = "0.02";
    process.env["OBS_RT_P95_SLA_MS"] = "400";
    process.env["OBS_WINDOW_S"] = "120";
    process.env["OBS_DEDUP_WINDOW_S"] = "300";
    const cfg = getObservabilityConfig();
    expect(cfg.thresholds.cpuThreshold).toBe(0.7);
    expect(cfg.thresholds.memThreshold).toBe(0.9);
    expect(cfg.thresholds.errorRateThreshold).toBe(0.02);
    expect(cfg.thresholds.rtP95SlaMs).toBe(400);
    expect(cfg.thresholds.windowS).toBe(120);
    expect(cfg.thresholds.dedupWindowS).toBe(300);
  });

  it("NET-003: valeur invalide ou ≤0 → retombe sur le défaut (fail-safe)", () => {
    process.env["OBS_CPU_THRESHOLD"] = "abc";
    process.env["OBS_MEM_THRESHOLD"] = "0";
    process.env["OBS_ERROR_RATE_THRESHOLD"] = "-1";
    process.env["OBS_RT_P95_SLA_MS"] = "0";
    process.env["OBS_WINDOW_S"] = "1.5";
    const cfg = getObservabilityConfig();
    expect(cfg.thresholds.cpuThreshold).toBe(DEFAULT_CPU_THRESHOLD);
    expect(cfg.thresholds.memThreshold).toBe(DEFAULT_MEM_THRESHOLD);
    expect(cfg.thresholds.errorRateThreshold).toBe(DEFAULT_ERROR_RATE_THRESHOLD);
    expect(cfg.thresholds.rtP95SlaMs).toBe(DEFAULT_RT_P95_SLA_MS);
    expect(cfg.thresholds.windowS).toBe(DEFAULT_WINDOW_S);
  });
});

describe("NET-003: destinataires ops/astreinte = placeholders (valeurs réelles fournies par le PO)", () => {
  it("NET-003: sans env, ops et astreinte retombent sur les placeholders", () => {
    for (const k of KEYS) delete process.env[k];
    const cfg = getObservabilityConfig();
    expect(cfg.recipients.ops).toBe(OPS_RECIPIENT_PLACEHOLDER);
    expect(cfg.recipients.onCall).toBe(ONCALL_RECIPIENT_PLACEHOLDER);
  });

  it("NET-003: destinataires injectables via env (fournis par ops)", () => {
    process.env["OBS_OPS_RECIPIENT"] = "slack://ops";
    process.env["OBS_ONCALL_RECIPIENT"] = "pagerduty://oncall";
    const cfg = getObservabilityConfig();
    expect(cfg.recipients.ops).toBe("slack://ops");
    expect(cfg.recipients.onCall).toBe("pagerduty://oncall");
  });

  it("NET-003: env vide → placeholder (jamais de canal vide)", () => {
    process.env["OBS_OPS_RECIPIENT"] = "   ";
    const cfg = getObservabilityConfig();
    expect(cfg.recipients.ops).toBe(OPS_RECIPIENT_PLACEHOLDER);
  });
});
