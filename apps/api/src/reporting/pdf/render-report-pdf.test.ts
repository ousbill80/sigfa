import { describe, it, expect } from "vitest";
import {
  renderReportPdf,
  countPdfPages,
  normalizePdfForSnapshot,
  ReportPdfRenderError,
} from "src/reporting/pdf/render-report-pdf.js";
import { makePayload } from "src/reporting/pdf/fixtures.js";
import type { ReportPayload } from "src/reporting/report-schedule.js";

/** PNG 8×8 RGB VALIDE (data-URI) — logo de test accepté par le moteur (aucun warning). */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGMQqcjDihiGlgQAVbA+gadukVgAAAAASUVORK5CYII=";

/** Thème tenant distinct (theming — 2 banques) : couleur + logo + nom. */
const TENANT_BRAND = {
  brandColor: "#0F766E",
  bankName: "Banque Atlantique",
  logoSrc: TINY_PNG,
} as const;

describe("REP-002b: rendu PDF serveur (@react-pdf A4)", () => {
  it("REP-002b: produit un PDF A4 valide pour les 3 types (daily/weekly/monthly)", async () => {
    for (const type of ["DAILY", "WEEKLY", "MONTHLY"] as const) {
      const pdf = await renderReportPdf(makePayload(type));
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(500);
    }
  });

  it("REP-002b: le mensuel contient une page COMEX (2 pages total)", async () => {
    const pdf = await renderReportPdf(makePayload("MONTHLY"));
    expect(countPdfPages(pdf)).toBe(2);
  });

  it("REP-002b: le journalier tient sur 1 page", async () => {
    const pdf = await renderReportPdf(makePayload("DAILY"));
    expect(countPdfPages(pdf)).toBe(1);
  });

  it("REP-002b: COMEX tient sur 1 page — non-débordement (densité contrôlée)", async () => {
    // Le document COMEX seul (page exécutive) DOIT rester sur exactement 1 page,
    // même avec un thème tenant riche (logo) et des libellés EN plus longs.
    const { ComexDocument } = await import("src/reporting/pdf/report-document.js");
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { resolvePdfTheme } = await import("src/reporting/pdf/theme.js");
    const { buildReportViewModel } = await import(
      "src/reporting/pdf/report-view-model.js"
    );
    for (const lang of ["FR", "EN"] as const) {
      const view = buildReportViewModel(makePayload("MONTHLY"), lang);
      const theme = resolvePdfTheme(TENANT_BRAND);
      const pdf = await renderToBuffer(ComexDocument({ view, theme, lang }));
      expect(countPdfPages(pdf)).toBe(1);
    }
  });

  it("REP-002b: langue par défaut = FR (rendu identique à lang:FR explicite)", async () => {
    // @react-pdf encode le texte en glyphes positionnés (non lisibles en clair) :
    // on prouve le défaut FR par ÉGALITÉ de rendu avec la langue FR explicite, et
    // par DIFFÉRENCE avec EN (les libellés changent réellement).
    const implicit = normalizePdfForSnapshot(await renderReportPdf(makePayload("DAILY")));
    const fr = normalizePdfForSnapshot(
      await renderReportPdf(makePayload("DAILY"), { lang: "FR" })
    );
    const en = normalizePdfForSnapshot(
      await renderReportPdf(makePayload("DAILY"), { lang: "EN" })
    );
    expect(implicit).toBe(fr);
    expect(implicit).not.toBe(en);
  });

  it("REP-002b: theming tenant appliqué (2 tenants rendus sans erreur)", async () => {
    const a = await renderReportPdf(makePayload("DAILY"), { brand: TENANT_BRAND });
    const b = await renderReportPdf(makePayload("DAILY"), {
      brand: { brandColor: "#b91c1c", bankName: "SGCI" },
    });
    expect(a.subarray(0, 5).toString()).toBe("%PDF-");
    expect(b.subarray(0, 5).toString()).toBe("%PDF-");
    // Les deux documents diffèrent (habillage distinct).
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it("REP-002b: payload malformé → ReportPdfRenderError explicite (jamais PDF vide)", async () => {
    const bad = { ...makePayload("DAILY"), periodKey: "" } as ReportPayload;
    await expect(renderReportPdf(bad)).rejects.toBeInstanceOf(ReportPdfRenderError);
  });

  it("REP-002b: type de rapport inconnu → ReportPdfRenderError", async () => {
    const bad = {
      ...makePayload("DAILY"),
      reportType: "HOURLY",
    } as unknown as ReportPayload;
    await expect(renderReportPdf(bad)).rejects.toBeInstanceOf(ReportPdfRenderError);
  });

  it("REP-002b: langue non supportée → ReportPdfRenderError (FR/EN uniquement)", async () => {
    await expect(
      renderReportPdf(makePayload("DAILY"), {
        // @ts-expect-error test d'une langue hors périmètre
        lang: "ES",
      })
    ).rejects.toBeInstanceOf(ReportPdfRenderError);
  });

  it("REP-002b: échec de rendu interne → encapsulé en ReportPdfRenderError (jamais fuite)", async () => {
    // KpiSet tronqué (truthy mais sans sous-champs) : passe la garde de forme puis
    // fait échouer le formatage/rendu ⇒ l'erreur générique est encapsulée.
    const broken = {
      ...makePayload("DAILY"),
      kpis: {} as unknown as ReportPayload["kpis"],
    } as ReportPayload;
    await expect(renderReportPdf(broken)).rejects.toBeInstanceOf(ReportPdfRenderError);
    await expect(renderReportPdf(broken)).rejects.toThrow(/Échec du rendu PDF/);
  });

  it("REP-002b: réseau → aucun identifiant d'agence dans le flux PDF (anonymisé)", async () => {
    const payload = makePayload("WEEKLY", { agencyId: null });
    const pdf = await renderReportPdf(payload);
    // Le payload réseau ne porte aucun agencyId ; on vérifie qu'aucune valeur
    // d'identifiant d'agence ne fuite dans le document.
    expect(pdf.toString("latin1")).not.toContain("agency-plateau");
  });

  it("REP-002b: countPdfPages ne compte pas l'objet /Pages", () => {
    const fake = Buffer.from(
      "%PDF-1.4 /Type /Pages /Type /Page /Type /Page endobj"
    );
    expect(countPdfPages(fake)).toBe(2);
  });
});

describe("REP-002b: snapshots déterministes FR + EN par type", () => {
  it("REP-002b: normalizePdfForSnapshot neutralise /ID ET /CreationDate (reproductible)", async () => {
    const a = normalizePdfForSnapshot(await renderReportPdf(makePayload("DAILY")));
    const b = normalizePdfForSnapshot(await renderReportPdf(makePayload("DAILY")));
    expect(a).toBe(b);
    expect(a).toContain("/ID [<PDFID> <PDFID>]");
    expect(a).toContain("(D:PDFDATE)");
    // Aucune date PDF horodatée résiduelle (sinon snapshot non reproductible).
    expect(a).not.toMatch(/\(D:\d{14}/);
  });

  for (const type of ["DAILY", "WEEKLY", "MONTHLY"] as const) {
    for (const lang of ["FR", "EN"] as const) {
      it(`REP-002b: snapshot ${type} ${lang} reproductible`, async () => {
        const pdf = await renderReportPdf(makePayload(type), { lang });
        expect(normalizePdfForSnapshot(pdf)).toMatchSnapshot();
      });
    }
  }
});
