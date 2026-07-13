/**
 * Tests unitaires — NOTIF-003 : vérification de signature HMAC du webhook entrant
 * (secret propre à la banque, format `sha256=<hex>`).
 *
 * Nommage strict : `NOTIF-003: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyInboundSignature } from "src/routes/webhooks-whatsapp-inbound.js";

const secret = "wa-secret";
const body = '{"object":"whatsapp_business_account","entry":[]}';

function sign(raw: string, s: string): string {
  return `sha256=${createHmac("sha256", s).update(raw).digest("hex")}`;
}

describe("verifyInboundSignature", () => {
  it("NOTIF-003: signature valide (secret banque) → true", () => {
    expect(verifyInboundSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("NOTIF-003: signature absente → false (aucun traitement)", () => {
    expect(verifyInboundSignature(body, undefined, secret)).toBe(false);
  });

  it("NOTIF-003: mauvais secret → false", () => {
    expect(verifyInboundSignature(body, sign(body, "other"), secret)).toBe(false);
  });

  it("NOTIF-003: corps altéré → false", () => {
    expect(verifyInboundSignature(body + "x", sign(body, secret), secret)).toBe(false);
  });

  it("NOTIF-003: préfixe manquant (hex nu, sans sha256=) → false", () => {
    const hex = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyInboundSignature(body, hex, secret)).toBe(false);
  });

  it("NOTIF-003: longueur incorrecte → false (jamais timingSafeEqual sur tailles ≠)", () => {
    expect(verifyInboundSignature(body, "sha256=deadbeef", secret)).toBe(false);
  });
});
