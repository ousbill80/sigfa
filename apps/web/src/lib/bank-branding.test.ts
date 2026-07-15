/**
 * Tests for bank-branding (WEB-002-HDR) — marque banque / agence du bandeau,
 * même convention que apps/kiosk kiosk-branding.
 * @module lib/bank-branding.test
 */
import { describe, it, expect } from "vitest";
import {
  bankName,
  agencyName,
  bankLogoUrl,
  bankInitial,
  DEFAULT_BANK_NAME,
  DEFAULT_AGENCY_NAME,
} from "./bank-branding";

describe("bank-branding — provisionnement env + replis sûrs (WEB-002-HDR)", () => {
  it("WEB-002-HDR: bankName lit NEXT_PUBLIC_BANK_NAME", () => {
    expect(bankName({ NEXT_PUBLIC_BANK_NAME: "Banque Atlantique" })).toBe(
      "Banque Atlantique"
    );
  });

  it("WEB-002-HDR: bankName non provisionné ou vide → repli SIGFA", () => {
    expect(bankName({})).toBe(DEFAULT_BANK_NAME);
    expect(bankName({ NEXT_PUBLIC_BANK_NAME: "" })).toBe(DEFAULT_BANK_NAME);
  });

  it("TV-LOGO: agencyName lit NEXT_PUBLIC_AGENCY_NAME", () => {
    expect(agencyName({ NEXT_PUBLIC_AGENCY_NAME: "Agence Cocody" })).toBe(
      "Agence Cocody"
    );
  });

  it("TV-LOGO: agencyName non provisionné ou vide → repli Agence Centrale", () => {
    expect(agencyName({})).toBe(DEFAULT_AGENCY_NAME);
    expect(agencyName({ NEXT_PUBLIC_AGENCY_NAME: "" })).toBe(DEFAULT_AGENCY_NAME);
  });

  it("WEB-002-HDR: bankLogoUrl lit NEXT_PUBLIC_BANK_LOGO_URL", () => {
    expect(
      bankLogoUrl({ NEXT_PUBLIC_BANK_LOGO_URL: "https://cdn.example/logo.svg" })
    ).toBe("https://cdn.example/logo.svg");
  });

  it("WEB-002-HDR: bankLogoUrl absent, vide ou espaces → null (repli pastille --brand)", () => {
    expect(bankLogoUrl({})).toBeNull();
    expect(bankLogoUrl({ NEXT_PUBLIC_BANK_LOGO_URL: "" })).toBeNull();
    expect(bankLogoUrl({ NEXT_PUBLIC_BANK_LOGO_URL: "   " })).toBeNull();
  });

  it("WEB-002-HDR: bankInitial — une capitale, repli S", () => {
    expect(bankInitial("Banque Atlantique")).toBe("B");
    expect(bankInitial("  ecobank")).toBe("E");
    expect(bankInitial("   ")).toBe("S");
  });
});
