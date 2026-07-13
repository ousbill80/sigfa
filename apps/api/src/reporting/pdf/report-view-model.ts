/**
 * REP-002b — Projection PURE d'un `ReportPayload` (REP-002) en modèle d'AFFICHAGE
 * PDF. Aucun recalcul KPI : on FORMATE des valeurs déjà dérivées de REP-001.
 *
 * Règles d'affichage (LA LOI REP-002b) :
 *  - Un KPI `null` s'affiche « N/A » (jamais `0`, jamais case vide ambiguë).
 *  - Portée réseau ⇒ AUCUN nom d'agent, uniquement des agrégats (l'`agencyId` d'une
 *    portée agence est un identifiant technique, pas un nom de personne — la borne
 *    d'anonymisation est structurelle : le payload réseau ne porte déjà aucune PII).
 *  - Durées (TMA/TMT/TTS) exposées en minutes (1 décimale) ; taux en %, NPS en score.
 *
 * Module PUR (aucune I/O, aucune horloge) — déterministe.
 *
 * @module
 */

import type { KpiSet } from "src/reporting/sla-engine.js";
import type { ReportPayload } from "src/reporting/report-schedule.js";
import { pdfStrings, type PdfLang, type PdfStrings } from "src/reporting/pdf/pdf-i18n.js";

/** Secondes par minute (durée moteur → minutes exposées). */
const SECONDS_PER_MINUTE = 60;

/** Convertit une durée moteur (secondes) en minutes (1 décimale) ; `null` inchangé. */
function toMinutes(seconds: number | null): number | null {
  if (seconds === null) return null;
  return Math.round((seconds / SECONDS_PER_MINUTE) * 10) / 10;
}

/** Une ligne KPI d'affichage : libellé localisé + valeur formatée (jamais vide). */
export interface KpiRow {
  /** Clé stable du KPI (tri/tests). */
  key: keyof KpiSet;
  /** Libellé localisé. */
  label: string;
  /** Valeur formatée prête à l'affichage (« N/A » si non calculable). */
  value: string;
}

/** Modèle d'affichage complet d'un document rapport (chrome + lignes KPI). */
export interface ReportViewModel {
  /** Titre localisé selon le type de rapport. */
  title: string;
  /** Libellé de portée localisé (Agence/Réseau). */
  scopeLabel: string;
  /** Clé de période (affichage brut, déjà normalisé). */
  periodKey: string;
  /** Nombre de tickets émis (chaîne). */
  totalTickets: string;
  /** Nombre d'agences agrégées (chaîne) ; pertinent en réseau. */
  agencyCount: string;
  /** `true` si la fenêtre est partielle (mention « arrêté à 18h00 »). */
  partial: boolean;
  /** Les 7 lignes KPI formatées (ordre stable). */
  kpiRows: KpiRow[];
  /** Les 3 KPIs stratégiques mis en avant pour le COMEX (sous-ensemble ordonné). */
  comexHighlights: KpiRow[];
}

/** Formate une valeur numérique nullable en chaîne, « N/A » si `null`. */
function fmt(value: number | null, strings: PdfStrings, suffix = ""): string {
  if (value === null) return strings.notAvailable;
  return `${value}${suffix}`;
}

/** Titre localisé du document selon le type de rapport. */
function titleFor(payload: ReportPayload, strings: PdfStrings): string {
  switch (payload.reportType) {
    case "DAILY":
      return strings.dailyTitle;
    case "WEEKLY":
      return strings.weeklyTitle;
    case "MONTHLY":
      return strings.monthlyTitle;
  }
}

/**
 * Construit les 7 lignes KPI formatées d'un payload (durées en minutes, taux en %,
 * NPS en score). Un KPI `null` ⇒ « N/A ». Ordre STABLE (déterminisme snapshot).
 *
 * @param kpis    - KPIs dérivés de REP-001 (durées en secondes)
 * @param strings - Libellés localisés
 * @returns Lignes KPI ordonnées
 */
export function buildKpiRows(kpis: KpiSet, strings: PdfStrings): KpiRow[] {
  const min = strings.unitMinutes;
  return [
    { key: "tma", label: strings.tmaLabel, value: fmt(toMinutes(kpis.tma.value), strings, ` ${min}`) },
    { key: "tmt", label: strings.tmtLabel, value: fmt(toMinutes(kpis.tmt.value), strings, ` ${min}`) },
    { key: "tts", label: strings.ttsLabel, value: fmt(toMinutes(kpis.tts.value), strings, ` ${min}`) },
    { key: "tauxAbandon", label: strings.tauxAbandonLabel, value: fmt(kpis.tauxAbandon.value, strings, " %") },
    { key: "tauxSLA", label: strings.tauxSLALabel, value: fmt(kpis.tauxSLA.value, strings, " %") },
    { key: "nps", label: strings.npsLabel, value: fmt(kpis.nps, strings) },
    { key: "occupation", label: strings.occupationLabel, value: fmt(kpis.occupation.value, strings, " %") },
  ];
}

/**
 * Projette un `ReportPayload` en `ReportViewModel` d'affichage (FORMATAGE PUR, zéro
 * recalcul). Sélectionne les 3 KPIs stratégiques du COMEX : taux SLA, NPS, taux
 * d'abandon — la triade « qualité de service » d'une vue exécutive.
 *
 * @param payload - Payload normalisé REP-002
 * @param lang    - Langue du document (FR/EN)
 * @returns Modèle d'affichage prêt pour les gabarits React-PDF
 */
export function buildReportViewModel(
  payload: ReportPayload,
  lang: PdfLang
): ReportViewModel {
  const strings = pdfStrings(lang);
  const kpiRows = buildKpiRows(payload.kpis, strings);
  const byKey = (k: keyof KpiSet): KpiRow =>
    kpiRows.find((r) => r.key === k) as KpiRow;
  return {
    title: titleFor(payload, strings),
    scopeLabel: payload.scope === "network" ? strings.scopeNetwork : strings.scopeAgency,
    periodKey: payload.periodKey,
    totalTickets: String(payload.totalTickets),
    agencyCount: String(payload.agencyCount),
    partial: payload.partial,
    kpiRows,
    // Triade stratégique COMEX (ordre fixe) : SLA, NPS, abandon.
    comexHighlights: [byKey("tauxSLA"), byKey("nps"), byKey("tauxAbandon")],
  };
}
