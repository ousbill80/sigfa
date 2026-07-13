/**
 * REP-003 — Sérialisation du CONTENU d'un export (PDF / Excel / JSON).
 *
 * ## Dérivation stricte REP-001 (zéro recalcul)
 * Le contenu d'un export dérive EXCLUSIVEMENT des KPI REP-001 (`computeKpiSet`) et
 * des agrégats déjà sommés — aucune formule KPI n'est réimplémentée ici. Ce module
 * ne fait que PROJETER un `ExportModel` en octets, selon le format demandé.
 *
 * ## Anonymisation réseau (zéro PII)
 * Un export `scope=network` porte UNIQUEMENT l'agrégat anonymisé
 * (`AnonymizedNetworkAggregate` : sommes/moyennes/compteurs) — aucun `agencyId`,
 * aucun nom, aucune PII, quel que soit le format (JSON/Excel/PDF).
 *
 * ## Formats
 * - **JSON** : schéma contractuel CONTRACT-006 (mêmes clés/unités que /reports/kpis).
 * - **Excel** : classeur SpreadsheetML 2003 (XML plat, déterministe, sans lib lourde).
 * - **PDF** : document PDF minimal valide (en-tête %PDF, texte KPI) — déterministe,
 *   pas de moteur headless (périmètre F7 : FORME prouvée, pas la mise en page finale).
 *
 * @module
 */

import {
  computeKpiSet,
  type DailyStatsAggregate,
  type KpiSet,
} from "src/reporting/sla-engine.js";
import {
  EXPORT_CONTENT_TYPE,
  type ExportFormat,
  type StoredObject,
} from "src/reporting/export-storage.js";

/** Portée d'un export. */
export type ExportScope = "agency" | "network";

/** Modèle d'export d'agence (avant sérialisation). */
export interface AgencyExportModel {
  /** Portée. */
  scope: "agency";
  /** Clé de période normalisée. */
  periodKey: string;
  /** Identifiant de l'agence. */
  agencyId: string;
  /** Agrégat pré-sommé de la période (REP-001). */
  aggregate: DailyStatsAggregate;
  /** Jour partiel (période non figée). */
  partial: boolean;
}

/** Modèle d'export réseau ANONYMISÉ (zéro PII). */
export interface NetworkExportModel {
  /** Portée. */
  scope: "network";
  /** Clé de période normalisée. */
  periodKey: string;
  /** Agrégat réseau pré-sommé (aucun identifiant d'agence). */
  aggregate: DailyStatsAggregate;
  /** Nombre d'agences contributrices (sans identifiant). */
  agencyCount: number;
  /** Jour partiel (période non figée). */
  partial: boolean;
}

/** Modèle d'export (agence ou réseau). */
export type ExportModel = AgencyExportModel | NetworkExportModel;

/** Secondes par minute (conversion durée moteur → minutes exposées). */
const SECONDS_PER_MINUTE = 60;

/** Convertit une durée moteur (secondes) en minutes (1 décimale), `null` inchangé. */
function toMinutes(seconds: number | null): number | null {
  if (seconds === null) return null;
  return Math.round((seconds / SECONDS_PER_MINUTE) * 10) / 10;
}

/** Projette un `KpiSet` moteur (durées en secondes) en durées exposées (minutes). */
function projectKpiSet(kpis: KpiSet): KpiSet {
  return {
    tma: { value: toMinutes(kpis.tma.value), unit: "minutes" },
    tmt: { value: toMinutes(kpis.tmt.value), unit: "minutes" },
    tts: { value: toMinutes(kpis.tts.value), unit: "minutes" },
    tauxAbandon: kpis.tauxAbandon,
    tauxSLA: kpis.tauxSLA,
    nps: kpis.nps,
    occupation: kpis.occupation,
  };
}

/**
 * Construit l'objet JSON contractuel d'un export (mêmes clés/unités que
 * /reports/kpis — CONTRACT-006). Réseau = `AnonymizedNetworkAggregate` (zéro PII).
 *
 * @param model - Modèle d'export
 * @returns Objet JSON sérialisable conforme au contrat
 */
export function buildJsonPayload(model: ExportModel): Record<string, unknown> {
  if (model.scope === "network") {
    const kpis = computeKpiSet(model.aggregate);
    return {
      scope: "network",
      period: model.periodKey,
      aggregate: {
        totalTickets: model.aggregate.ticketsIssued,
        avgTma: toMinutes(kpis.tma.value) ?? 0,
        avgTmt: toMinutes(kpis.tmt.value) ?? 0,
        avgTts: toMinutes(kpis.tts.value) ?? 0,
        avgTauxAbandon: kpis.tauxAbandon.value ?? 0,
        avgTauxSLA: kpis.tauxSLA.value ?? 0,
        avgOccupation: kpis.occupation.value ?? 0,
        agencyCount: model.agencyCount,
      },
      partial: model.partial,
    };
  }
  return {
    scope: "agency",
    period: model.periodKey,
    agencyId: model.agencyId,
    kpis: projectKpiSet(computeKpiSet(model.aggregate)),
    totalTickets: model.aggregate.ticketsIssued,
    partial: model.partial,
  };
}

/** Paires (libellé, valeur) tabulaires d'un export, communes à Excel et PDF. */
export function buildKpiRows(model: ExportModel): Array<[string, string]> {
  const kpis = projectKpiSet(computeKpiSet(model.aggregate));
  const fmt = (v: number | null): string => (v === null ? "n/a" : String(v));
  const rows: Array<[string, string]> = [
    ["period", model.periodKey],
    ["scope", model.scope],
    ["totalTickets", String(model.aggregate.ticketsIssued)],
    ["tma_minutes", fmt(kpis.tma.value)],
    ["tmt_minutes", fmt(kpis.tmt.value)],
    ["tts_minutes", fmt(kpis.tts.value)],
    ["tauxAbandon_percent", fmt(kpis.tauxAbandon.value)],
    ["tauxSLA_percent", fmt(kpis.tauxSLA.value)],
    ["nps_score", fmt(kpis.nps)],
    ["occupation_percent", fmt(kpis.occupation.value)],
  ];
  if (model.scope === "network") {
    rows.push(["agencyCount", String(model.agencyCount)]);
  } else {
    rows.push(["agencyId", model.agencyId]);
  }
  return rows;
}

/** Échappe une valeur pour le XML (SpreadsheetML). */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Sérialise un export au format Excel (SpreadsheetML 2003 — XML plat déterministe).
 * Une feuille « KPIs », une ligne par indicateur (libellé + valeur).
 *
 * @param model - Modèle d'export
 * @returns Buffer XML SpreadsheetML
 */
export function buildExcel(model: ExportModel): Buffer {
  const rows = buildKpiRows(model)
    .map(
      ([label, value]) =>
        `<Row><Cell><Data ss:Type="String">${escapeXml(label)}</Data></Cell>` +
        `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell></Row>`
    )
    .join("");
  const xml =
    `<?xml version="1.0"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ` +
    `xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="KPIs"><Table>${rows}</Table></Worksheet></Workbook>`;
  return Buffer.from(xml, "utf-8");
}

/**
 * Sérialise un export au format PDF (document PDF 1.4 minimal VALIDE, déterministe).
 * Une page, le texte tabulaire des KPI. Pas de moteur headless (périmètre F7).
 *
 * @param model - Modèle d'export
 * @returns Buffer PDF (commence par `%PDF-`)
 */
export function buildPdf(model: ExportModel): Buffer {
  const lines = buildKpiRows(model).map(([label, value]) => `${label}: ${value}`);
  const textOps = lines
    .map((line, i) => `BT /F1 12 Tf 40 ${760 - i * 18} Td (${escapePdfText(line)}) Tj ET`)
    .join("\n");
  const content = `q\n${textOps}\nQ`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "utf-8")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "utf-8"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "utf-8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "utf-8");
}

/** Échappe le texte d'un opérateur PDF `Tj` (parenthèses et backslash). */
function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Sérialise un export dans le format demandé (contenu + type MIME). Point d'entrée
 * unique consommé par le worker de build. Dérive STRICTEMENT de REP-001.
 *
 * @param format - Format d'export (pdf|xlsx|json)
 * @param model  - Modèle d'export
 * @returns Objet stockable (contenu binaire + Content-Type)
 */
export function renderExport(format: ExportFormat, model: ExportModel): StoredObject {
  const contentType = EXPORT_CONTENT_TYPE[format];
  switch (format) {
    case "json":
      return {
        body: Buffer.from(JSON.stringify(buildJsonPayload(model)), "utf-8"),
        contentType,
      };
    case "xlsx":
      return { body: buildExcel(model), contentType };
    /* v8 ignore next 2 — `pdf` : dernière branche, exhaustivité de l'union format. */
    case "pdf":
      return { body: buildPdf(model), contentType };
  }
}
