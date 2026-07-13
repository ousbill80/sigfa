/**
 * Tests for the `admOnboard.*` i18n namespace (ADM-002b).
 *
 * Verifies: FR/EN parity (no missing/extra key), a dedicated namespace (every
 * key is `admOnboard.*`, never colliding with `admin.*`), FR fallback, and the
 * `{reason}` interpolation used by the "kiosk not provisioned" message.
 * @module lib/adm-onboarding-i18n.test
 */
import { describe, it, expect } from "vitest";
import {
  ADM_ONBOARD_FR,
  ADM_ONBOARD_EN,
  tAdmOnboard,
  withReason,
  type AdmOnboardKey,
} from "./adm-onboarding-i18n";

describe("ADM-002b: i18n admOnboard.* FR/EN", () => {
  it("ADM-002b: FR et EN ont exactement les mêmes clés", () => {
    const fr = Object.keys(ADM_ONBOARD_FR).sort();
    const en = Object.keys(ADM_ONBOARD_EN).sort();
    expect(fr).toEqual(en);
  });

  it("ADM-002b: chaque clé appartient au namespace propre admOnboard.*", () => {
    for (const key of Object.keys(ADM_ONBOARD_FR)) {
      expect(key.startsWith("admOnboard.")).toBe(true);
    }
  });

  it("ADM-002b: aucune valeur vide en FR ni EN", () => {
    for (const key of Object.keys(ADM_ONBOARD_FR) as AdmOnboardKey[]) {
      expect(ADM_ONBOARD_FR[key].length).toBeGreaterThan(0);
      expect(ADM_ONBOARD_EN[key].length).toBeGreaterThan(0);
    }
  });

  it("ADM-002b: tAdmOnboard rend la locale et retombe sur FR par défaut", () => {
    expect(tAdmOnboard("admOnboard.next", "en")).toBe("Next");
    expect(tAdmOnboard("admOnboard.next", "fr")).toBe("Suivant");
    // default locale is FR
    expect(tAdmOnboard("admOnboard.title")).toBe(ADM_ONBOARD_FR["admOnboard.title"]);
  });

  it("ADM-002b: withReason interpole le motif dans « Borne non provisionnée »", () => {
    const msg = withReason(tAdmOnboard("admOnboard.kiosk.not_provisioned", "fr"), "quota atteint");
    expect(msg).toContain("quota atteint");
    expect(msg).not.toContain("{reason}");
  });
});
