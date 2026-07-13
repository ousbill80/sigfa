/**
 * Tests unitaires — signature webhook + normalisation raison (NOTIF-002).
 * Nommage strict : `NOTIF-002: <description>`.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyDeliverySignature,
  normalizeFailureReason,
  PROVIDER_SIGNATURE_HEADER,
} from "src/services/notification-delivery.js";

describe("verifyDeliverySignature — HMAC-SHA256", () => {
  const secret = "s3cr3t";
  const body = JSON.stringify({ messageId: "m1", status: "DELIVERED" });
  const good = createHmac("sha256", secret).update(body).digest("hex");

  it("NOTIF-002: signature valide → true", () => {
    expect(verifyDeliverySignature(body, good, secret)).toBe(true);
  });

  it("NOTIF-002: signature absente → false (401)", () => {
    expect(verifyDeliverySignature(body, undefined, secret)).toBe(false);
    expect(verifyDeliverySignature(body, "", secret)).toBe(false);
  });

  it("NOTIF-002: signature incorrecte → false", () => {
    expect(verifyDeliverySignature(body, "deadbeef", secret)).toBe(false);
  });

  it("NOTIF-002: corps altéré (rejeu falsifié) → false", () => {
    expect(verifyDeliverySignature(body + "x", good, secret)).toBe(false);
  });

  it("NOTIF-002: casse de la signature indifférente (hex normalisé)", () => {
    expect(verifyDeliverySignature(body, good.toUpperCase(), secret)).toBe(true);
  });
});

describe("normalizeFailureReason", () => {
  it("NOTIF-002: raison connue conservée", () => {
    expect(normalizeFailureReason("QUOTA_EXCEEDED")).toBe("QUOTA_EXCEEDED");
  });
  it("NOTIF-002: raison inconnue/absente → UNKNOWN", () => {
    expect(normalizeFailureReason("weird")).toBe("UNKNOWN");
    expect(normalizeFailureReason(undefined)).toBe("UNKNOWN");
  });
});

describe("PROVIDER_SIGNATURE_HEADER", () => {
  it("NOTIF-002: chaque provider a son en-tête de signature", () => {
    expect(PROVIDER_SIGNATURE_HEADER.africastalking).toBe("x-at-signature");
    expect(PROVIDER_SIGNATURE_HEADER.whatsapp).toBe("x-hub-signature-256");
    expect(PROVIDER_SIGNATURE_HEADER.resend).toBe("x-resend-signature");
  });
});
