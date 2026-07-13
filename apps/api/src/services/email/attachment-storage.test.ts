/**
 * Tests unitaires — NOTIF-004 : repli pièce jointe hors limite → lien signé TTL 24 h.
 * Horloge injectée → expiration déterministe. Stockage objet MOCK en mémoire.
 *
 * Nommage strict : `NOTIF-004: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  InMemoryObjectStore,
  storeAndSign,
  verifyAttachmentLink,
  signAttachmentLink,
  exceedsAttachmentLimit,
  SIGNED_LINK_TTL_MS,
  DEFAULT_ATTACHMENT_LIMIT_BYTES,
  type CandidateAttachment,
} from "src/services/email/attachment-storage.js";

const attachment: CandidateAttachment = {
  filename: "rapport-2026-07.pdf",
  contentBase64: "JVBERi0xLjc=",
  contentType: "application/pdf",
  sizeBytes: 50 * 1024 * 1024,
};

const T0 = 1_752_000_000_000;

describe("NOTIF-004 plafond de pièce jointe", () => {
  it("NOTIF-004: pièce sous le plafond ne bascule pas ; au-dessus bascule", () => {
    expect(
      exceedsAttachmentLimit({ ...attachment, sizeBytes: 10 }, DEFAULT_ATTACHMENT_LIMIT_BYTES)
    ).toBe(false);
    expect(exceedsAttachmentLimit(attachment, DEFAULT_ATTACHMENT_LIMIT_BYTES)).toBe(true);
  });
});

describe("NOTIF-004 lien signé TTL 24 h (horloge injectée)", () => {
  it("NOTIF-004: pièce hors limite → stockée + lien signé, expire à +24 h", async () => {
    const store = new InMemoryObjectStore();
    const link = await storeAndSign(
      store,
      {
        signingSecret: "s3cr3t",
        baseUrl: "https://storage.sigfa.ci/attachments",
        clock: () => T0,
      },
      attachment,
      () => "report-2026-07.pdf"
    );

    // TTL 24 h exact (D3).
    expect(link.expiresAt).toBe(T0 + SIGNED_LINK_TTL_MS);
    expect(link.expiresAt - T0).toBe(24 * 60 * 60 * 1000);
    expect(link.url).toContain("expires=");
    expect(link.url).toContain("sig=");

    // Le fichier a bien été stocké (récupérable par la route de download).
    const stored = await store.get("report-2026-07.pdf");
    expect(stored?.contentBase64).toBe(attachment.contentBase64);
    expect(stored?.contentType).toBe("application/pdf");
  });

  it("NOTIF-004: signature valide et non expirée → vérifiée ; falsifiée → rejetée", async () => {
    const store = new InMemoryObjectStore();
    const deps = {
      signingSecret: "s3cr3t",
      baseUrl: "https://storage.sigfa.ci/attachments",
      clock: () => T0,
    };
    const link = await storeAndSign(store, deps, attachment, () => "k");

    expect(
      verifyAttachmentLink(
        { signingSecret: "s3cr3t", clock: () => T0 + 1000 },
        "k",
        link.expiresAt,
        signAttachmentLink("s3cr3t", "k", link.expiresAt)
      )
    ).toBe(true);

    // Signature avec mauvais secret → rejetée.
    expect(
      verifyAttachmentLink(
        { signingSecret: "s3cr3t", clock: () => T0 + 1000 },
        "k",
        link.expiresAt,
        signAttachmentLink("WRONG", "k", link.expiresAt)
      )
    ).toBe(false);

    // Signature de mauvaise longueur → rejetée.
    expect(
      verifyAttachmentLink(
        { signingSecret: "s3cr3t", clock: () => T0 + 1000 },
        "k",
        link.expiresAt,
        "deadbeef"
      )
    ).toBe(false);
  });

  it("NOTIF-004: lien expiré (après 24 h) → rejeté", async () => {
    const store = new InMemoryObjectStore();
    const link = await storeAndSign(
      store,
      { signingSecret: "s3cr3t", baseUrl: "https://x", clock: () => T0 },
      attachment,
      () => "k"
    );
    // À T0 + 24 h + 1 ms : expiré.
    expect(
      verifyAttachmentLink(
        { signingSecret: "s3cr3t", clock: () => link.expiresAt + 1 },
        "k",
        link.expiresAt,
        signAttachmentLink("s3cr3t", "k", link.expiresAt)
      )
    ).toBe(false);
  });

  it("NOTIF-004: objet absent du stockage → get retourne null", async () => {
    const store = new InMemoryObjectStore();
    expect(await store.get("inconnu")).toBeNull();
  });

  it("NOTIF-004: TTL par défaut = 24 h si non fourni (horloge réelle tolérée)", async () => {
    const store = new InMemoryObjectStore();
    const before = Date.now();
    const link = await storeAndSign(
      store,
      { signingSecret: "s", baseUrl: "https://x" },
      attachment,
      () => "k"
    );
    expect(link.expiresAt).toBeGreaterThanOrEqual(before + SIGNED_LINK_TTL_MS);
  });
});
