/**
 * KIOSK-BORNE — Tests de l'identité d'affichage de la borne (banque/agence).
 * Libellés publics d'enseigne (non-PII), replis sûrs sans configuration.
 */
import { describe, it, expect } from "vitest";
import {
  kioskBankName,
  kioskAgencyName,
  bankInitial,
  DEFAULT_BANK_NAME,
  DEFAULT_AGENCY_NAME,
} from "@/lib/kiosk-branding";

describe("KIOSK-BORNE: kiosk-branding", () => {
  it("KIOSK-BORNE: env provisionné → noms de banque et d'agence lus depuis NEXT_PUBLIC_*", () => {
    const env = {
      NODE_ENV: "test",
      NEXT_PUBLIC_BANK_NAME: "Banque Ivoire",
      NEXT_PUBLIC_AGENCY_NAME: "Cocody Angré 9e Tranche",
    } as NodeJS.ProcessEnv;
    expect(kioskBankName(env)).toBe("Banque Ivoire");
    expect(kioskAgencyName(env)).toBe("Cocody Angré 9e Tranche");
  });

  it("KIOSK-BORNE: env absent ou vide → replis sûrs (jamais de crash, jamais de vide)", () => {
    const empty = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
    expect(kioskBankName(empty)).toBe(DEFAULT_BANK_NAME);
    expect(kioskAgencyName(empty)).toBe(DEFAULT_AGENCY_NAME);
    expect(
      kioskBankName({ NODE_ENV: "test", NEXT_PUBLIC_BANK_NAME: "" } as NodeJS.ProcessEnv)
    ).toBe(DEFAULT_BANK_NAME);
    expect(
      kioskAgencyName({ NODE_ENV: "test", NEXT_PUBLIC_AGENCY_NAME: "" } as NodeJS.ProcessEnv)
    ).toBe(DEFAULT_AGENCY_NAME);
  });

  it("KIOSK-BORNE: bankInitial → une seule capitale, repli « S »", () => {
    expect(bankInitial("Banque Ivoire")).toBe("B");
    expect(bankInitial("  ecobank")).toBe("E");
    expect(bankInitial("")).toBe("S");
    expect(bankInitial("   ")).toBe("S");
  });
});
