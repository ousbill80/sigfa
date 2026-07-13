/**
 * Tests — NET-002 : preuve d'intégrité artefact borne (stub HMAC vérifiable CI).
 *
 * Nommage : `NET-002: <description>`. Aucun mock crypto : hash/HMAC réels.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  signArtifact,
  verifyArtifact,
  computeSha256,
  applyIntegrityAttempt,
  INITIAL_INTEGRITY_STATE,
  QUARANTINE_FAILURE_THRESHOLD,
  type Artifact,
  type SignedArtifact,
} from "src/services/rollout/rollout-integrity.js";

const SECRET = "test-signing-secret-net002";

function makeArtifact(version = "1.4.2", body = "kiosk-bundle-bytes"): Artifact {
  return { version, payload: new TextEncoder().encode(body) };
}

describe("NET-002 rollout-integrity", () => {
  it("NET-002: un artefact signé correctement passe la vérification d'intégrité", () => {
    const signed = signArtifact(makeArtifact(), SECRET);
    const res = verifyArtifact(signed, SECRET);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.sha256).toBe(computeSha256(makeArtifact().payload));
  });

  it("NET-002: le sha256 produit est stable et vérifiable (hash réel)", () => {
    const a = makeArtifact("2.0.0", "abc");
    expect(computeSha256(a.payload)).toBe(computeSha256(a.payload));
    expect(computeSha256(a.payload)).not.toBe(
      computeSha256(makeArtifact("2.0.0", "abd").payload),
    );
  });

  it("NET-002: artefact non signé (signature vide) → refus MISSING_SIGNATURE", () => {
    const signed = signArtifact(makeArtifact(), SECRET);
    const unsigned: SignedArtifact = { ...signed, signature: "" };
    const res = verifyArtifact(unsigned, SECRET);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("MISSING_SIGNATURE");
  });

  it("NET-002: payload altéré (hash ne correspond pas) → refus HASH_MISMATCH", () => {
    const signed = signArtifact(makeArtifact(), SECRET);
    const tampered: SignedArtifact = {
      ...signed,
      payload: new TextEncoder().encode("payload-altéré"),
    };
    const res = verifyArtifact(tampered, SECRET);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("HASH_MISMATCH");
  });

  it("NET-002: signature falsifiée / mauvaise clé → refus BAD_SIGNATURE", () => {
    const signed = signArtifact(makeArtifact(), SECRET);
    const res = verifyArtifact(signed, "mauvaise-cle");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("BAD_SIGNATURE");
  });

  it("NET-002: sha256 correct mais version modifiée → BAD_SIGNATURE (signature couvre la version)", () => {
    const signed = signArtifact(makeArtifact("1.0.0"), SECRET);
    // On garde payload+sha256 valides mais on ment sur la version → signature ≠.
    const swapped: SignedArtifact = { ...signed, version: "9.9.9" };
    const res = verifyArtifact(swapped, SECRET);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("BAD_SIGNATURE");
  });

  describe("quarantaine après 3 échecs (D3)", () => {
    it("NET-002: le seuil de quarantaine par défaut est 3", () => {
      expect(QUARANTINE_FAILURE_THRESHOLD).toBe(3);
    });

    it("NET-002: quarantaine — 3 échecs d'intégrité consécutifs → borne quarantinée", () => {
      let state = INITIAL_INTEGRITY_STATE;
      const fail = { ok: false as const, reason: "HASH_MISMATCH" as const };
      state = applyIntegrityAttempt(state, fail);
      expect(state.quarantined).toBe(false);
      expect(state.failures).toBe(1);
      state = applyIntegrityAttempt(state, fail);
      expect(state.quarantined).toBe(false);
      state = applyIntegrityAttempt(state, fail);
      expect(state.quarantined).toBe(true);
      expect(state.failures).toBe(3);
    });

    it("NET-002: un succès réinitialise le compteur d'échecs (pas de quarantaine)", () => {
      let state = applyIntegrityAttempt(INITIAL_INTEGRITY_STATE, {
        ok: false,
        reason: "BAD_SIGNATURE",
      });
      expect(state.failures).toBe(1);
      const signed = signArtifact(makeArtifact(), SECRET);
      state = applyIntegrityAttempt(state, verifyArtifact(signed, SECRET));
      expect(state.failures).toBe(0);
      expect(state.quarantined).toBe(false);
    });

    it("NET-002: une borne quarantinée reste quarantinée (pas de boucle de téléchargement)", () => {
      let state = INITIAL_INTEGRITY_STATE;
      const fail = { ok: false as const, reason: "MISSING_SIGNATURE" as const };
      for (let i = 0; i < QUARANTINE_FAILURE_THRESHOLD; i++) {
        state = applyIntegrityAttempt(state, fail);
      }
      expect(state.quarantined).toBe(true);
      // Un succès après quarantaine ne la lève pas (intervention manuelle requise).
      const signed = signArtifact(makeArtifact(), SECRET);
      const after = applyIntegrityAttempt(state, verifyArtifact(signed, SECRET));
      expect(after.quarantined).toBe(true);
      expect(after).toBe(state);
    });
  });
});
