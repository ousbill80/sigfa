/**
 * Tests unitaires — masquage PII d'un téléphone (NOTIF-002 / CONTRACT-007).
 * Nommage strict : `NOTIF-002: <description>`.
 */

import { describe, it, expect } from "vitest";
import { maskPhone } from "src/lib/phone-mask.js";

describe("maskPhone", () => {
  it("NOTIF-002: masque un E.164 en 2 premiers + 2 derniers chiffres visibles", () => {
    // +2250700000047 → 13 chiffres : 2 tête (22) + 9 masqués + 2 queue (47).
    const masked = maskPhone("+2250700000047");
    expect(masked.startsWith("22 ")).toBe(true);
    expect(masked.endsWith(" 47")).toBe(true);
    expect(masked).toContain("••");
  });

  it("NOTIF-002: n'expose jamais un chiffre du milieu", () => {
    const masked = maskPhone("+2250712345689");
    // Les chiffres du milieu (1234568) ne doivent pas apparaître.
    expect(masked).not.toContain("1234");
    expect(masked).not.toContain("345");
  });

  it("NOTIF-002: ignore les séparateurs (espaces/tirets/plus)", () => {
    const a = maskPhone("+225 07-00-00-00-47");
    const b = maskPhone("+2250700000047");
    expect(a).toBe(b);
  });

  it("NOTIF-002: masque intégralement un numéro trop court (aucune fuite)", () => {
    expect(maskPhone("+123")).toBe("••");
    expect(maskPhone("12")).toBe("••");
  });
});
