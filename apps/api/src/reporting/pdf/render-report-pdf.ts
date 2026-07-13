/**
 * REP-002b — Rendu SERVEUR d'un rapport en PDF riche (`@react-pdf/renderer`, A4).
 *
 * Point d'entrée unique consommé par REP-002 (pièce jointe email) et REP-003
 * (export). Transforme un `ReportPayload` normalisé (REP-002) en Buffer PDF, en
 * choisissant le gabarit selon le type de rapport. Aucun recalcul KPI : le rendu
 * FORMATE des valeurs déjà dérivées de REP-001.
 *
 * INDÉSIRABLE (LA LOI) : un payload malformé ou un échec de rendu lève une erreur
 * EXPLICITE (`ReportPdfRenderError`) — jamais un PDF corrompu ou vide silencieux.
 *
 * Déterminisme : `@react-pdf/renderer` injecte DEUX sources non reproductibles — un
 * `/ID` aléatoire (trailer) et une `/CreationDate` (`(D:YYYYMMDDHHMMSSZ)`).
 * `normalizePdfForSnapshot` neutralise ces deux sources pour des snapshots stables ;
 * `countPdfPages` compte les objets `/Type /Page` (test COMEX 1 page).
 *
 * @module
 */

import { renderToBuffer } from "@react-pdf/renderer";
import type { JSX } from "react";
import type { ReportPayload, ReportType } from "src/reporting/report-schedule.js";
import { EMAIL_LANGS } from "src/services/email/email-types.js";
import { resolvePdfTheme, type TenantBrandConfig } from "src/reporting/pdf/theme.js";
import { buildReportViewModel } from "src/reporting/pdf/report-view-model.js";
import { type PdfLang } from "src/reporting/pdf/pdf-i18n.js";
import {
  DailyReportDocument,
  WeeklyReportDocument,
  MonthlyReportDocument,
  type ReportDocumentProps,
} from "src/reporting/pdf/report-document.js";

/** Options de rendu d'un rapport en PDF. */
export interface RenderReportPdfOptions {
  /** Langue du document (FR/EN) — défaut FR. */
  lang?: PdfLang;
  /** Configuration de marque du tenant (couleur/logo/nom) — défauts SIGFA sinon. */
  brand?: TenantBrandConfig;
}

/**
 * Erreur EXPLICITE de rendu PDF (payload malformé, gabarit indisponible, échec du
 * moteur). Remontée à REP-002/REP-003 pour retry/dead-letter — jamais un PDF vide.
 */
export class ReportPdfRenderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReportPdfRenderError";
  }
}

/** Sélectionne le composant document selon le type de rapport. */
function documentFor(reportType: ReportType, props: ReportDocumentProps): JSX.Element {
  switch (reportType) {
    case "DAILY":
      return DailyReportDocument(props);
    case "WEEKLY":
      return WeeklyReportDocument(props);
    case "MONTHLY":
      return MonthlyReportDocument(props);
  }
}

/** Valide (garde légère) qu'un payload porte le minimum requis pour le rendu. */
function assertRenderablePayload(payload: ReportPayload): void {
  const okType =
    payload.reportType === "DAILY" ||
    payload.reportType === "WEEKLY" ||
    payload.reportType === "MONTHLY";
  if (!okType) {
    throw new ReportPdfRenderError(
      `Type de rapport inconnu — rendu PDF refusé : ${String(payload.reportType)}`
    );
  }
  if (!payload.kpis || typeof payload.periodKey !== "string" || payload.periodKey.length === 0) {
    throw new ReportPdfRenderError(
      "Payload de rapport malformé (kpis/periodKey manquants) — rendu PDF refusé."
    );
  }
}

/**
 * Rend un `ReportPayload` en Buffer PDF (A4 portrait) via le gabarit du type. La
 * langue par défaut est FR (LA LOI) ; le theming tenant est appliqué (défauts SIGFA
 * si non fourni). Toute erreur de rendu est encapsulée en `ReportPdfRenderError`.
 *
 * @param payload - Payload normalisé REP-002 (KPIs déjà dérivés de REP-001)
 * @param options - Langue + config de marque tenant
 * @returns Buffer PDF (commence par `%PDF-`)
 * @throws {ReportPdfRenderError} Payload malformé ou échec du moteur de rendu
 */
export async function renderReportPdf(
  payload: ReportPayload,
  options: RenderReportPdfOptions = {}
): Promise<Buffer> {
  assertRenderablePayload(payload);
  const lang: PdfLang = options.lang ?? "FR";
  if (!EMAIL_LANGS.includes(lang)) {
    throw new ReportPdfRenderError(`Langue non supportée (FR/EN uniquement) : ${String(lang)}`);
  }
  try {
    const theme = resolvePdfTheme(options.brand ?? {});
    const view = buildReportViewModel(payload, lang);
    const element = documentFor(payload.reportType, { view, theme, lang });
    const buffer = await renderToBuffer(element);
    /* v8 ignore next 3 — garde défensive : renderToBuffer renvoie toujours ≥ 1 octet. */
    if (buffer.length === 0) {
      throw new ReportPdfRenderError("Rendu PDF vide — refus (jamais de pièce jointe vide).");
    }
    return buffer;
  } catch (err) {
    if (err instanceof ReportPdfRenderError) throw err;
    throw new ReportPdfRenderError(
      `Échec du rendu PDF du rapport ${payload.reportType} — ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
}

/**
 * Compte les pages d'un PDF (objets `/Type /Page` hors `/Pages`). Sert le test de
 * non-débordement du COMEX (nombre de pages == 1).
 *
 * @param pdf - Buffer PDF
 * @returns Nombre de pages
 */
export function countPdfPages(pdf: Buffer): number {
  const text = pdf.toString("latin1");
  // `/Type /Page` NON suivi de `s` (exclut `/Type /Pages`), tolérant aux espaces.
  const matches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return matches ? matches.length : 0;
}

/**
 * Neutralise les deux sources non reproductibles d'un PDF `@react-pdf/renderer`
 * pour produire un snapshot REPRODUCTIBLE :
 *  - le `/ID` du trailer (hash aléatoire) ;
 *  - la `/CreationDate` (`(D:YYYYMMDDHHMMSSZ)`, dépend de l'horloge de rendu).
 * La structure et le contenu métier restent intacts.
 *
 * @param pdf - Buffer PDF
 * @returns Chaîne normalisée (aléa/temps remplacés par des marqueurs stables)
 */
export function normalizePdfForSnapshot(pdf: Buffer): string {
  return pdf
    .toString("latin1")
    .replace(/\/ID\s*\[\s*<[0-9a-fA-F]+>\s*<[0-9a-fA-F]+>\s*\]/g, "/ID [<PDFID> <PDFID>]")
    // Date PDF `(D:20260713094529Z)` ou avec fuseau `(D:...+00'00')` → marqueur stable.
    .replace(/\(D:\d{14}(?:Z|[+-]\d{2}'\d{2}')?\)/g, "(D:PDFDATE)");
}
