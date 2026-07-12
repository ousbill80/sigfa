/**
 * Tests unitaires — sanitation du commentaire de feedback (API-010).
 *
 * Critère EARS : `API-010: commentaire avec HTML/contrôles → nettoyé/rejeté`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { sanitizeComment, CommentTooLongError, CommentControlCharError } from "src/lib/comment-sanitize.js";

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);

describe("API-010: sanitation commentaire", () => {
  it("API-010: commentaire avec HTML → balises supprimées (strip HTML)", () => {
    const out = sanitizeComment("<b>Service</b> <script>alert(1)</script>rapide");
    expect(out).toBe("Service alert(1)rapide");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
  });

  it("API-010: commentaire null → null (optionnel)", () => {
    expect(sanitizeComment(null)).toBeNull();
    expect(sanitizeComment(undefined)).toBeNull();
  });

  it("API-010: commentaire vide après trim → null", () => {
    expect(sanitizeComment("   ")).toBeNull();
    expect(sanitizeComment("<p></p>")).toBeNull();
  });

  it("API-010: caractères de contrôle → rejet (CommentControlCharError)", () => {
    expect(() => sanitizeComment(`bonjour${NUL}monde`)).toThrow(CommentControlCharError);
    expect(() => sanitizeComment(`ligne1${BEL}ligne2`)).toThrow(CommentControlCharError);
  });

  it("API-010: tabulations et sauts de ligne autorisés (pas de rejet)", () => {
    expect(sanitizeComment("ligne1\nligne2\tfin")).toBe("ligne1\nligne2\tfin");
  });

  it("API-010: commentaire > 500 caractères → rejet (CommentTooLongError)", () => {
    expect(() => sanitizeComment("a".repeat(501))).toThrow(CommentTooLongError);
  });

  it("API-010: commentaire exactement 500 caractères → accepté", () => {
    const c = "a".repeat(500);
    expect(sanitizeComment(c)).toBe(c);
  });

  it("API-010: longueur mesurée APRÈS strip HTML (pas de contournement)", () => {
    const withTags = `<span>${"a".repeat(500)}</span>`;
    expect(sanitizeComment(withTags)).toBe("a".repeat(500));
  });
});
