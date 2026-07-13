import { describe, it, expect } from "vitest";
import { pdfStrings } from "src/reporting/pdf/pdf-i18n.js";

describe("REP-002b: libellés PDF FR/EN", () => {
  it("REP-002b: FR et EN fournissent tous les libellés sans clé brute", () => {
    for (const lang of ["FR", "EN"] as const) {
      const s = pdfStrings(lang);
      for (const value of Object.values(s)) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it("REP-002b: FR et EN diffèrent (langues réellement distinctes)", () => {
    expect(pdfStrings("FR").dailyTitle).not.toBe(pdfStrings("EN").dailyTitle);
    expect(pdfStrings("FR").comexTitle).toBe("Synthèse COMEX");
    expect(pdfStrings("EN").comexTitle).toBe("COMEX summary");
  });
});
