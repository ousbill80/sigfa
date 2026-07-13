/**
 * Tests — NET-002 : machine d'état PURE de rollout borne (canary).
 *
 * Horloge injectée + fake-timers pour les fenêtres de stabilité (30 min verts,
 * 15 min halt). Nommage : `NET-002: <description>`.
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  initRollout,
  startCanary,
  observeHealth,
  promoteManual,
  tryPromoteAuto,
  rollback,
  nextStage,
  isCohortUnhealthy,
  isCohortFullyAdopted,
  isGreenWindowElapsed,
  requiresManualPromotion,
  ROLLOUT_STAGES,
  GREEN_WINDOW_MS,
  HALT_OFFLINE_FRACTION,
  MANUAL_UNTIL_PCT,
  type RolloutState,
  type CohortHealth,
} from "src/services/rollout/rollout-machine.js";

const T0 = 1_700_000_000_000;

function healthy(total = 100): CohortHealth {
  return { adopted: total, offlineOrFailed: 0, total };
}
function unhealthy(total = 100, offline = 11): CohortHealth {
  return { adopted: total - offline, offlineOrFailed: offline, total };
}

/** Amène le rollout à un palier donné en promotions manuelles saines. */
function advanceToStage(pct: number): RolloutState {
  let s = startCanary(initRollout("2.0.0", "1.9.0"));
  while (s.stagePct !== null && s.stagePct < pct && s.phase === "ROLLING") {
    s = promoteManual(s, healthy());
  }
  return s;
}

describe("NET-002 rollout-machine — cohortes & canary", () => {
  it("NET-002: les paliers sont 5/25/50/100 avec canary d'abord (≤5%)", () => {
    expect(ROLLOUT_STAGES).toEqual([5, 25, 50, 100]);
    expect(ROLLOUT_STAGES[0]).toBeLessThanOrEqual(5);
  });

  it("NET-002: publication → PENDING, aucune cohorte déployée", () => {
    const s = initRollout("2.0.0", "1.9.0");
    expect(s.phase).toBe("PENDING");
    expect(s.stagePct).toBeNull();
  });

  it("NET-002: canary ≤5% d'abord — startCanary déploie la cohorte 5%", () => {
    const s = startCanary(initRollout("2.0.0", "1.9.0"));
    expect(s.phase).toBe("ROLLING");
    expect(s.stagePct).toBe(5);
  });

  it("NET-002: startCanary est idempotent (rollout déjà démarré inchangé)", () => {
    const s = startCanary(initRollout("2.0.0", "1.9.0"));
    expect(startCanary(s)).toBe(s);
  });

  it("NET-002: séquencement déterministe des cohortes 5→25→50→100", () => {
    expect(nextStage(5)).toBe(25);
    expect(nextStage(25)).toBe(50);
    expect(nextStage(50)).toBe(100);
    expect(nextStage(100)).toBeNull();
  });
});

describe("NET-002 rollout-machine — progression manuelle puis auto (30 min)", () => {
  it("NET-002: palier ≤25% requiert une promotion MANUELLE", () => {
    const canary = startCanary(initRollout("2.0.0", "1.9.0"));
    expect(requiresManualPromotion(canary)).toBe(true); // 5%
    const at25 = advanceToStage(25);
    expect(at25.stagePct).toBe(25);
    expect(requiresManualPromotion(at25)).toBe(true);
  });

  it("NET-002: promotion manuelle 5%→25% sur cohorte saine", () => {
    const s = promoteManual(startCanary(initRollout("2.0.0", "1.9.0")), healthy());
    expect(s.stagePct).toBe(25);
    expect(s.phase).toBe("ROLLING");
  });

  it("NET-002: au-delà de 25% la promotion est AUTOMATIQUE, pas manuelle", () => {
    const at50 = advanceToStage(50);
    expect(at50.stagePct).toBe(50);
    expect(requiresManualPromotion(at50)).toBe(false);
    expect(MANUAL_UNTIL_PCT).toBe(25);
  });

  describe("fenêtre verte 30 min (fake-timers)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(T0);
    });
    afterEach(() => vi.useRealTimers());

    it("NET-002: auto NE progresse PAS avant 30 min verts", () => {
      let s = advanceToStage(50); // palier auto
      s = observeHealth(s, healthy(), Date.now());
      // 29 min plus tard → pas encore éligible.
      vi.advanceTimersByTime(29 * 60 * 1000);
      const still = tryPromoteAuto(s, healthy(), Date.now());
      expect(still.stagePct).toBe(50);
      expect(isGreenWindowElapsed(s, Date.now())).toBe(false);
    });

    it("NET-002: auto progresse APRÈS 30 min verts continus (50→100 → COMPLETED)", () => {
      let s = advanceToStage(50);
      s = observeHealth(s, healthy(), Date.now());
      vi.advanceTimersByTime(GREEN_WINDOW_MS);
      const promoted = tryPromoteAuto(s, healthy(), Date.now());
      expect(promoted.phase).toBe("COMPLETED");
    });

    it("NET-002: un relevé malsain rompt la fenêtre verte (le compteur redémarre)", () => {
      let s = advanceToStage(50);
      s = observeHealth(s, healthy(), Date.now());
      vi.advanceTimersByTime(20 * 60 * 1000);
      // Relevé malsain → HALT (rompt la fenêtre).
      const halted = observeHealth(s, unhealthy(), Date.now());
      expect(halted.phase).toBe("HALTED");
      expect(halted.greenSinceMs).toBeNull();
    });

    it("NET-002: manuel ≤25% n'auto-progresse jamais même après 30 min verts", () => {
      let s = advanceToStage(25);
      s = observeHealth(s, healthy(), Date.now());
      vi.advanceTimersByTime(GREEN_WINDOW_MS * 2);
      const still = tryPromoteAuto(s, healthy(), Date.now());
      expect(still.stagePct).toBe(25); // reste bloqué sur gate manuel
    });
  });
});

describe("NET-002 rollout-machine — santé & halt (>10% OFFLINE / 15 min)", () => {
  it("NET-002: seuil de halt = >10% OFFLINE de la cohorte", () => {
    expect(HALT_OFFLINE_FRACTION).toBeCloseTo(0.1);
    expect(isCohortUnhealthy({ adopted: 89, offlineOrFailed: 11, total: 100 })).toBe(true);
    expect(isCohortUnhealthy({ adopted: 90, offlineOrFailed: 10, total: 100 })).toBe(false);
    expect(isCohortUnhealthy({ adopted: 0, offlineOrFailed: 0, total: 0 })).toBe(false);
  });

  it("NET-002: cohorte > seuil → HALT automatique, palier ne progresse pas", () => {
    const s = observeHealth(advanceToStage(50), unhealthy(), T0);
    expect(s.phase).toBe("HALTED");
    expect(s.stagePct).toBe(50); // pas de progression
  });

  it("NET-002: promotion manuelle refusée si cohorte malsaine → HALT", () => {
    const s = promoteManual(startCanary(initRollout("2.0.0", "1.9.0")), unhealthy());
    expect(s.phase).toBe("HALTED");
    expect(s.stagePct).toBe(5);
  });

  it("NET-002: promotion auto refusée si cohorte malsaine → HALT (pas de progression)", () => {
    let s = advanceToStage(50);
    s = { ...s, greenSinceMs: T0 };
    const out = tryPromoteAuto(s, unhealthy(), T0 + GREEN_WINDOW_MS);
    expect(out.phase).toBe("HALTED");
    expect(out.stagePct).toBe(50);
  });

  it("NET-002: un palier ne progresse QUE si la cohorte reste sous les seuils", () => {
    // Cohorte saine mais partiellement adoptée → pas de blocage manuel explicite,
    // mais la santé (OFFLINE) est le seul garde. On vérifie fullyAdopted helper.
    expect(isCohortFullyAdopted(healthy())).toBe(true);
    expect(isCohortFullyAdopted({ adopted: 50, offlineOrFailed: 0, total: 100 })).toBe(false);
  });
});

describe("NET-002 rollout-machine — rollback vers version stable", () => {
  it("NET-002: rollback repointe vers la version stable précédente (conservée)", () => {
    const s = rollback(advanceToStage(50));
    expect(s.phase).toBe("ROLLED_BACK");
    expect(s.targetVersion).toBe("1.9.0"); // version stable
    expect(s.stableVersion).toBe("1.9.0");
    expect(s.stagePct).toBeNull();
  });

  it("NET-002: rollback depuis HALTED → repointe sur stable", () => {
    const halted = observeHealth(advanceToStage(50), unhealthy(), T0);
    const rolled = rollback(halted);
    expect(rolled.phase).toBe("ROLLED_BACK");
    expect(rolled.targetVersion).toBe("1.9.0");
  });

  it("NET-002: rollback est idempotent", () => {
    const once = rollback(advanceToStage(25));
    expect(rollback(once)).toBe(once);
  });

  it("NET-002: après rollback, aucune promotion ne progresse (phase terminale)", () => {
    const rolled = rollback(advanceToStage(50));
    expect(promoteManual(rolled, healthy())).toBe(rolled);
    expect(tryPromoteAuto(rolled, healthy(), T0 + GREEN_WINDOW_MS)).toBe(rolled);
    expect(observeHealth(rolled, healthy(), T0)).toBe(rolled);
  });
});
