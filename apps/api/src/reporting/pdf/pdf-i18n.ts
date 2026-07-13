/**
 * REP-002b — Libellés statiques FR/EN des gabarits PDF de rapport.
 *
 * LA LOI : FR/EN UNIQUEMENT (MEMORY — Dioula/Baoulé retirés). Aucune valeur métier
 * ici (transport pur) : uniquement le chrome des documents (titres, libellés KPI,
 * mentions). Réutilise le type de langue de NOTIF-004 (`EmailLang`) pour une seule
 * source de vérité des langues côté serveur.
 *
 * @module
 */

import type { EmailLang } from "src/services/email/email-types.js";

/** Langue d'un document PDF (FR/EN — alias sur la langue email pour cohérence). */
export type PdfLang = EmailLang;

/** Dictionnaire de libellés d'un gabarit PDF. */
export interface PdfStrings {
  /** Titre du rapport journalier. */
  dailyTitle: string;
  /** Titre du rapport hebdomadaire (réseau). */
  weeklyTitle: string;
  /** Titre du rapport mensuel qualité. */
  monthlyTitle: string;
  /** Titre de la page COMEX. */
  comexTitle: string;
  /** Sous-titre COMEX (synthèse exécutive). */
  comexSubtitle: string;
  /** Étiquette « Période ». */
  periodLabel: string;
  /** Étiquette « Portée ». */
  scopeLabel: string;
  /** Portée agence. */
  scopeAgency: string;
  /** Portée réseau. */
  scopeNetwork: string;
  /** Étiquette « Agences agrégées ». */
  agencyCountLabel: string;
  /** Étiquette « Tickets émis ». */
  totalTicketsLabel: string;
  /** Mention « données partielles / arrêtées à 18h00 ». */
  partialNotice: string;
  /** Valeur affichée pour un KPI non calculable. */
  notAvailable: string;
  /** Titre de la section KPIs. */
  kpiSectionTitle: string;
  /** Pied de page — document interne. */
  internalFooter: string;
  /** Libellé TMA (temps moyen d'attente). */
  tmaLabel: string;
  /** Libellé TMT (temps moyen de traitement). */
  tmtLabel: string;
  /** Libellé TTS (temps total de service). */
  ttsLabel: string;
  /** Libellé taux d'abandon. */
  tauxAbandonLabel: string;
  /** Libellé taux SLA. */
  tauxSLALabel: string;
  /** Libellé NPS. */
  npsLabel: string;
  /** Libellé taux d'occupation. */
  occupationLabel: string;
  /** Unité minutes (suffixe). */
  unitMinutes: string;
}

/** Table des libellés par langue (FR/EN uniquement). */
const STRINGS: Record<PdfLang, PdfStrings> = {
  FR: {
    dailyTitle: "Rapport journalier",
    weeklyTitle: "Rapport hebdomadaire réseau",
    monthlyTitle: "Rapport mensuel qualité",
    comexTitle: "Synthèse COMEX",
    comexSubtitle: "Vue exécutive — 1 page",
    periodLabel: "Période",
    scopeLabel: "Portée",
    scopeAgency: "Agence",
    scopeNetwork: "Réseau",
    agencyCountLabel: "Agences agrégées",
    totalTicketsLabel: "Tickets émis",
    partialNotice: "Données partielles — arrêtées à 18h00 (Abidjan).",
    notAvailable: "N/A",
    kpiSectionTitle: "Indicateurs de service",
    internalFooter:
      "Document interne SIGFA — destiné au personnel de la banque uniquement.",
    tmaLabel: "Temps moyen d'attente",
    tmtLabel: "Temps moyen de traitement",
    ttsLabel: "Temps total de service",
    tauxAbandonLabel: "Taux d'abandon",
    tauxSLALabel: "Taux SLA",
    npsLabel: "NPS",
    occupationLabel: "Taux d'occupation",
    unitMinutes: "min",
  },
  EN: {
    dailyTitle: "Daily report",
    weeklyTitle: "Weekly network report",
    monthlyTitle: "Monthly quality report",
    comexTitle: "COMEX summary",
    comexSubtitle: "Executive view — 1 page",
    periodLabel: "Period",
    scopeLabel: "Scope",
    scopeAgency: "Branch",
    scopeNetwork: "Network",
    agencyCountLabel: "Aggregated branches",
    totalTicketsLabel: "Tickets issued",
    partialNotice: "Partial data — cut off at 18:00 (Abidjan).",
    notAvailable: "N/A",
    kpiSectionTitle: "Service indicators",
    internalFooter: "SIGFA internal document — for bank staff only.",
    tmaLabel: "Average waiting time",
    tmtLabel: "Average handling time",
    ttsLabel: "Total service time",
    tauxAbandonLabel: "Abandonment rate",
    tauxSLALabel: "SLA rate",
    npsLabel: "NPS",
    occupationLabel: "Occupancy rate",
    unitMinutes: "min",
  },
};

/**
 * Retourne les libellés d'une langue (FR/EN).
 *
 * @param lang - Langue du gabarit
 * @returns Dictionnaire de libellés
 */
export function pdfStrings(lang: PdfLang): PdfStrings {
  return STRINGS[lang];
}
