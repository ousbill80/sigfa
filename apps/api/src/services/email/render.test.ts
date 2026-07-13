/**
 * Tests unitaires — NOTIF-004 : rendu React Email typé + snapshots FR/EN par type.
 *  - Props invalides (Zod) → refus d'envoi, aucun HTML rendu.
 *  - Snapshot de rendu FR + EN pour les 4 types (régression).
 *  - Repli pièce jointe → bouton de téléchargement présent dans le HTML.
 *
 * Nommage strict : `NOTIF-004: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { renderEmail } from "src/services/email/render.js";
import {
  validateEmailProps,
  EmailPropsInvalidError,
  EMAIL_NOTIFICATION_TYPES,
  type ManagerAlertProps,
  type ReportProps,
} from "src/services/email/email-types.js";

const managerAlert: ManagerAlertProps = {
  bankName: "Banque Atlantique",
  agencyName: "Agence Plateau",
  alertKind: "SLA_BREACH",
  message: "Le SLA du service Retrait est dépassé depuis 12 minutes.",
  occurredAt: "2026-07-12T09:15:00Z",
  severity: "CRITICAL",
};

const report: ReportProps = {
  bankName: "Banque Atlantique",
  agencyName: "Agence Plateau",
  periodKey: "2026-07-12",
  periodLabel: "12 juillet 2026",
  kpis: [
    { label: "Tickets servis", value: "1 240" },
    { label: "Attente moyenne", value: "6 min 30 s" },
    { label: "Respect du SLA", value: "87 %" },
  ],
  attachmentSignedUrl: null,
};

const reportWithLink: ReportProps = {
  ...report,
  attachmentSignedUrl: "https://storage.sigfa.ci/attachments/r.pdf?expires=1&sig=ab",
};

describe("NOTIF-004 validation Zod des props (refus d'envoi si invalide)", () => {
  it("NOTIF-004: props React Email invalides (Zod) → refus d'envoi, aucun HTML cassé", async () => {
    // Props MANAGER_ALERT sans `message` ni `severity` valides.
    await expect(
      renderEmail("MANAGER_ALERT", "FR", { bankName: "B", agencyName: "A" })
    ).rejects.toBeInstanceOf(EmailPropsInvalidError);

    // La validation directe expose les issues (jamais de rendu).
    try {
      validateEmailProps("DAILY_REPORT", { bankName: "B" });
      expect.unreachable("aurait dû lever");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailPropsInvalidError);
      expect((err as EmailPropsInvalidError).issues.length).toBeGreaterThan(0);
    }
  });

  it("NOTIF-004: severity hors enum → refus", () => {
    expect(() =>
      validateEmailProps("MANAGER_ALERT", { ...managerAlert, severity: "FATAL" })
    ).toThrow(EmailPropsInvalidError);
  });

  it("NOTIF-004: KPIs vides → refus (min 1)", () => {
    expect(() =>
      validateEmailProps("WEEKLY_REPORT", { ...report, kpis: [] })
    ).toThrow(EmailPropsInvalidError);
  });
});

describe("NOTIF-004 snapshot de rendu React Email FR + EN par type", () => {
  it("NOTIF-004: MANAGER_ALERT rendu FR (snapshot)", async () => {
    const { subject, html } = await renderEmail("MANAGER_ALERT", "FR", managerAlert);
    expect(subject).toContain("Alerte manager");
    expect(subject).toContain("Agence Plateau");
    expect(html).toContain("SLA_BREACH");
    expect(html).toMatchSnapshot();
  });

  it("NOTIF-004: MANAGER_ALERT rendu EN (snapshot)", async () => {
    const { subject, html } = await renderEmail("MANAGER_ALERT", "EN", managerAlert);
    expect(subject).toContain("Manager alert");
    expect(html).toContain("SLA_BREACH");
    expect(html).toMatchSnapshot();
  });

  it("NOTIF-004: DAILY_REPORT rendu FR + EN (snapshot)", async () => {
    const fr = await renderEmail("DAILY_REPORT", "FR", report);
    const en = await renderEmail("DAILY_REPORT", "EN", report);
    expect(fr.subject).toContain("Rapport journalier");
    expect(en.subject).toContain("Daily report");
    expect(fr.html).toContain("Tickets servis");
    expect(fr.html).toMatchSnapshot();
    expect(en.html).toMatchSnapshot();
  });

  it("NOTIF-004: WEEKLY_REPORT rendu FR + EN (snapshot)", async () => {
    const fr = await renderEmail("WEEKLY_REPORT", "FR", report);
    const en = await renderEmail("WEEKLY_REPORT", "EN", report);
    expect(fr.subject).toContain("Rapport hebdomadaire");
    expect(en.subject).toContain("Weekly report");
    expect(fr.html).toMatchSnapshot();
    expect(en.html).toMatchSnapshot();
  });

  it("NOTIF-004: MONTHLY_REPORT rendu FR + EN (snapshot)", async () => {
    const fr = await renderEmail("MONTHLY_REPORT", "FR", report);
    const en = await renderEmail("MONTHLY_REPORT", "EN", report);
    expect(fr.subject).toContain("Rapport mensuel");
    expect(en.subject).toContain("Monthly report");
    expect(fr.html).toMatchSnapshot();
    expect(en.html).toMatchSnapshot();
  });

  it("NOTIF-004: les 4 types + 2 langues rendent un HTML non vide", async () => {
    for (const type of EMAIL_NOTIFICATION_TYPES) {
      for (const lang of ["FR", "EN"] as const) {
        const props = type === "MANAGER_ALERT" ? managerAlert : report;
        const { html } = await renderEmail(type, lang, props);
        expect(html).toContain("<html");
        expect(html.length).toBeGreaterThan(100);
      }
    }
  });
});

describe("NOTIF-004 repli pièce jointe → bouton dans le corps", () => {
  it("NOTIF-004: attachmentSignedUrl présent → bouton de téléchargement rendu (FR)", async () => {
    const { html } = await renderEmail("DAILY_REPORT", "FR", reportWithLink);
    expect(html).toContain("Télécharger le document");
    expect(html).toContain("storage.sigfa.ci");
    expect(html).toContain("valable 24 heures");
  });

  it("NOTIF-004: attachmentSignedUrl null → aucun bouton de téléchargement", async () => {
    const { html } = await renderEmail("DAILY_REPORT", "FR", report);
    expect(html).not.toContain("Télécharger le document");
  });
});
