/**
 * IA-004 — Tests unitaires de la rédaction PII (CRITIQUE, cas piégés).
 *
 * Couvre le critère ⊛ : ZÉRO PII dans les insights/verbatims — téléphone / nom /
 * identifiant masqués. Nommage strict : `IA-004: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  redactPii,
  containsPii,
  PHONE_TOKEN,
  EMAIL_TOKEN,
  ID_TOKEN,
  NAME_TOKEN,
} from "src/ai/pii-redaction.js";

describe("pii-redaction", () => {
  it("IA-004: masque un numéro de téléphone UEMOA (+225 07 07 07 07 07)", () => {
    const out = redactPii("Appelez-moi au +225 07 07 07 07 07 svp");
    expect(out).toContain(PHONE_TOKEN);
    expect(out).not.toMatch(/\d{2}\s\d{2}/);
    expect(containsPii(out)).toBe(false);
  });

  it("IA-004: masque un téléphone collé (0707070707) sans espaces", () => {
    const out = redactPii("mon num 0707070707");
    expect(out).toContain(PHONE_TOKEN);
    expect(containsPii(out)).toBe(false);
  });

  it("IA-004: masque une adresse e-mail", () => {
    const out = redactPii("écrivez à awa.traore@example.ci merci");
    expect(out).toContain(EMAIL_TOKEN);
    expect(out).not.toContain("@example.ci");
    expect(containsPii(out)).toBe(false);
  });

  it("IA-004: masque un identifiant technique (UUID)", () => {
    const out = redactPii("ticket 11111111-1111-4111-8111-111111111111 non traité");
    expect(out).toContain(ID_TOKEN);
    expect(containsPii(out)).toBe(false);
  });

  it("IA-004: masque un nom propre introduit par un marqueur FR (M. / Monsieur)", () => {
    expect(redactPii("reçu par M. Traoré")).toContain(NAME_TOKEN);
    expect(redactPii("Monsieur Kouassi était présent")).toContain(NAME_TOKEN);
  });

  it("IA-004: masque un nom propre introduit par un marqueur EN (named / called)", () => {
    expect(redactPii("an agent named John helped")).toContain(NAME_TOKEN);
    expect(redactPii("a lady called Awa")).toContain(NAME_TOKEN);
  });

  it("IA-004: cas piégé — plusieurs PII dans un même verbatim", () => {
    const out = redactPii(
      "M. Diallo au +225 05 05 05 05 05, email x@y.io, ticket 22222222-2222-4222-8222-222222222222"
    );
    expect(out).toContain(NAME_TOKEN);
    expect(out).toContain(PHONE_TOKEN);
    expect(out).toContain(EMAIL_TOKEN);
    expect(out).toContain(ID_TOKEN);
    expect(containsPii(out)).toBe(false);
  });

  it("IA-004: n'altère pas un texte sans PII", () => {
    const clean = "Le temps d'attente était trop long.";
    expect(redactPii(clean)).toBe(clean);
    expect(containsPii(clean)).toBe(false);
  });

  it("IA-004: null/undefined → chaîne vide (jamais de throw)", () => {
    expect(redactPii(null)).toBe("");
    expect(redactPii(undefined)).toBe("");
  });

  it("IA-004: containsPii détecte téléphone/email/uuid résiduels", () => {
    expect(containsPii("call 0708091011 now")).toBe(true);
    expect(containsPii("mail a@b.co")).toBe(true);
    expect(containsPii("id 33333333-3333-4333-a333-333333333333")).toBe(true);
    expect(containsPii("aucune donnée sensible")).toBe(false);
  });
});
