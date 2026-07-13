/**
 * Tests unitaires — config du jeton QR agence (NOTIF-005-A).
 *
 * Couvre : défauts DEV sûrs, parsing multi-version, version courante déduite ou
 * explicite, normalisation de la base d'URL PWA, robustesse aux entrées malformées.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { resolveAgencyQrConfig } from "src/config/agency-qr.js";

describe("NOTIF-005-A: config QR agence", () => {
  it("NOTIF-005-A: défauts DEV — trousseau v1 + base PWA par défaut", () => {
    const cfg = resolveAgencyQrConfig({});
    expect(cfg.keyring.current).toBe(1);
    expect(cfg.keyring.keys[1]).toBeTypeOf("string");
    expect(cfg.pwaBaseUrl).toBe("https://app.sigfa.local/q");
  });

  it("NOTIF-005-A: parse plusieurs versions, courante = plus haute par défaut", () => {
    const cfg = resolveAgencyQrConfig({
      AGENCY_QR_SIGNING_KEYS: "1:aaaa,2:bbbb,3:cccc",
    });
    expect(cfg.keyring.current).toBe(3);
    expect(Object.keys(cfg.keyring.keys)).toHaveLength(3);
    expect(cfg.keyring.keys[2]).toBe("bbbb");
  });

  it("NOTIF-005-A: version courante explicite honorée si présente au trousseau", () => {
    const cfg = resolveAgencyQrConfig({
      AGENCY_QR_SIGNING_KEYS: "1:aaaa,2:bbbb",
      AGENCY_QR_KEY_VERSION: "1",
    });
    expect(cfg.keyring.current).toBe(1);
  });

  it("NOTIF-005-A: version courante explicite ABSENTE du trousseau → repli max", () => {
    const cfg = resolveAgencyQrConfig({
      AGENCY_QR_SIGNING_KEYS: "1:aaaa,2:bbbb",
      AGENCY_QR_KEY_VERSION: "9",
    });
    expect(cfg.keyring.current).toBe(2);
  });

  it("NOTIF-005-A: entrées malformées ignorées, slash final retiré de la base", () => {
    const cfg = resolveAgencyQrConfig({
      AGENCY_QR_SIGNING_KEYS: "bad,0:x,2:valid,:nover",
      AGENCY_QR_PWA_BASE_URL: "https://pwa.bank.ci/q/",
    });
    expect(cfg.keyring.keys[2]).toBe("valid");
    expect(cfg.keyring.keys[0]).toBeUndefined();
    expect(cfg.pwaBaseUrl).toBe("https://pwa.bank.ci/q");
  });
});
