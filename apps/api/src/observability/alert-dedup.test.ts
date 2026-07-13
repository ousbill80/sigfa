/**
 * Tests unitaires — NET-003 : dédup / anti-flapping des alertes (regroupement 10 min).
 *
 * Critère : dédup/flapping actif (pas de tempête d'alertes) ; regroupement 10 min ;
 * pas de réémission avant résolution ; routage par sévérité conservé.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { dedupeAlerts, type ActiveAlert } from "src/observability/alert-dedup.js";
import type { CandidateAlert } from "src/observability/alert-rules.js";
import { DEFAULT_DEDUP_WINDOW_S } from "src/config/observability.js";

const NOW = 1_700_000_000_000;

function candidate(at: number): CandidateAlert {
  return { ruleId: "cpu-high", severity: "WARNING", recipient: "ops", at };
}

describe("NET-003: dédup/flapping — regroupement 10 min, pas de tempête d'alertes", () => {
  it("NET-003: défaut de dédup = 10 min (600 s)", () => {
    expect(DEFAULT_DEDUP_WINDOW_S).toBe(600);
  });

  it("NET-003: première occurrence → émise et devient active", () => {
    const res = dedupeAlerts([candidate(NOW)], [], NOW);
    expect(res.emitted).toHaveLength(1);
    expect(res.emitted[0]?.ruleId).toBe("cpu-high");
    expect(res.active).toHaveLength(1);
  });

  it("NET-003: condition soutenue dans la fenêtre 10 min → PAS de réémission (pas de tempête)", () => {
    const active: ActiveAlert[] = [
      { ruleId: "cpu-high", severity: "WARNING", recipient: "ops", lastEmittedAt: NOW },
    ];
    // 5 min plus tard, même condition → aucune nouvelle alerte.
    const res = dedupeAlerts([candidate(NOW + 300_000)], active, NOW + 300_000);
    expect(res.emitted).toHaveLength(0);
    expect(res.active).toHaveLength(1);
  });

  it("NET-003: rafale de 20 échantillons soutenus → UNE seule alerte (pas 20)", () => {
    let active: readonly ActiveAlert[] = [];
    let totalEmitted = 0;
    for (let i = 0; i < 20; i++) {
      const at = NOW + i * 10_000; // toutes les 10 s, < fenêtre 10 min
      const res = dedupeAlerts([candidate(at)], active, at);
      totalEmitted += res.emitted.length;
      active = res.active;
    }
    expect(totalEmitted).toBe(1);
  });

  it("NET-003: résolution (aucune candidate) puis nouvelle occurrence → réémission", () => {
    // Émission initiale
    const first = dedupeAlerts([candidate(NOW)], [], NOW);
    expect(first.emitted).toHaveLength(1);
    // Résolution : passe sans candidate → l'alerte quitte l'état actif
    const resolved = dedupeAlerts([], first.active, NOW + 60_000);
    expect(resolved.active).toHaveLength(0);
    // Nouvelle occurrence après résolution → réémission
    const reArmed = dedupeAlerts([candidate(NOW + 120_000)], resolved.active, NOW + 120_000);
    expect(reArmed.emitted).toHaveLength(1);
  });

  it("NET-003: fenêtre de dédup expirée (>10 min) sur condition continue → réémission", () => {
    const active: ActiveAlert[] = [
      { ruleId: "cpu-high", severity: "WARNING", recipient: "ops", lastEmittedAt: NOW },
    ];
    // 11 min plus tard, toujours en alerte → réémission (rappel après fenêtre).
    const res = dedupeAlerts([candidate(NOW + 660_000)], active, NOW + 660_000);
    expect(res.emitted).toHaveLength(1);
  });

  it("NET-003: routage par sévérité conservé (CRITICAL → astreinte)", () => {
    const crit: CandidateAlert = {
      ruleId: "error-rate-high",
      severity: "CRITICAL",
      recipient: "on-call",
      at: NOW,
    };
    const res = dedupeAlerts([crit], [], NOW);
    expect(res.emitted[0]?.severity).toBe("CRITICAL");
    expect(res.emitted[0]?.recipient).toBe("on-call");
  });
});
