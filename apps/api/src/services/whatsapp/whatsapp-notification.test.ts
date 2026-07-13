/**
 * Tests unitaires — NOTIF-003 : logique PURE du worker WhatsApp sortant.
 *
 * Nommage strict : `NOTIF-003: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  evaluateConsent,
  toDbFailureReason,
  type ConsentRow,
} from "src/services/whatsapp/whatsapp-notification.js";

describe("whatsapp-notification (pur)", () => {
  it("NOTIF-003: consentement absent → CONSENT_MISSING", () => {
    expect(evaluateConsent(null)).toEqual({ allowed: false, reason: "CONSENT_MISSING" });
  });

  it("NOTIF-003: opted_in=false → CONSENT_REVOKED", () => {
    const c: ConsentRow = { optedIn: false, revokedAt: null };
    expect(evaluateConsent(c)).toEqual({ allowed: false, reason: "CONSENT_REVOKED" });
  });

  it("NOTIF-003: revoked_at posé → CONSENT_REVOKED", () => {
    const c: ConsentRow = { optedIn: true, revokedAt: "2026-07-13T00:00:00Z" };
    expect(evaluateConsent(c)).toEqual({ allowed: false, reason: "CONSENT_REVOKED" });
  });

  it("NOTIF-003: opt-in WHATSAPP actif → autorisé", () => {
    expect(evaluateConsent({ optedIn: true, revokedAt: null })).toEqual({ allowed: true });
  });

  it("NOTIF-003: mappage CONSENT_* → OPT_OUT ; render → TEMPLATE_REJECTED", () => {
    expect(toDbFailureReason("CONSENT_MISSING")).toBe("OPT_OUT");
    expect(toDbFailureReason("CONSENT_REVOKED")).toBe("OPT_OUT");
    expect(toDbFailureReason("TEMPLATE_RENDER_ERROR")).toBe("TEMPLATE_REJECTED");
  });
});
