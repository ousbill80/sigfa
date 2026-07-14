/**
 * KIOSK-HOME (retour visuel PO) — Tests TDD pour lib/bank-brand.ts
 * Identite tenant de l'ecran d'accueil : nom public, identifiant public de
 * banque (provisionnement) et monogramme de repli (jamais d'image cassee).
 * Ecrits AVANT l'implementation (phase rouge).
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_BANK_NAME,
  DEFAULT_AGENCY_NAME,
  kioskBankName,
  kioskBankId,
  kioskAgencyName,
  agencyWelcomeName,
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
  delete env["NEXT_PUBLIC_AGENCY_NAME"];
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

  describe("kioskAgencyName (AUDIT-F18)", () => {
    it("retourne NEXT_PUBLIC_AGENCY_NAME quand la variable est definie", () => {
      const env = makeEnv({ NEXT_PUBLIC_AGENCY_NAME: "Cocody Angré" });
      expect(kioskAgencyName(env)).toBe("Cocody Angré");
    });

    it("retombe sur le nom d'agence par defaut quand la variable est absente ou vide", () => {
      expect(kioskAgencyName(makeEnv())).toBe(DEFAULT_AGENCY_NAME);
      expect(kioskAgencyName(makeEnv({ NEXT_PUBLIC_AGENCY_NAME: "" }))).toBe(
        DEFAULT_AGENCY_NAME
      );
    });
  });

  describe("agencyWelcomeName (AUDIT-F18 — doublon « agence Agence »)", () => {
    it("retire le prefixe « Agence » du nom pour la phrase « à l'agence {nom} »", () => {
      expect(agencyWelcomeName("Agence Centrale")).toBe("Centrale");
      expect(agencyWelcomeName("agence Plateau")).toBe("Plateau");
      expect(agencyWelcomeName("AGENCE   Cocody")).toBe("Cocody");
    });

    it("laisse intact un nom sans prefixe « Agence »", () => {
      expect(agencyWelcomeName("Cocody Angré 9e Tranche")).toBe(
        "Cocody Angré 9e Tranche"
      );
      expect(agencyWelcomeName("Plateau")).toBe("Plateau");
    });

    it("ne vide jamais le nom : « Agence » seul est conserve tel quel", () => {
      expect(agencyWelcomeName("Agence")).toBe("Agence");
      expect(agencyWelcomeName("  Agence  ")).toBe("Agence");
    });

    it("ne retire pas un mot qui COMMENCE par agence sans en etre le prefixe exact", () => {
      // « Agencement » n'est pas le mot « agence » : aucun retrait.
      expect(agencyWelcomeName("Agencement Nord")).toBe("Agencement Nord");
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
