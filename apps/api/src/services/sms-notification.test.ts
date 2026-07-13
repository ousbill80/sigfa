/**
 * Tests unitaires — logique métier SMS pure (NOTIF-002) : consent, TTL, mapping.
 * Nommage strict : `NOTIF-002: <description>`.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  evaluateConsent,
  deriveDeliveryStatus,
  toDbFailureReason,
  DELIVERY_UNKNOWN_TTL_MS,
} from "src/services/sms-notification.js";

describe("evaluateConsent — opt-in STRICT", () => {
  it("NOTIF-002: consentement absent → CONSENT_MISSING (non autorisé)", () => {
    expect(evaluateConsent(null)).toEqual({
      allowed: false,
      reason: "CONSENT_MISSING",
    });
  });

  it("NOTIF-002: opted_in=false → CONSENT_REVOKED", () => {
    expect(evaluateConsent({ optedIn: false, revokedAt: null })).toEqual({
      allowed: false,
      reason: "CONSENT_REVOKED",
    });
  });

  it("NOTIF-002: revoked_at posé → CONSENT_REVOKED (même si opted_in=true)", () => {
    expect(
      evaluateConsent({ optedIn: true, revokedAt: "2026-07-12T10:00:00Z" })
    ).toEqual({ allowed: false, reason: "CONSENT_REVOKED" });
  });

  it("NOTIF-002: opt-in actif → autorisé", () => {
    expect(evaluateConsent({ optedIn: true, revokedAt: null })).toEqual({
      allowed: true,
    });
  });
});

describe("deriveDeliveryStatus — SENT sans accusé → DELIVERY_UNKNOWN à TTL 24 h", () => {
  afterEach(() => vi.useRealTimers());

  it("NOTIF-002: avant TTL → reste SENT", () => {
    const sentAt = 1_000_000;
    expect(deriveDeliveryStatus(sentAt, sentAt + 23 * 3600 * 1000)).toBe("SENT");
  });

  it("NOTIF-002: à TTL exact (24 h) → DELIVERY_UNKNOWN", () => {
    const sentAt = 1_000_000;
    expect(deriveDeliveryStatus(sentAt, sentAt + DELIVERY_UNKNOWN_TTL_MS)).toBe(
      "DELIVERY_UNKNOWN"
    );
  });

  it("NOTIF-002: horloge injectée (fake-timers) — déterministe, zéro sleep", () => {
    vi.useFakeTimers();
    const sentAt = Date.now();
    vi.setSystemTime(sentAt + DELIVERY_UNKNOWN_TTL_MS + 1);
    expect(deriveDeliveryStatus(sentAt, Date.now())).toBe("DELIVERY_UNKNOWN");
  });
});

describe("toDbFailureReason — mapping raison fine → enum DB (LA LOI)", () => {
  it("NOTIF-002: CONSENT_MISSING → OPT_OUT (valeur légale de l'enum)", () => {
    expect(toDbFailureReason("CONSENT_MISSING")).toBe("OPT_OUT");
  });
  it("NOTIF-002: CONSENT_REVOKED → OPT_OUT", () => {
    expect(toDbFailureReason("CONSENT_REVOKED")).toBe("OPT_OUT");
  });
  it("NOTIF-002: TEMPLATE_RENDER_ERROR → TEMPLATE_REJECTED", () => {
    expect(toDbFailureReason("TEMPLATE_RENDER_ERROR")).toBe("TEMPLATE_REJECTED");
  });
});
