/**
 * Tests unitaires — jeton QR agence signé (NOTIF-005-A / CONTRACT-013).
 *
 * Couvre : signature HMAC-SHA256 déterministe, format `v{n}.{payload}.{sig}`,
 * TTL 30 jours (`exp` = émission + 2 592 000 s), rotation de clé versionnée
 * (vérification multi-version), refus opaque (expiré / altéré / mauvaise version /
 * mauvaise agence / clé inconnue).
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  signAgencyToken,
  verifyAgencyToken,
  AGENCY_QR_TTL_SECONDS,
  type AgencyQrKeyring,
} from "src/lib/agency-qr-token.js";

/** Trousseau de test : version courante 2, ancienne 1 encore acceptée. */
const keyring: AgencyQrKeyring = {
  current: 2,
  keys: {
    1: "old-secret-key-for-rotation-tests-32b",
    2: "current-secret-key-signing-qr-agency32",
  },
};

const AGENCY = "33333333-3333-4333-a333-333333333333";
/** Horloge figée pour des `exp` déterministes. */
const NOW = new Date("2026-07-13T09:00:00Z");

describe("NOTIF-005-A: jeton QR agence — signature HMAC-SHA256 + keyVersion", () => {
  it("NOTIF-005-A: signe avec la clé courante, format v{n}.{payload}.{sig}, TTL 30 j", () => {
    const { token, keyVersion, expiresAt } = signAgencyToken({ agencyId: AGENCY, keyring, now: NOW });
    expect(keyVersion).toBe(2);
    expect(token.startsWith("v2.")).toBe(true);
    expect(token.split(".")).toHaveLength(3);
    // exp = émission + 30 j
    const expected = new Date(NOW.getTime() + AGENCY_QR_TTL_SECONDS * 1000);
    expect(expiresAt.toISOString()).toBe(expected.toISOString());
    expect(AGENCY_QR_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("NOTIF-005-A: signature déterministe (mêmes entrées → même token)", () => {
    const a = signAgencyToken({ agencyId: AGENCY, keyring, now: NOW });
    const b = signAgencyToken({ agencyId: AGENCY, keyring, now: NOW });
    expect(a.token).toBe(b.token);
  });

  it("NOTIF-005-A: jeton valide → agencyId résolu", () => {
    const { token } = signAgencyToken({ agencyId: AGENCY, keyring, now: NOW });
    const res = verifyAgencyToken({ token, keyring, now: NOW });
    expect(res.agencyId).toBe(AGENCY);
    expect(res.keyVersion).toBe(2);
  });

  it("NOTIF-005-A: jeton signé v1 (clé encore au trousseau) → accepté (rotation multi-version)", () => {
    const v1keyring: AgencyQrKeyring = { current: 1, keys: keyring.keys };
    const { token } = signAgencyToken({ agencyId: AGENCY, keyring: v1keyring, now: NOW });
    expect(token.startsWith("v1.")).toBe(true);
    // Vérifié avec le trousseau courant (version 2) qui garde v1 au trousseau
    const res = verifyAgencyToken({ token, keyring, now: NOW });
    expect(res.agencyId).toBe(AGENCY);
    expect(res.keyVersion).toBe(1);
  });

  it("NOTIF-005-A: jeton expiré (au-delà de 30 j) → refus opaque", () => {
    const { token } = signAgencyToken({ agencyId: AGENCY, keyring, now: NOW });
    const later = new Date(NOW.getTime() + (AGENCY_QR_TTL_SECONDS + 1) * 1000);
    expect(() => verifyAgencyToken({ token, keyring, now: later })).toThrow();
  });

  it("NOTIF-005-A: signature altérée → refus opaque", () => {
    const { token } = signAgencyToken({ agencyId: AGENCY, keyring, now: NOW });
    const tampered = `${token.slice(0, -2)}xy`;
    expect(() => verifyAgencyToken({ token: tampered, keyring, now: NOW })).toThrow();
  });

  it("NOTIF-005-A: payload altéré (autre agence) → signature invalide → refus opaque", () => {
    const { token } = signAgencyToken({ agencyId: AGENCY, keyring, now: NOW });
    const parts = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ agencyId: "44444444-4444-4444-a444-444444444444", exp: 9999999999 })
    ).toString("base64url");
    const forged = `${parts[0]}.${forgedPayload}.${parts[2]}`;
    expect(() => verifyAgencyToken({ token: forged, keyring, now: NOW })).toThrow();
  });

  it("NOTIF-005-A: keyVersion inconnue du trousseau → refus opaque", () => {
    const { token } = signAgencyToken({ agencyId: AGENCY, keyring, now: NOW });
    const parts = token.split(".");
    const forged = `v9.${parts[1]}.${parts[2]}`;
    expect(() => verifyAgencyToken({ token: forged, keyring, now: NOW })).toThrow();
  });

  it("NOTIF-005-A: format malformé (pas 3 segments) → refus opaque", () => {
    expect(() => verifyAgencyToken({ token: "not-a-token", keyring, now: NOW })).toThrow();
    expect(() => verifyAgencyToken({ token: "v2.only-two", keyring, now: NOW })).toThrow();
  });

  it("NOTIF-005-A: signer sans clé pour la version courante → erreur de configuration", () => {
    const broken: AgencyQrKeyring = { current: 5, keys: keyring.keys };
    expect(() => signAgencyToken({ agencyId: AGENCY, keyring: broken, now: NOW })).toThrow();
  });
});
