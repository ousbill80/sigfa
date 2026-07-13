/**
 * REP-002b — Pont entre le gabarit PDF riche et le canal email NOTIF-004.
 *
 * Produit une pièce jointe candidate (`CandidateAttachment`) à partir d'un
 * `ReportPayload` : rend le PDF (A4, gabarit du type, theming tenant, FR/EN), puis
 * l'emballe (filename déterministe, base64, taille). Consommé par le wiring email
 * de REP-002 (`report-build.job.ts`) et réutilisable par les exports (REP-003).
 *
 * @module
 */

import type { ReportPayload } from "src/reporting/report-schedule.js";
import type { CandidateAttachment } from "src/services/email/attachment-storage.js";
import {
  renderReportPdf,
  type RenderReportPdfOptions,
} from "src/reporting/pdf/render-report-pdf.js";

/** Type MIME d'un PDF. */
export const PDF_CONTENT_TYPE = "application/pdf";

/**
 * Nom de fichier DÉTERMINISTE d'une pièce jointe rapport : `report-<type>-<period>.pdf`
 * (type en minuscules, période normalisée). Aucun horodatage caché → reproductible.
 *
 * @param payload - Payload de rapport
 * @returns Nom de fichier `.pdf`
 */
export function reportPdfFilename(payload: ReportPayload): string {
  return `report-${payload.reportType.toLowerCase()}-${payload.periodKey}.pdf`;
}

/**
 * Rend un `ReportPayload` en pièce jointe PDF prête pour NOTIF-004
 * (`prepareEmailJob` décidera de la joindre en ligne ou de la basculer en lien
 * signé selon le plafond). Toute erreur de rendu remonte en `ReportPdfRenderError`.
 *
 * @param payload - Payload normalisé REP-002
 * @param options - Langue + theming tenant
 * @returns Pièce jointe candidate (base64 + type + taille)
 * @throws {ReportPdfRenderError} Payload malformé ou échec de rendu (jamais pièce vide)
 */
export async function buildReportPdfAttachment(
  payload: ReportPayload,
  options: RenderReportPdfOptions = {}
): Promise<CandidateAttachment> {
  const pdf = await renderReportPdf(payload, options);
  return {
    filename: reportPdfFilename(payload),
    contentBase64: pdf.toString("base64"),
    contentType: PDF_CONTENT_TYPE,
    sizeBytes: pdf.length,
  };
}
