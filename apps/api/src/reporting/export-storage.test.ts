/**
 * REP-003 — Tests unitaires du stockage objet MOCK + URL signée TTL 24 h (D3).
 * Horloge injectée (déterministe) : signature, expiration, refus opaque.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  MockObjectStorage,
  EXPORT_URL_TTL_MS,
  signPayload,
} from "src/reporting/export-storage.js";

const SECRET = "test-signing-secret";
const NOW = new Date("2026-07-13T09:00:00Z");

function makeStorage(): MockObjectStorage {
  return new MockObjectStorage({ secret: SECRET, baseUrl: "https://mock.sigfa.local" });
}

describe("REP-003: stockage MOCK + URL signée TTL 24 h", () => {
  it("REP-003: put stocke l'objet et signe une URL à TTL 24 h (horloge injectée)", async () => {
    const storage = makeStorage();
    await storage.put("exports/bank/job.pdf", {
      body: Buffer.from("%PDF-"),
      contentType: "application/pdf",
    });
    const { url, expiresAt } = storage.signUrl("exports/bank/job.pdf", NOW);
    expect(url).toContain("https://mock.sigfa.local/download?");
    expect(url).toContain("key=exports%2Fbank%2Fjob.pdf");
    // TTL exactement 24 h après l'instant injecté.
    expect(expiresAt.getTime()).toBe(NOW.getTime() + EXPORT_URL_TTL_MS);
    expect(EXPORT_URL_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(storage.get("exports/bank/job.pdf")?.contentType).toBe("application/pdf");
  });

  it("REP-003: URL signée valide avant expiration", () => {
    const storage = makeStorage();
    const { url } = storage.signUrl("k1", NOW);
    const result = storage.verifySignedUrl(url, new Date(NOW.getTime() + 60_000));
    expect(result.valid).toBe(true);
    expect(result.valid && result.key).toBe("k1");
  });

  it("REP-003: URL signée expirée → refus EXPIRED (téléchargement refusé)", () => {
    const storage = makeStorage();
    const { url, expiresAt } = storage.signUrl("k1", NOW);
    const result = storage.verifySignedUrl(url, new Date(expiresAt.getTime() + 1));
    expect(result).toEqual({ valid: false, reason: "EXPIRED" });
  });

  it("REP-003: signature falsifiée → refus BAD_SIGNATURE (aucun oracle)", () => {
    const storage = makeStorage();
    const { url } = storage.signUrl("k1", NOW);
    const tampered = url.replace(/sig=[0-9a-f]+/, "sig=deadbeef");
    const result = storage.verifySignedUrl(tampered, NOW);
    expect(result).toEqual({ valid: false, reason: "BAD_SIGNATURE" });
  });

  it("REP-003: URL malformée → refus MALFORMED", () => {
    const storage = makeStorage();
    expect(storage.verifySignedUrl("not a url", NOW)).toEqual({
      valid: false,
      reason: "MALFORMED",
    });
    expect(storage.verifySignedUrl("https://x/download?key=k", NOW)).toEqual({
      valid: false,
      reason: "MALFORMED",
    });
    expect(
      storage.verifySignedUrl("https://x/download?key=k&exp=abc&sig=z", NOW)
    ).toEqual({ valid: false, reason: "MALFORMED" });
  });

  it("REP-003: signPayload est déterministe et dépend de key|exp", () => {
    const a = signPayload(SECRET, "k1", 1000);
    const b = signPayload(SECRET, "k1", 1000);
    const c = signPayload(SECRET, "k2", 1000);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
