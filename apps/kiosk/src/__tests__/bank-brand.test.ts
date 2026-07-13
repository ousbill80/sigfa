/**
 * KIOSK-HOME (retour visuel PO) — Tests TDD pour lib/bank-brand.ts
 * Identite tenant de l'ecran d'accueil : nom public, identifiant public de
 * banque (provisionnement) et monogramme de repli (jamais d'image cassee).
 * Ecrits AVANT l'implementation (phase rouge).
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_BANK_NAME,
  kioskBankName,
  kioskBankId,
  bankMonogram,
} from "@/lib/bank-brand";

/**
 * Environnement de test type-safe : copie de process.env SANS les variables
 * d'identite borne, puis surcharge explicite (pas de cast unsafe).
 */
function makeEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["NEXT_PUBLIC_BANK_NAME"];
  delete env["NEXT_PUBLIC_BANK_ID"];
  for (const [key, value] of Object.entries(overrides)) {
    env[key] = value;
  }
  return env;
}

describe("KIOSK-HOME: bank-brand", () => {
  describe("kioskBankName", () => {
    it("retourne NEXT_PUBLIC_BANK_NAME quand la variable est definie", () => {
      const env = makeEnv({ NEXT_PUBLIC_BANK_NAME: "Banque Atlantique" });
      expect(kioskBankName(env)).toBe("Banque Atlantique");
    });

    it("retombe sur le nom par defaut quand la variable est absente ou vide", () => {
      expect(kioskBankName(makeEnv())).toBe(DEFAULT_BANK_NAME);
      expect(kioskBankName(makeEnv({ NEXT_PUBLIC_BANK_NAME: "" }))).toBe(
        DEFAULT_BANK_NAME
      );
    });
  });

  describe("kioskBankId", () => {
    it("retourne NEXT_PUBLIC_BANK_ID quand la variable est definie", () => {
      const env = makeEnv({
        NEXT_PUBLIC_BANK_ID: "11111111-1111-4111-a111-111111111111",
      });
      expect(kioskBankId(env)).toBe("11111111-1111-4111-a111-111111111111");
    });

    it("retourne null quand la variable est absente ou vide (borne non provisionnee)", () => {
      expect(kioskBankId(makeEnv())).toBeNull();
      expect(kioskBankId(makeEnv({ NEXT_PUBLIC_BANK_ID: "" }))).toBeNull();
      expect(kioskBankId(makeEnv({ NEXT_PUBLIC_BANK_ID: "   " }))).toBeNull();
    });
  });

  describe("bankMonogram", () => {
    it("compose les initiales des deux premiers mots (nom compose)", () => {
      expect(bankMonogram("Banque Atlantique")).toBe("BA");
      expect(bankMonogram("banque nationale de cote d'ivoire")).toBe("BN");
    });

    it("retourne une seule initiale pour un nom d'un seul mot", () => {
      expect(bankMonogram("SIGFA")).toBe("S");
      expect(bankMonogram("  bnci  ")).toBe("B");
    });

    it("repli sur 'S' (SIGFA) pour un nom vide", () => {
      expect(bankMonogram("")).toBe("S");
      expect(bankMonogram("   ")).toBe("S");
    });
  });
});
